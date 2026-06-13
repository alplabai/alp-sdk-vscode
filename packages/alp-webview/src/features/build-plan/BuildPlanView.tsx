import { useState } from "react";
import { Button, Card, EmptyState, Icon, Skeleton } from "../../shared/ui";
import type {
  BuildPlanGeneratedFile,
  BuildPlanSlice,
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
 *  per-slice Build/Flash buttons show/hide straight from the manifest: an
 *  `os: off` slice has none; Flash appears only when the slice carries a real
 *  `flash_method` (not the `TBD` placeholder). */
function SystemManifestSection({
  manifest,
  postBuild,
  error,
  buildSlice,
  flashSlice,
}: {
  manifest: SystemManifest | null;
  postBuild: boolean;
  error: string | null;
  buildSlice: (coreId: string) => void;
  flashSlice: (coreId: string) => void;
}) {
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
                {active && (
                  <button
                    type="button"
                    className={styles.sliceBtn}
                    onClick={() => buildSlice(s.core_id)}
                  >
                    Build
                  </button>
                )}
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
    reload,
    materialise,
    build,
    buildSlice,
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
          The per-core plan from <code>alp build --plan</code> — what each slice
          builds, before anything runs.
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
            buildSlice={buildSlice}
            flashSlice={flashSlice}
          />
        </div>
      )}
    </div>
  );
}
