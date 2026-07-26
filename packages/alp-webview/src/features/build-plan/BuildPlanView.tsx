import { useState } from "react";
import { Button, Card, EmptyState, Icon, Skeleton } from "../../shared/ui";
import type {
  BuildPlanGeneratedFile,
  BuildPlanSlice,
  SizeReport,
  SliceSize,
  SystemManifest,
} from "../../types";
import styles from "./BuildPlanView.module.css";
import { useBuildPlan } from "./useBuildPlan";

function commandLine(slice: BuildPlanSlice): string {
  if (!slice.command) return "(no command — not buildable yet)";
  const { tool, args } = slice.command;
  return args.length > 0 ? `${tool} ${args.join(" ")}` : tool;
}

const isReady = (value?: string): boolean => !!value && value !== "TBD";

/** The system manifest — the resolved per-core contract (`alp build --manifest`):
 *  slices with their runtime + flash wiring, IPC links, and helper MCUs. The
 *  per-slice Flash button shows/hides straight from the manifest: it appears
 *  only when the slice carries a real `flash_method` (not the `TBD`
 *  placeholder). There is no per-slice Build button — `tan build` has no
 *  `--core` option, so building a single slice isn't a real CLI command. */
/** `99452` -> `97.1 KiB`. Bytes are what tan reports and what a linker map
 *  shows, so both are rendered — the exact figure is the one you act on. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

/** One region as `97.1 KiB / 5.50 MiB (1.7%)`, degrading honestly: a null
 *  `used` means nothing could measure it and a null `total` means no budget
 *  resolved. Neither is rendered as 0 — tan reports null rather than guessing,
 *  and a fabricated 0% would read as "plenty of room left". */
function regionLabel(region: SliceSize["flash"]): string {
  if (region.used === null) return "unknown";
  const used = formatBytes(region.used);
  if (region.total === null) return `${used} (no budget)`;
  const pct = region.pct === null ? "" : ` (${region.pct}%)`;
  return `${used} / ${formatBytes(region.total)}${pct}`;
}

/** Footprint for one slice, or null when `tan size` had no row for it. */
function SliceFootprint({ size }: { size: SliceSize | undefined }) {
  if (!size) return null;
  // A slice with no artefact yet, or one that cannot be measured at all, has
  // no numbers worth a row — say so instead of printing empty regions.
  if (size.status === "not-built" || size.status === "n/a") {
    return (
      <span className={styles.manifestDetail}>
        <span className={styles.sizeStatus} data-size-status={size.status}>
          {size.status === "not-built" ? "not built" : "size n/a"}
        </span>
        {size.budget_note && <span>{size.budget_note}</span>}
      </span>
    );
  }
  return (
    <span className={styles.manifestDetail}>
      <span className={styles.sizeStatus} data-size-status={size.status}>
        {size.status === "over"
          ? "over budget"
          : size.status === "warn"
            ? "near budget"
            : size.status === "no-budget"
              ? "no budget"
              : "in budget"}
      </span>
      <span>FLASH {regionLabel(size.flash)}</span>
      <span>RAM {regionLabel(size.ram)}</span>
      {size.budget_note && <span>{size.budget_note}</span>}
    </span>
  );
}

function SystemManifestSection({
  manifest,
  postBuild,
  error,
  flashSlice,
  sizes,
}: {
  manifest: SystemManifest | null;
  postBuild: boolean;
  error: string | null;
  flashSlice: (coreId: string) => void;
  sizes: SizeReport | null;
}) {
  const sizeByCore = new Map<string, SliceSize>(
    (sizes?.slices ?? []).map((s) => [s.core_id, s]),
  );
  if (!manifest) {
    return error ? (
      <section className={styles.section}>
        <p className={styles.sectionTitle}>System manifest</p>
        <p className={styles.manifestNote}>{error}</p>
      </section>
    ) : null;
  }
  return (
    <section className={styles.section}>
      <p className={styles.sectionTitle}>
        System manifest{" "}
        <span className={styles.manifestBadge}>
          {postBuild ? "post-build" : "projection"}
        </span>
      </p>
      <ul className={styles.manifestSlices}>
        {manifest.slices.map((s) => {
          const active = s.os !== "off";
          return (
            <li key={s.core_id} className={styles.manifestSlice}>
              <span className={styles.coreId}>{s.core_id}</span>
              <span className={styles.backend} data-backend={s.os}>
                {s.os}
              </span>
              <span className={styles.manifestStatus} data-status={s.status}>
                {s.status}
              </span>
              {s.flash_method && (
                <span className={styles.manifestFlash}>{s.flash_method}</span>
              )}
              <code className={styles.manifestTarget}>
                {s.build_dir ?? s.board ?? s.machine ?? s.image ?? s.app ?? "—"}
              </code>
              <span className={styles.manifestActions}>
                {active && isReady(s.flash_method) && (
                  <button
                    type="button"
                    className={styles.sliceBtn}
                    onClick={() => flashSlice(s.core_id)}
                  >
                    Flash
                  </button>
                )}
              </span>
              {/* The status chip alone says `skipped` without saying why, which
               *  is the complaint behind #331 — the manifest already carries
               *  the answer and it was being dropped. `reason` first, because
               *  it is the only one that explains a non-ok slice; then what
               *  the build produced, then where to read the log. Wraps to its
               *  own line via flex-basis so the chip row keeps its shape. */}
              {(s.reason || s.output_artefact || s.log_path) && (
                <span className={styles.manifestDetail}>
                  {s.reason && (
                    <span className={styles.manifestReason}>{s.reason}</span>
                  )}
                  {s.output_artefact && (
                    <span>
                      out{" "}
                      <code className={styles.manifestDetailPath}>
                        {s.output_artefact}
                      </code>
                    </span>
                  )}
                  {s.log_path && (
                    <span>
                      log{" "}
                      <code className={styles.manifestDetailPath}>
                        {s.log_path}
                      </code>
                    </span>
                  )}
                </span>
              )}
              <SliceFootprint size={sizeByCore.get(s.core_id)} />
            </li>
          );
        })}
      </ul>
      {manifest.ipc.length > 0 && (
        <div className={styles.manifestSub}>
          <span className={styles.manifestSubTitle}>IPC</span>
          {manifest.ipc.map((link) => (
            <span key={link.name} className={styles.manifestChip}>
              {link.name} <em>{link.kind}</em> [{link.endpoints.join(" ↔ ")}]
              {link.status && link.status !== "ok" ? ` · ${link.status}` : ""}
              {/* Same gap as the slices above: a degraded link showed its
               *  status but never its reason, which the model already has. */}
              {link.reason ? ` · ${link.reason}` : ""}
            </span>
          ))}
        </div>
      )}
      {manifest.helper_mcus.length > 0 && (
        <div className={styles.manifestSub}>
          <span className={styles.manifestSubTitle}>Helper MCUs</span>
          {manifest.helper_mcus.map((mcu) => (
            <span key={mcu.name} className={styles.manifestChip}>
              {mcu.name} <em>{mcu.chip}</em>
              {!(isReady(mcu.flash_method) && isReady(mcu.firmware_path))
                ? " · firmware TBD"
                : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** A generated file: a toggle showing its path; expands to its contents. */
function FileRow({
  file,
  open,
  onToggle,
}: {
  file: BuildPlanGeneratedFile;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={styles.fileRow}>
      <button
        type="button"
        className={styles.fileToggle}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span
          className={styles.chevron}
          data-open={open || undefined}
          aria-hidden="true"
        >
          <Icon name="chevronRight" size={12} />
        </span>
        <code className={styles.filePath}>{file.path}</code>
      </button>
      {open && <pre className={styles.fileContent}>{file.contents}</pre>}
    </li>
  );
}

export function BuildPlanView() {
  const {
    plan,
    error,
    loading,
    manifest,
    manifestPostBuild,
    manifestError,
    sizes,
    reload,
    materialise,
    build,
    flashSlice,
  } = useBuildPlan();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (path: string) =>
    setExpanded((cur) => (cur === path ? null : path));

  // A slice with no command isn't buildable yet (paired with a warning); the
  // whole-plan build would fail, so gate Build until every slice has a command.
  const unbuildable = plan ? plan.slices.filter((s) => !s.command) : [];
  const canBuild = unbuildable.length === 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <p className={styles.title}>Build Plan</p>
          <Button appearance="secondary" onClick={reload} disabled={loading}>
            Refresh
          </Button>
        </div>
        <p className={styles.subtitle}>
          The per-core build plan — what each slice builds, before anything
          runs.
        </p>
      </header>

      {loading ? (
        <div className={styles.skeletons}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error || !plan ? (
        <EmptyState
          icon={<Icon name="cpu" size={28} />}
          title="No build plan"
          description={
            error ??
            "Open a project with a board.yaml (and a connected SDK) to preview its build plan."
          }
        />
      ) : (
        <div className={styles.body}>
          <div className={styles.meta}>
            <span className={styles.sku}>{plan.sku}</span>
            <span className={styles.metaItem}>
              {plan.slices.length} slice{plan.slices.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className={styles.boardYaml} title={plan.boardYaml}>
            <code>{plan.boardYaml}</code>
          </div>

          <div className={styles.actions}>
            <Button appearance="secondary" onClick={materialise}>
              Materialise
            </Button>
            <Button
              appearance="primary"
              onClick={build}
              disabled={!canBuild}
              title={
                canBuild
                  ? undefined
                  : `${unbuildable.length} slice(s) have no command yet — resolve the warnings before building.`
              }
            >
              Build
            </Button>
          </div>
          {!canBuild && (
            <p className={styles.buildNote}>
              <Icon name="warning" size={12} />
              <span>
                Build unavailable —{" "}
                <strong>{unbuildable.map((s) => s.coreId).join(", ")}</strong>{" "}
                {unbuildable.length === 1 ? "has" : "have"} no command yet.
                Materialise still writes the config artefacts.
              </span>
            </p>
          )}

          <ul className={styles.slices}>
            {plan.slices.map((slice) => (
              <li key={slice.coreId}>
                <Card padding="md" className={styles.slice}>
                  <div className={styles.sliceHead}>
                    <span className={styles.coreId}>{slice.coreId}</span>
                    <span
                      className={styles.backend}
                      data-backend={slice.backend}
                    >
                      {slice.backend}
                    </span>
                  </div>
                  <code className={styles.cmd}>{commandLine(slice)}</code>
                  <div className={styles.sliceMeta}>
                    <span className={styles.buildDir}>{slice.buildDir}</span>
                  </div>
                  {Object.keys(slice.env).length > 0 && (
                    <dl className={styles.env}>
                      {Object.entries(slice.env).map(([key, value]) => (
                        <div key={key} className={styles.envRow}>
                          <dt className={styles.envKey}>{key}</dt>
                          <dd className={styles.envVal}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {slice.configArtefacts.length > 0 && (
                    <ul className={styles.fileList}>
                      {slice.configArtefacts.map((file) => (
                        <FileRow
                          key={file.path}
                          file={file}
                          open={expanded === file.path}
                          onToggle={() => toggle(file.path)}
                        />
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          {plan.sharedArtefacts.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>
                Shared artefacts ({plan.sharedArtefacts.length})
              </p>
              <ul className={styles.fileList}>
                {plan.sharedArtefacts.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    open={expanded === file.path}
                    onToggle={() => toggle(file.path)}
                  />
                ))}
              </ul>
            </section>
          )}

          {plan.warnings.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>
                Warnings ({plan.warnings.length})
              </p>
              <ul className={styles.warnings}>
                {plan.warnings.map((warn, i) => (
                  <li key={`${warn.code}-${i}`} className={styles.warning}>
                    <span className={styles.warnCode}>{warn.code}</span>
                    {warn.coreId && (
                      <span className={styles.warnCore}>{warn.coreId}</span>
                    )}
                    <span className={styles.warnMsg}>{warn.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SystemManifestSection
            manifest={manifest}
            postBuild={manifestPostBuild}
            error={manifestError}
            flashSlice={flashSlice}
            sizes={sizes}
          />
        </div>
      )}
    </div>
  );
}
