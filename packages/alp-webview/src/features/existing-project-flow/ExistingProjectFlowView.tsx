import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import {
  Button,
  EmptyState,
  Icon,
  Skeleton,
  StatusChip,
  Stepper,
  StepperNav,
} from "../../shared/ui";
import { postMessage } from "../../vscode";
import styles from "./ExistingProjectFlowView.module.css";

const STEPS: StepDef[] = [
  { id: "folder", title: "Folder" },
  { id: "inspect", title: "Inspect" },
  { id: "activate", title: "Activate" },
];

// ---------------------------------------------------------------------------
// Step 1 — Folder
// ---------------------------------------------------------------------------

interface FolderStepProps {
  workspaceRoot: string | null;
}

function FolderStep({ workspaceRoot }: FolderStepProps) {
  return (
    <>
      <p className={styles.stepHeading}>Open project folder</p>
      {workspaceRoot ? (
        <div className={styles.folderCard}>
          <span className={styles.folderIcon} aria-hidden="true">
            <Icon name="folder" size={18} />
          </span>
          <span className={styles.folderPath}>{workspaceRoot}</span>
        </div>
      ) : (
        <EmptyState
          icon={<Icon name="folder" size={28} />}
          title="No folder open"
          description="Open a folder that contains an Alp SDK project."
          action={
            <Button
              appearance="primary"
              onClick={() =>
                postMessage({
                  type: "runCommand",
                  command: "vscode.openFolder",
                })
              }
            >
              Open Folder…
            </Button>
          }
        />
      )}
      {workspaceRoot && (
        <p className={styles.stepDesc}>
          This is the currently open folder. Continue to inspect whether it is
          an Alp project, or{" "}
          <button
            className={styles.inlineLink}
            onClick={() =>
              postMessage({ type: "runCommand", command: "vscode.openFolder" })
            }
          >
            open a different folder
          </button>
          .
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Inspect
// ---------------------------------------------------------------------------

type BoardYamlStatus = "found" | "missing";
type WestStatus = "initialized" | "missing";

interface InspectStepProps {
  boardYamlStatus: BoardYamlStatus;
  westStatus: WestStatus;
  loading: boolean;
}

function InspectStep({
  boardYamlStatus,
  westStatus,
  loading,
}: InspectStepProps) {
  const rows = [
    {
      label: "board.yaml",
      state:
        boardYamlStatus === "found"
          ? ("ready" as const)
          : ("not-installed" as const),
      description:
        boardYamlStatus === "found"
          ? "Alp project configuration found"
          : "No board.yaml found — may not be an Alp project",
    },
    {
      label: "west workspace",
      state:
        westStatus === "initialized"
          ? ("ready" as const)
          : ("setup-required" as const),
      description:
        westStatus === "initialized"
          ? "west.yml and .west/ found"
          : "Run 'west init' to initialise the workspace",
    },
  ];

  return (
    <>
      <p className={styles.stepHeading}>Inspecting project</p>
      {loading ? (
        <Skeleton lines={3} />
      ) : (
        <div className={styles.inspectList}>
          {rows.map(({ label, state, description }) => (
            <div key={label} className={styles.inspectRow}>
              <div className={styles.inspectLeft}>
                <span className={styles.inspectLabel}>{label}</span>
                <span className={styles.inspectDesc}>{description}</span>
              </div>
              <StatusChip state={state} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Activate
// ---------------------------------------------------------------------------

interface ActivateStepProps {
  westStatus: WestStatus;
  onActivate: (full: boolean) => void;
}

function ActivateStep({ westStatus, onActivate }: ActivateStepProps) {
  return (
    <>
      <p className={styles.stepHeading}>Activate the Alp project</p>

      {westStatus === "missing" && (
        <div className={styles.actionCard}>
          <p className={styles.actionTitle}>West workspace not initialised</p>
          <p className={styles.actionDesc}>
            Run <code>west init</code> and <code>west update</code> to fetch the
            SDK and all dependencies before building.
          </p>
          <Button appearance="primary" onClick={() => onActivate(true)}>
            Initialise &amp; Activate
          </Button>
        </div>
      )}

      {westStatus === "initialized" && (
        <div className={styles.actionCard}>
          <p className={styles.actionTitle}>Project is ready</p>
          <p className={styles.actionDesc}>
            The workspace is already initialised. You can open the Alp Overview
            or configure the board.
          </p>
          <div className={styles.btnRow}>
            <Button appearance="primary" onClick={() => onActivate(false)}>
              Open Project
            </Button>
            <Button
              appearance="secondary"
              onClick={() =>
                postMessage({
                  type: "runCommand",
                  command: "alp.openConfigurator",
                })
              }
            >
              Configure Board
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ExistingProjectFlowView() {
  const { state } = useAppContext();
  const { state: stepper, goNext, goBack } = useStepper(STEPS);

  const isLoading = !state;
  const workspaceRoot = state?.workspace?.workspaceRoot ?? null;
  const hasBoardYaml = state?.workspace?.boardYamlExists ?? false;
  const hasWest = state?.workspace?.westInitialized ?? false;

  const boardYamlStatus: BoardYamlStatus = hasBoardYaml ? "found" : "missing";
  const westStatus: WestStatus = hasWest ? "initialized" : "missing";

  const canAdvance = [workspaceRoot !== null, true, false];

  function handleNext() {
    if (!stepper.isLast) goNext();
  }

  function handleActivate(full: boolean) {
    // Act on the ALREADY-OPEN workspace (step 0 requires one), not a folder
    // picker: "Initialise & Activate" (full, west missing) runs Bootstrap
    // (west init/update); "Open Project" (west ready) opens the Alp Overview.
    postMessage({
      type: "runCommand",
      command: full ? "alp.installDependencies" : "alp.openOverview",
    });
  }

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>Open Alp Project</h1>
          <button
            className={styles.closeBtn}
            title="Close"
            aria-label="Close wizard"
            onClick={() => postMessage({ type: "closePanel" })}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <Stepper steps={stepper.steps} direction="horizontal" />

        <main className={styles.content}>
          {isLoading ? (
            <Skeleton lines={4} />
          ) : (
            <>
              {stepper.currentIndex === 0 && (
                <FolderStep workspaceRoot={workspaceRoot} />
              )}
              {stepper.currentIndex === 1 && (
                <InspectStep
                  boardYamlStatus={boardYamlStatus}
                  westStatus={westStatus}
                  loading={isLoading}
                />
              )}
              {stepper.currentIndex === 2 && (
                <ActivateStep
                  westStatus={westStatus}
                  onActivate={handleActivate}
                />
              )}
            </>
          )}
        </main>

        {stepper.currentIndex < 2 && (
          <StepperNav
            isFirst={stepper.isFirst}
            isLast={false}
            disabled={isLoading || !canAdvance[stepper.currentIndex]}
            onBack={goBack}
            onNext={handleNext}
            onCancel={() => postMessage({ type: "closePanel" })}
          />
        )}

        {stepper.currentIndex === 2 && (
          <div className={styles.navBack}>
            <Button appearance="ghost" onClick={goBack}>
              Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
