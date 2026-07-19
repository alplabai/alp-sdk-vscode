import { useAppContext } from "../../shared/AppContext";
import { Button, Icon, Skeleton } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { AlpIdeState } from "../../types";
import { postMessage } from "../../vscode";
import { derivePhase, LADDER_STEPS } from "./phase";
import styles from "./QuickstartView.module.css";

function run(command: string) {
  postMessage({ type: "runCommand", command });
}

// ---------------------------------------------------------------------------
// Per-step body for the ACTIVE row only — a short helper line + its CTA(s).
// The ladder is a launcher: every CTA fires an existing allowlisted command,
// never a wizard hosted inline.
// ---------------------------------------------------------------------------

function EnvironmentBody() {
  return (
    <>
      <p className={styles.helper}>
        Install Python, west, and the Alp SDK toolchain.
      </p>
      <div className={styles.ctaRow}>
        <Button onClick={() => run("alp.installDependencies")}>
          Set Up Environment
        </Button>
      </div>
    </>
  );
}

function ProjectBody() {
  return (
    <>
      <p className={styles.helper}>
        Start a new firmware project, or open one already on disk.
      </p>
      <div className={styles.ctaRow}>
        <Button onClick={() => run("alp.newProjectWizard")}>New Project</Button>
        <Button
          appearance="secondary"
          onClick={() => run("alp.openExistingProject")}
        >
          Open Existing
        </Button>
      </div>
    </>
  );
}

function BoardBody({ state }: { state: AlpIdeState }) {
  const { boardIssueCount } = state.workspace;
  return (
    <>
      <p className={styles.helper}>
        {boardIssueCount > 0
          ? `${boardIssueCount} issue${boardIssueCount === 1 ? "" : "s"} to resolve`
          : "Review board.yaml in the Board Configurator."}
      </p>
      <div className={styles.ctaRow}>
        <Button onClick={() => run("alp.openConfigurator")}>
          Configure Board
        </Button>
      </div>
    </>
  );
}

function BuildBody() {
  return (
    <>
      <p className={styles.helper}>
        Workspace is ready — build the firmware, then flash it to hardware.
      </p>
      <div className={styles.ctaRow}>
        <Button onClick={() => run("alp.westBuild")}>Build</Button>
        <Button appearance="secondary" onClick={() => run("alp.westFlash")}>
          Flash
        </Button>
      </div>
    </>
  );
}

function ActiveBody({ id, state }: { id: string; state: AlpIdeState }) {
  switch (id) {
    case "environment":
      return <EnvironmentBody />;
    case "project":
      return <ProjectBody />;
    case "board":
      return <BoardBody state={state} />;
    case "build":
      return <BuildBody />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main view — the four-step ladder: Environment -> Project -> Board ->
// Build & Flash. The phase is re-derived from state on every render, so a
// step's CTA "demotes" purely by the next step becoming active — no local
// per-step toggle state. NO gray-out: done steps collapse to a checkmark,
// upcoming steps are dim text labels, never disabled buttons.
// ---------------------------------------------------------------------------

export function QuickstartView() {
  const { state } = useAppContext();

  if (!state) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>Quickstart</p>
        <div className={layout.loadingRow}>
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  const phase = derivePhase(state);
  const currentIndex = LADDER_STEPS.findIndex((s) => s.phase === phase);

  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>Quickstart</p>
      <div className={styles.ladder} role="list">
        {LADDER_STEPS.map((step, i) => {
          if (i < currentIndex) {
            return (
              <div
                key={step.id}
                className={styles.row}
                data-status="done"
                role="listitem"
              >
                <span className={styles.check} aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
                <span className={styles.doneLabel}>{step.label}</span>
              </div>
            );
          }
          if (i === currentIndex) {
            return (
              <div
                key={step.id}
                className={styles.row}
                data-status="active"
                role="listitem"
                aria-current="step"
              >
                <p className={styles.activeLabel}>{step.label}</p>
                <ActiveBody id={step.id} state={state} />
              </div>
            );
          }
          return (
            <div
              key={step.id}
              className={styles.row}
              data-status="upcoming"
              role="listitem"
            >
              <span className={styles.upcomingLabel}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
