import { useMemo } from "react";
import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import {
  Button,
  Icon,
  Skeleton,
  StatusChip,
  Stepper,
  StepperNav,
} from "../../shared/ui";
import type { AlpIdeState } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./SetupFlowView.module.css";

// ---------------------------------------------------------------------------
// Step definitions (stable reference — defined at module scope)
// ---------------------------------------------------------------------------

const STEPS: StepDef[] = [
  { id: "env", title: "Environment" },
  { id: "workspace", title: "Workspace" },
  { id: "sdk", title: "SDK" },
];

// ---------------------------------------------------------------------------
// Step-specific content components
// ---------------------------------------------------------------------------

function EnvStep({ state }: { state: AlpIdeState }) {
  const { pythonAvailable, westAvailable } = state.setup;
  const allReady = pythonAvailable && westAvailable;

  return (
    <>
      <p className={styles.stepHeading}>Build tool availability</p>
      <div className={styles.checkList}>
        <div className={styles.checkRow}>
          <span className={styles.checkLabel}>Python 3</span>
          <StatusChip state={pythonAvailable ? "ready" : "not-installed"} />
        </div>
        <div className={styles.checkRow}>
          <span className={styles.checkLabel}>west CLI</span>
          <StatusChip state={westAvailable ? "ready" : "not-installed"} />
        </div>
      </div>
      {!allReady && (
        <div className={styles.actionRow}>
          <Button
            appearance="primary"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.installDependencies",
              })
            }
          >
            Run Bootstrap
          </Button>
        </div>
      )}
      <p className={styles.stepDesc}>
        Bootstrap installs Python, west, and other host dependencies required to
        build Alp SDK firmware.
      </p>
    </>
  );
}

function WorkspaceStep({ state }: { state: AlpIdeState }) {
  const { workspaceRoot, westInitialized } = state.workspace;
  const workspaceOpen = workspaceRoot !== null;

  return (
    <>
      <p className={styles.stepHeading}>West workspace status</p>
      <div className={styles.checkList}>
        <div className={styles.checkRow}>
          <span className={styles.checkLabel}>Folder open</span>
          <StatusChip state={workspaceOpen ? "ready" : "setup-required"} />
        </div>
        <div className={styles.checkRow}>
          <span className={styles.checkLabel}>West initialized</span>
          <StatusChip
            state={
              !workspaceOpen
                ? "setup-required"
                : westInitialized
                  ? "ready"
                  : "not-updated"
            }
          />
        </div>
      </div>
      <div className={styles.actionRow}>
        {!workspaceOpen && (
          <Button
            appearance="primary"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "vscode.openFolder",
              })
            }
          >
            Open Folder
          </Button>
        )}
        {workspaceOpen && !westInitialized && (
          <Button
            appearance="primary"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.bootstrap",
              })
            }
          >
            Initialize Workspace
          </Button>
        )}
      </div>
      <p className={styles.stepDesc}>
        Open a folder that contains your Alp project, then run Bootstrap to
        create the <code>.west</code> directory and fetch all modules.
      </p>
    </>
  );
}

function SdkStep({ state }: { state: AlpIdeState }) {
  const { readiness, version } = state.sdk;
  const isReady = readiness === "ready";

  return (
    <>
      <p className={styles.stepHeading}>Alp SDK</p>
      <div className={styles.checkList}>
        <div className={styles.checkRow}>
          <span className={styles.checkLabel}>
            {isReady && version ? `Version ${version}` : "Alp SDK"}
          </span>
          <StatusChip
            state={
              isReady
                ? "ready"
                : readiness === "partial"
                  ? "not-updated"
                  : "not-installed"
            }
          />
        </div>
      </div>
      {!isReady && (
        <div className={styles.actionRow}>
          <Button
            appearance="primary"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.ideHub.focus",
              })
            }
          >
            Open SDK Manager
          </Button>
        </div>
      )}
      <p className={styles.stepDesc}>
        {isReady
          ? "The Alp SDK is installed and ready for firmware development."
          : "Install or select an Alp SDK in the SDK Manager to continue."}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SetupFlowView() {
  const { state } = useAppContext();
  const { state: stepper, goNext, goBack } = useStepper(STEPS);

  // Per-step "can advance" conditions
  const canAdvance = useMemo(() => {
    if (!state) return [false, false, false];
    return [
      state.setup.pythonAvailable && state.setup.westAvailable,
      state.workspace.workspaceRoot !== null && state.workspace.westInitialized,
      state.sdk.readiness === "ready",
    ];
  }, [state]);

  const isLoading = !state;

  function handleNext() {
    if (stepper.isLast) {
      postMessage({ type: "closePanel" });
    } else {
      goNext();
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>Alp IDE Setup</h1>
          <button
            className={styles.closeBtn}
            title="Close"
            aria-label="Close setup"
            onClick={() => postMessage({ type: "closePanel" })}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <Stepper steps={stepper.steps} direction="horizontal" />

        <main className={styles.content}>
          {isLoading ? (
            <Skeleton lines={2} />
          ) : (
            <>
              {stepper.currentIndex === 0 && <EnvStep state={state} />}
              {stepper.currentIndex === 1 && <WorkspaceStep state={state} />}
              {stepper.currentIndex === 2 && <SdkStep state={state} />}
            </>
          )}
        </main>

        <StepperNav
          isFirst={stepper.isFirst}
          isLast={stepper.isLast}
          disabled={isLoading || !canAdvance[stepper.currentIndex]}
          finishLabel="Open Alp IDE"
          onBack={goBack}
          onNext={handleNext}
          onCancel={() => postMessage({ type: "closePanel" })}
        />
      </div>
    </div>
  );
}
