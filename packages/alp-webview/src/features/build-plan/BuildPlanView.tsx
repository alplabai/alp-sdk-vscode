import { useState } from "react";
import { Button, Card, EmptyState, Skeleton } from "../../shared/ui";
import type { BuildPlanGeneratedFile, BuildPlanSlice } from "../../types";
import styles from "./BuildPlanView.module.css";
import { useBuildPlan } from "./useBuildPlan";

function commandLine(slice: BuildPlanSlice): string {
  if (!slice.command) return "(no command — not buildable yet)";
  const { tool, args } = slice.command;
  return args.length > 0 ? `${tool} ${args.join(" ")}` : tool;
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
        <span className={styles.chevron} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <code className={styles.filePath}>{file.path}</code>
      </button>
      {open && <pre className={styles.fileContent}>{file.contents}</pre>}
    </li>
  );
}

export function BuildPlanView() {
  const { plan, error, loading, reload, materialise, build } = useBuildPlan();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (path: string) =>
    setExpanded((cur) => (cur === path ? null : path));

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
          icon="🧩"
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
            <Button appearance="primary" onClick={build}>
              Build
            </Button>
          </div>

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
        </div>
      )}
    </div>
  );
}
