// SPDX-License-Identifier: Apache-2.0

import { Button, EmptyState, Icon, Spinner } from "../../shared/ui";
import type { ModelsDataMessage } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./ModelsView.module.css";
import type { BackendCoverage, ModelCoverage } from "./coverage";
import {
  STATIC_SCREEN_CAVEAT,
  UNDETERMINED_CAVEAT,
  backendLabel,
  basisSummary,
  coverageBadge,
  coverageDetail,
  cpuCertainOps,
  isProven,
} from "./coverage";
import type {
  AbResultView,
  EnergyView,
  ModelArtifact,
  ModelListEntry,
  ModelToolchain,
  PrepResult,
  RunResultView,
  ZooEntryView,
} from "./useModels";
import { useModels } from "./useModels";

// `info`/`neutral` exist for NPU coverage (see ./coverage.ts): a static-screen
// positive must not borrow the green of a proven compile, and "not determined"
// must not borrow the red of a real negative.
type BadgeVariant = "ok" | "info" | "warn" | "err" | "neutral";

/** The artifact badge's own narrower set, so its label map stays exhaustive. */
type ArtifactVariant = "ok" | "warn" | "err";

function artifactVariant(artifact?: ModelArtifact): ArtifactVariant {
  if (!artifact || !artifact.exists) return "err";
  return artifact.stale ? "warn" : "ok";
}

const ARTIFACT_LABEL: Record<ArtifactVariant, string> = {
  ok: "built",
  warn: "stale",
  err: "missing",
};

function formatBytes(bytes?: number): string | null {
  if (bytes === undefined) return null;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

// Human descriptor per `EnergyMeasurement.scope` — the guard against
// mislabelling a board-level carrier-rail delta as "NPU power"/"silicon
// energy". An unrecognized scope falls back to its raw string rather than
// assuming what it means.
const ENERGY_SCOPE_LABEL: Record<string, string> = {
  "carrier-rail-delta": "measured delta",
};

function energyLabel(e: EnergyView): string {
  const descriptor = ENERGY_SCOPE_LABEL[e.scope] ?? e.scope;
  const rail = e.rails.length === 1 ? "rail" : "rails";
  const spread = e.spread_mj !== null ? `, ±${e.spread_mj.toFixed(4)}` : "";
  return (
    `Inference energy (${descriptor}, ${rail} ${e.rails.join("+")}): ` +
    `${e.value_mj_per_inference.toFixed(4)} mJ/inference ` +
    `(avg of ${e.n_inferences}${spread})`
  );
}

function Badge({
  variant,
  label,
  title,
}: {
  variant: BadgeVariant;
  label: string;
  title?: string;
}) {
  return (
    <span className={styles.badge} data-variant={variant} title={title}>
      {label}
    </span>
  );
}

/** Renders `issues` prominently when the merged list/doctor envelope failed
 *  (`ok:false` — e.g. the actionable "update tan" message); a quieter list
 *  otherwise, since non-fatal issues can ride along on an `ok:true` payload. */
function IssuesBanner({
  ok,
  issues,
}: {
  ok: boolean;
  issues: ModelsDataMessage["issues"];
}) {
  if (issues.length === 0) return null;
  return (
    <div className={styles.issues} data-ok={ok} role={ok ? undefined : "alert"}>
      {!ok && <p className={styles.issuesHead}>Models unavailable</p>}
      <ul className={styles.issuesList}>
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} data-severity={issue.severity}>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Renders the `tan model prep` accuracy report (fp32-vs-int8): the issues
 *  banner on failure, or the quantized path + verdict badge + numbers on
 *  success. Thin: all accuracy math comes from the envelope, not computed here. */
function PrepReport({ prep }: { prep: PrepResult }) {
  if (!prep.ok) {
    // A contract-violating `!ok` result with no issues would otherwise render
    // nothing (IssuesBanner returns null on an empty list) — never fail silently.
    const issues =
      prep.issues.length > 0
        ? prep.issues
        : [
            {
              code: "modelPrep.failed",
              severity: "error",
              message: "Model prep failed (no diagnostic).",
            },
          ];
    return <IssuesBanner ok={false} issues={issues} />;
  }
  const a = prep.accuracy;
  const variant: BadgeVariant = a?.verdict === "good" ? "ok" : "warn";
  return (
    <div className={styles.issues} data-ok={true}>
      <p className={styles.issuesHead}>Prep result</p>
      {prep.quantized && <p className={styles.mono}>{prep.quantized}</p>}
      {a && (
        <>
          <Badge variant={variant} label={`accuracy: ${a.verdict}`} />
          <p className={styles.suggestion}>
            top1 {a.top1_agreement_pct}% · cosine {a.mean_cosine} · max err{" "}
            {a.max_abs_err} · n={a.samples}
          </p>
          {a.guidance && <p className={styles.suggestion}>{a.guidance}</p>}
        </>
      )}
    </div>
  );
}

/** Renders the `tan model run` host reference measurement: the issues banner
 *  on failure (never silent), or backend + latency + power/SRAM ("n/a" when
 *  null, never fabricated) + accuracy + the honesty `note` on success. */
function RunReport({
  ok,
  run,
  issues,
}: {
  ok: boolean;
  run: RunResultView | null;
  issues: ModelsDataMessage["issues"];
}) {
  if (!ok) {
    const bannerIssues =
      issues.length > 0
        ? issues
        : [
            {
              code: "modelRun.failed",
              severity: "error",
              message: "Model run failed (no diagnostic).",
            },
          ];
    return <IssuesBanner ok={false} issues={bannerIssues} />;
  }
  if (!run) return null;
  return (
    <div className={styles.issues} data-ok={true}>
      <p className={styles.issuesHead}>Run result</p>
      <Badge variant="warn" label={run.backend} />
      <p className={styles.suggestion}>
        {run.latency_ms.toFixed(2)} ms · {run.runs} run(s)
        {run.random_input ? " · random input" : ""} · argmax{" "}
        {run.output_argmax ?? "n/a"}
      </p>
      <p className={styles.suggestion}>
        power: {run.power_mj ?? "n/a"} mJ · peak SRAM:{" "}
        {run.peak_sram_kib ?? "n/a"} KiB
      </p>
      {run.energy && (
        <p className={styles.suggestion}>{energyLabel(run.energy)}</p>
      )}
      {run.accuracy && (
        <Badge
          variant={run.accuracy.match ? "ok" : "err"}
          label={`expected ${run.accuracy.expected} — ${run.accuracy.match ? "match" : "mismatch"}`}
        />
      )}
      <p className={styles.hint}>{run.note}</p>
    </div>
  );
}

/** Renders the `tan model ab` head-to-head comparison: the issues banner on
 *  failure (never silent), or both models' latency + the comparison verdict
 *  + the honesty `note` on success. */
function AbReport({
  ok,
  ab,
  issues,
}: {
  ok: boolean;
  ab: AbResultView | null;
  issues: ModelsDataMessage["issues"];
}) {
  if (!ok) {
    const bannerIssues =
      issues.length > 0
        ? issues
        : [
            {
              code: "modelAb.failed",
              severity: "error",
              message: "Model A/B compare failed (no diagnostic).",
            },
          ];
    return <IssuesBanner ok={false} issues={bannerIssues} />;
  }
  if (!ab) return null;
  return (
    <div className={styles.issues} data-ok={true}>
      <p className={styles.issuesHead}>A/B result</p>
      <p className={styles.mono}>
        A: {ab.a.model} — {ab.a.backend} · {ab.a.latency_ms.toFixed(2)} ms
      </p>
      {ab.a.energy && (
        <p className={styles.suggestion}>{energyLabel(ab.a.energy)}</p>
      )}
      <p className={styles.mono}>
        B: {ab.b.model} — {ab.b.backend} · {ab.b.latency_ms.toFixed(2)} ms
      </p>
      {ab.b.energy && (
        <p className={styles.suggestion}>{energyLabel(ab.b.energy)}</p>
      )}
      <Badge
        variant="ok"
        label={`${ab.comparison.faster} faster (${ab.comparison.latency_ratio ?? "n/a"}x)`}
      />
      <p className={styles.suggestion}>
        size delta: {ab.comparison.size_delta_bytes ?? "n/a"} bytes
      </p>
      {ab.comparison.energy_delta_mj_per_inference !== undefined && (
        <p className={styles.suggestion}>
          energy delta (B − A): {ab.comparison.energy_delta_mj_per_inference}{" "}
          mJ/inference
        </p>
      )}
      <p className={styles.hint}>{ab.note}</p>
    </div>
  );
}

/** One backend's coverage badge, e.g. `Ethos-U85: all ops NPU-eligible`.
 *  Every entry tan sent is rendered — no per-backend collapse: `tan model
 *  check` emits exactly one report per declared backend, and collapsing would
 *  only be a way to hide one of them if that ever stopped being true. */
function CoverageBadges({ backends }: { backends?: BackendCoverage[] }) {
  if (!backends || backends.length === 0) {
    return <span className={styles.hint}>—</span>;
  }
  return (
    <>
      {backends.map((b, i) => {
        const badge = coverageBadge(b);
        return (
          <Badge
            key={`${b.backend}-${i}`}
            variant={badge.variant}
            title={badge.title}
            label={`${backendLabel(b.backend, b.variant)}: ${badge.label}`}
          />
        );
      })}
    </>
  );
}

/** One backend's detail block. Mirrors `tan model check --format text`'s own
 *  `render_backend_report`, including its two suppressions: on a proven
 *  (`basis: compiled|bench`) report neither the op-derived percentage nor the
 *  certain-CPU list is drawn, because tan keeps the STATIC per-op verdicts
 *  alongside the real placement and the two can legitimately disagree. Notes
 *  are tan's own words, rendered verbatim — they carry the caveats, the
 *  refusals and the remediation commands. */
function CoverageBackendBlock({
  backend,
  sku,
}: {
  backend: BackendCoverage;
  sku?: string;
}) {
  const badge = coverageBadge(backend);
  const detail = coverageDetail(backend);
  const cpuOps = cpuCertainOps(backend);
  return (
    <div className={styles.coverageBackend}>
      <p className={styles.coverageHead}>
        <span className={styles.mono}>
          {backendLabel(backend.backend, backend.variant)}
          {sku ? ` (${sku})` : ""}
        </span>
        <Badge
          variant={badge.variant}
          label={badge.label}
          title={badge.title}
        />
        <span className={styles.bytes}>{basisSummary(backend)}</span>
      </p>
      {detail && <p className={styles.suggestion}>{detail}</p>}
      {cpuOps && <p className={styles.suggestion}>{cpuOps}</p>}
      {(backend.notes ?? []).map((note, i) => (
        <p key={i} className={styles.hint}>
          {note}
        </p>
      ))}
    </div>
  );
}

/** The detail behind the table's badges: what was screened, on what basis,
 *  and every caveat tan attached — plus the two standing caveats the badges
 *  alone cannot carry (a static positive is eligibility, not a promise; "not
 *  determined" is absent data, not a negative verdict). */
function CoverageReport({
  models,
  sku,
}: {
  models: ModelCoverage[];
  sku?: string;
}) {
  if (models.length === 0) return null;
  const backends = models.flatMap((m) => m.backends ?? []);
  const anyScreened = backends.some((b) => !isProven(b.basis));
  const anyUndetermined = backends.some(
    (b) => b.npuCoverage === "undetermined",
  );
  return (
    <section className={styles.section} aria-labelledby="coverage-title">
      <h3 id="coverage-title" className={styles.sectionTitle}>
        NPU coverage detail
      </h3>
      {anyScreened && <p className={styles.hint}>{STATIC_SCREEN_CAVEAT}</p>}
      {anyUndetermined && <p className={styles.hint}>{UNDETERMINED_CAVEAT}</p>}
      {models.map((m) => (
        <div key={m.name} className={styles.coverageModel}>
          <p className={styles.coverageModelHead}>
            <span className={styles.mono}>{m.name}</span>
            {m.source && <span className={styles.bytes}>{m.source}</span>}
          </p>
          {(m.backends ?? []).length === 0 ? (
            <p className={styles.hint}>
              No NPU backend was screened for this model.
            </p>
          ) : (
            (m.backends ?? []).map((b, i) => (
              <CoverageBackendBlock
                key={`${b.backend}-${i}`}
                backend={b}
                sku={sku}
              />
            ))
          )}
        </div>
      ))}
    </section>
  );
}

function ModelRow({
  model,
  coverage,
  building,
  onBuild,
}: {
  model: ModelListEntry;
  coverage?: ModelCoverage;
  building: boolean;
  onBuild: () => void;
}) {
  const variant = artifactVariant(model.artifact);
  const bytes = formatBytes(model.artifact?.bytes);
  return (
    <tr>
      <td className={styles.mono}>{model.name}</td>
      <td className={styles.mono}>{model.source}</td>
      <td>
        <Badge variant={variant} label={ARTIFACT_LABEL[variant]} />
        {bytes && <span className={styles.bytes}>{bytes}</span>}
      </td>
      <td>
        <CoverageBadges backends={coverage?.backends} />
      </td>
      <td>
        <Button appearance="secondary" onClick={onBuild} disabled={building}>
          Build
        </Button>
      </td>
    </tr>
  );
}

// The toolchain doctor's `reason` is guidance text only — never a download
// link (public repo; no login-gated vendor URLs shipped to the webview).
function ToolchainRow({ toolchain }: { toolchain: ModelToolchain }) {
  return (
    <tr>
      <td className={styles.mono}>{toolchain.backend}</td>
      <td className={styles.mono}>{toolchain.tool || "—"}</td>
      <td>
        <Badge
          variant={toolchain.available ? "ok" : "err"}
          label={toolchain.available ? "available" : "missing"}
        />
      </td>
      <td>
        {toolchain.available
          ? (toolchain.version ?? "—")
          : (toolchain.reason ?? "—")}
      </td>
    </tr>
  );
}

/** One curated zoo entry card: task + description, a runs-here badge (honest
 *  about entries that don't validate on this board rather than hiding them),
 *  and an Add button that's disabled for the duration of any in-flight add. */
function ZooCard({
  entry,
  adding,
  onAdd,
}: {
  entry: ZooEntryView;
  adding: boolean;
  onAdd: () => void;
}) {
  return (
    <div className={styles.zooCard}>
      <div className={styles.zooCardHead}>
        <span className={styles.mono}>{entry.task}</span>
        {entry.runs_here === true && <Badge variant="ok" label="runs here" />}
        {entry.runs_here === false && (
          <Badge variant="warn" label="not validated here" />
        )}
      </div>
      <p className={styles.suggestion}>{entry.description}</p>
      <p className={styles.hint}>{entry.license}</p>
      <Button disabled={adding} onClick={onAdd}>
        Add
      </Button>
    </div>
  );
}

export function ModelsView() {
  const {
    ok,
    models,
    toolchains,
    issues,
    buildLog,
    building,
    build,
    refresh,
    coverage,
    coverageSku,
    coverageOk,
    coverageIssues,
    checkingCoverage,
    checkCoverage,
    prep,
    prepping,
    prepModel,
    measuring,
    runOk,
    runResult,
    runIssues,
    abOk,
    abResult,
    abIssues,
    runModel,
    abModels,
    zoo,
    zooOk,
    zooIssues,
    adding,
    addOk,
    addIssues,
    addFromZoo,
    cliModelSurfaceMissing,
  } = useModels();

  // A capability gap, not a failure: the actions below cannot work against
  // this CLI at all, so offering them as clickable is an invitation to a
  // refusal the customer did not ask for.
  const cliUnsupported = Boolean(cliModelSurfaceMissing);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Models</h1>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.configLink}
              onClick={() =>
                postMessage({
                  type: "runCommand",
                  command: "alp.openConfigurator",
                })
              }
            >
              Edit models in Configurator
            </button>
            <Button
              onClick={checkCoverage}
              disabled={checkingCoverage || cliUnsupported}
            >
              {checkingCoverage ? "Checking…" : "Check NPU coverage"}
            </Button>
            <Button onClick={prepModel} disabled={prepping || cliUnsupported}>
              {prepping ? "Prepping…" : "Prep model"}
            </Button>
            <Button onClick={runModel} disabled={measuring || cliUnsupported}>
              {measuring ? "Measuring…" : "Run model"}
            </Button>
            <Button onClick={abModels} disabled={measuring || cliUnsupported}>
              A/B compare
            </Button>
            <Button appearance="secondary" onClick={refresh}>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {cliModelSurfaceMissing && (
        <div className={styles.issues} data-ok="true">
          <p>
            <strong>These model tools need a newer CLI.</strong> The installed
            tan implements only <code>model build</code>. NPU coverage, prep,
            run, A/B compare and the model zoo are unavailable until it provides
            them — building models still works.
          </p>
          <ul className={styles.issuesList}>
            <li data-severity="info">{cliModelSurfaceMissing.message}</li>
          </ul>
        </div>
      )}
      <IssuesBanner ok={ok} issues={issues} />
      <IssuesBanner ok={coverageOk} issues={coverageIssues} />
      {prep && !cliUnsupported && <PrepReport prep={prep} />}
      {(runResult || !runOk) && !cliUnsupported && (
        <RunReport ok={runOk} run={runResult} issues={runIssues} />
      )}
      {(abResult || !abOk) && !cliUnsupported && (
        <AbReport ok={abOk} ab={abResult} issues={abIssues} />
      )}

      <section className={styles.section} aria-labelledby="models-title">
        <div className={styles.sectionHead}>
          <h3 id="models-title" className={styles.sectionTitle}>
            Models
          </h3>
          <Button
            appearance="secondary"
            onClick={() => build()}
            disabled={building || models.length === 0}
          >
            Build all
          </Button>
        </div>
        {models.length === 0 ? (
          <EmptyState
            icon={<Icon name="package" size={28} />}
            title="No models configured"
            description="Add a model under board.yaml's models: list to compile it into a .alpmodel artifact."
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th>Artifact</th>
                <th>NPU coverage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <ModelRow
                  key={m.name}
                  model={m}
                  coverage={coverage.find((c) => c.name === m.name)}
                  building={building}
                  onBuild={() => build(m.name)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CoverageReport models={coverage} sku={coverageSku} />

      <section className={styles.section} aria-labelledby="zoo-title">
        <h3 id="zoo-title" className={styles.sectionTitle}>
          Model zoo
        </h3>
        {!addOk && !cliUnsupported && (
          <IssuesBanner
            ok={false}
            issues={
              addIssues.length > 0
                ? addIssues
                : [
                    {
                      code: "zooAdd.failed",
                      severity: "error",
                      message: "Add failed.",
                    },
                  ]
            }
          />
        )}
        {!zooOk && !cliUnsupported ? (
          <IssuesBanner
            ok={false}
            issues={
              zooIssues.length > 0
                ? zooIssues
                : [
                    {
                      code: "zoo.failed",
                      severity: "error",
                      message: "Model zoo unavailable (no diagnostic).",
                    },
                  ]
            }
          />
        ) : zoo.length === 0 ? (
          <p className={styles.hint}>No zoo entries available.</p>
        ) : (
          <div className={styles.zooGrid}>
            {zoo.map((entry) => (
              <ZooCard
                key={entry.id}
                entry={entry}
                adding={adding}
                onAdd={() => addFromZoo(entry.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="toolchains-title">
        <h3 id="toolchains-title" className={styles.sectionTitle}>
          NPU toolchains
        </h3>
        {toolchains.length === 0 ? (
          <p className={styles.hint}>No toolchain doctor data yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Backend</th>
                <th>Tool</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {toolchains.map((t, i) => (
                <ToolchainRow key={`${t.backend}-${i}`} toolchain={t} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {buildLog.length > 0 && (
        <section className={styles.section} aria-labelledby="progress-title">
          <h3 id="progress-title" className={styles.sectionTitle}>
            Build progress {building && <Spinner />}
          </h3>
          <pre className={styles.log}>{buildLog.join("\n")}</pre>
        </section>
      )}
    </div>
  );
}
