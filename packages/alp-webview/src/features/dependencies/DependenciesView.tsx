import { useEffect, useState } from "react";
import { Button, Skeleton } from "../../shared/ui";
import type {
  DependencyActionEffect,
  DependencyReport,
  DependencyRow,
  DependencyState,
} from "../../types";
import { onMessage, postMessage } from "../../vscode";
import styles from "./DependenciesView.module.css";

/**
 * What a `null` cell renders as. tan reports `null` when it has no version to
 * give; printing "unknown" invites the reader to go look it up, and printing a
 * guess is worse. One dash, one meaning: tan said nothing here.
 */
const DASH = "—";

type ViewState =
  | { kind: "loading" }
  // A failed run is shown as a failed run. An empty table would read as a
  // clean bill of health.
  | { kind: "error"; message: string }
  | { kind: "ready"; report: DependencyReport };

/**
 * tan's own three counts, and nothing derived from them.
 *
 * There is deliberately no "all good" line here. An older tan caps an absent
 * PATH tool at `warn`, so `fail === 0` is true on a machine with no Ninja —
 * src/toolchain.ts drew that verdict anyway and printed "All required tools
 * present" over a build that cannot run. tan-cli#103 fixed the producer side
 * and shipped in the pinned v0.4.0, but a binary set through `alpSdk.cliPath`
 * can still be older, and a view that invents a verdict is wrong for that
 * reader specifically. The counts ARE the header; the reader draws the
 * conclusion.
 */
function Counts({ counts }: { counts: DependencyReport["counts"] }) {
  return (
    <div className={styles.counts} role="status">
      {(["pass", "warn", "fail"] as const).map((key) => (
        <span key={key} className={styles.count} data-status={key}>
          <span className={styles.countValue}>{counts[key]}</span>
          <span className={styles.countLabel}>{key}</span>
        </span>
      ))}
    </div>
  );
}

function LatestCell({ row }: { row: DependencyRow }) {
  if (!row.latest) return <>{DASH}</>;
  return (
    <>
      <span className={styles.version}>{row.latest.version}</span>
      {row.latest.kind === "pin" && (
        <span
          className={styles.pin}
          title="This extension requires exactly this version"
        >
          pinned
        </span>
      )}
      {/* The only place this panel says "update" — and it means exactly one
          thing: a newer release exists and this row can move to it. */}
      {row.updateAvailable && <span className={styles.update}>update</span>}
    </>
  );
}

/**
 * The button's words, one per REAL effect.
 *
 * "Install" is reserved for a button that installs. Two of the fixes the pinned
 * tan v0.3.1 falls back to (`build-tools`, `zephyr-sdk`) only open a web page,
 * and one starts a whole bootstrap run — labelling those "Install" is a button
 * that lies, and the row stays `warn` after pressing it.
 */
const ACTION_LABELS: Record<DependencyActionEffect, string> = {
  install: "Install",
  "open-docs": "Open install guide",
  bootstrap: "Run bootstrap",
};

/**
 * The wording for `row.state`, which the HOST decided (#466 §1). This map is
 * the only place the words live — core exports the union and no label map, on
 * purpose: a copy on each side of a boundary the webview cannot import across
 * would be a value, and the mirror gate compares types, so nothing would catch
 * the two drifting.
 *
 * "Unknown" is a real answer and reads as one. It covers tan's own `unknown`
 * AND any status the host mapping does not recognise, so a status tan ships
 * next year appears here rather than being labelled with confidence.
 */
const STATE_LABELS: Record<DependencyState, string> = {
  ready: "Ready",
  "will-install": "Will install",
  "needs-you": "Needs you",
  unknown: "Unknown",
};

/**
 * One button for every row the extension can actually install (#466 §2).
 *
 * The COUNT is the `will-install` set and nothing else. A row whose only
 * action opens a web page installs nothing, so counting it would make the
 * number a promise the run cannot keep — and those rows are named in the
 * tooltip rather than silently left out, because "Fix all (2)" over a table
 * showing five red rows reads as a bug unless the button says why.
 *
 * Hidden, not disabled, when there is nothing to install: a permanently greyed
 * button on a healthy machine is furniture.
 *
 * No local "running" state. The host runs this in VS Code's own progress
 * notification, which survives the panel being closed, and pushes a fresh
 * report when it finishes — a spinner here would be a second, drifting answer
 * to "is it still going?".
 */
function FixAllButton({ report }: { report: DependencyReport }) {
  const installable = report.rows.filter((row) => row.state === "will-install");
  if (installable.length === 0) return null;

  const pointerOnly = report.rows.filter(
    (row) => row.action?.effect === "open-docs",
  );
  const skipped =
    pointerOnly.length === 0
      ? ""
      : ` Not included: ${pointerOnly
          .map((row) => row.label)
          .join(", ")} — those open an install page and install nothing.`;

  return (
    <Button
      appearance="primary"
      title={
        `Runs ${installable.length} install${installable.length === 1 ? "" : "s"} one at a time, ` +
        `waiting for each: ${installable.map((row) => row.label).join(", ")}.` +
        skipped
      }
      onClick={() => postMessage({ type: "runFixAll" })}
    >
      Fix all ({installable.length})
    </Button>
  );
}

function ActionCell({
  row,
  onRun,
}: {
  row: DependencyRow;
  onRun: (name: string) => void;
}) {
  // No action is a real answer, not a gap to paper over: tan may know of no
  // command for this tool (`command: null`), a bootstrap may already be
  // running, or the row may simply be passing.
  if (!row.action) return <>{DASH}</>;
  return (
    <Button
      appearance="primary"
      // Every kind carries one — the exact command, the page that will open, or
      // the bootstrap that will run. The user reads it before pressing.
      title={row.action.title}
      // The ROW ID, never the command string. The host resolves it against the
      // report it last sent.
      onClick={() => onRun(row.name)}
    >
      {ACTION_LABELS[row.action.effect]}
    </Button>
  );
}

/**
 * The dependency table. One row per thing, five columns: what it is,
 * installed, latest, status, one action.
 *
 * Rows render in the order the planner emitted them. This view does not sort,
 * filter, group, or decide what is "required" — each of those is a fact about
 * the toolchain, and tan owns those facts. Re-deriving one here is how
 * tan-cli#104/#105 happened.
 */
export function DependenciesView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type !== "dependencyReport") return;
      setView(
        msg.report
          ? { kind: "ready", report: msg.report }
          : { kind: "error", message: msg.error ?? "tan returned no report." },
      );
    });
    postMessage({ type: "ready" });
    return off;
  }, []);

  const refresh = () => {
    setView({ kind: "loading" });
    postMessage({ type: "refreshDependencies" });
  };

  const runAction = (name: string) =>
    postMessage({ type: "runDependencyAction", name });

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>Dependencies</h1>
          <div className={styles.summaryRow}>
            {view.kind === "ready" ? (
              <Counts counts={view.report.counts} />
            ) : (
              <span className={styles.note} role="status">
                {view.kind === "loading" ? "Running checks…" : view.message}
              </span>
            )}
            {view.kind === "ready" && <FixAllButton report={view.report} />}
            <Button
              appearance="secondary"
              onClick={refresh}
              disabled={view.kind === "loading"}
            >
              Refresh
            </Button>
          </div>
          {view.kind === "ready" && view.report.prerequisiteDataUnavailable && (
            <p className={styles.note}>
              The installed tan does not report which prerequisites are missing,
              so only the fixes this extension already knows are offered.
            </p>
          )}
        </header>

        <div className={styles.body}>
          {view.kind === "loading" && (
            <div className={styles.skeletons}>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
          {view.kind === "ready" && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Dependency</th>
                  <th scope="col">Installed</th>
                  <th scope="col">Latest</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.report.rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row" className={styles.name}>
                      <span className={styles.label}>{row.label}</span>
                      <span className={styles.detail}>{row.detail}</span>
                      {/* tan's own `fix` prose, verbatim and display-only. On
                          the rows this extension has no button for it is the
                          ONLY remedy the user gets — and it is never parsed
                          into a command (#347). */}
                      {row.hint && (
                        <span className={styles.detail}>{row.hint}</span>
                      )}
                    </th>
                    <td className={styles.versionCell}>
                      {row.installed ?? DASH}
                    </td>
                    <td className={styles.versionCell}>
                      <LatestCell row={row} />
                    </td>
                    <td>
                      {/* The state word first — Ready / Will install / Needs
                          you — because "do I have to do something?" is the
                          question this panel gets opened with, and `pass` /
                          `warn` / `fail` does not answer it. Computed
                          HOST-side from the (status, action) pair (#466 §1);
                          this view derives nothing. */}
                      <span className={styles.state} data-state={row.state}>
                        {STATE_LABELS[row.state]}
                      </span>
                      {/* tan's word, verbatim, kept underneath — the state
                          above is a summary and must never be the only thing
                          on screen. Not remapped onto a chip vocabulary that
                          would have to guess at a status tan adds later, and
                          not the shared StatusChip, whose "Update Needed"
                          wording means something else at its other call
                          sites. */}
                      <span className={styles.status} data-status={row.status}>
                        {row.status}
                      </span>
                    </td>
                    <td className={styles.action}>
                      <ActionCell row={row} onRun={runAction} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
