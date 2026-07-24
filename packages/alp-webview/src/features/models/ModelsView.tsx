// SPDX-License-Identifier: Apache-2.0

import { Button, EmptyState, Icon, Spinner } from "../../shared/ui";
import type { ModelsDataMessage } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./ModelsView.module.css";
import type {
  ModelArtifact,
  ModelListEntry,
  ModelToolchain,
} from "./useModels";
import { useModels } from "./useModels";

type BadgeVariant = "ok" | "warn" | "err";

function artifactVariant(artifact?: ModelArtifact): BadgeVariant {
  if (!artifact || !artifact.exists) return "err";
  return artifact.stale ? "warn" : "ok";
}

const ARTIFACT_LABEL: Record<BadgeVariant, string> = {
  ok: "built",
  warn: "stale",
  err: "missing",
};

function formatBytes(bytes?: number): string | null {
  if (bytes === undefined) return null;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function Badge({ variant, label }: { variant: BadgeVariant; label: string }) {
  return (
    <span className={styles.badge} data-variant={variant}>
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

function ModelRow({
  model,
  building,
  onBuild,
}: {
  model: ModelListEntry;
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

export function ModelsView() {
  const { ok, models, toolchains, issues, buildLog, building, build, refresh } =
    useModels();

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
            <Button appearance="secondary" onClick={refresh}>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <IssuesBanner ok={ok} issues={issues} />

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
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <ModelRow
                  key={m.name}
                  model={m}
                  building={building}
                  onBuild={() => build(m.name)}
                />
              ))}
            </tbody>
          </table>
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
