import { useAppContext } from "../../shared/AppContext";
import { Button, Skeleton, StatusChip } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { ChipState } from "../../types";
import { postMessage } from "../../vscode";

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export function ProjectView() {
  const { state } = useAppContext();
  if (!state) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>Project</p>
        <div className={layout.loadingRow}>
          <Skeleton lines={2} />
        </div>
      </div>
    );
  }

  const workspaceOpen = state.workspace.workspaceRoot !== null;
  const boardConfigured = workspaceOpen && state.workspace.boardYamlExists;
  const configChip: ChipState = boardConfigured ? "ready" : "setup-required";

  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>Project</p>
      <div className={layout.setupRows}>
        {/* Workspace / board.yaml row */}
        <div className={layout.setupRow}>
          <div className={layout.setupRowHeader}>
            <span className={layout.setupRowLabel}>
              {workspaceOpen
                ? basename(state.workspace.workspaceRoot!)
                : "No Workspace"}
            </span>
            <StatusChip state={configChip} />
          </div>

          {workspaceOpen ? (
            boardConfigured ? (
              <p className={layout.setupRowDesc}>
                board.yaml configured — project is ready.
              </p>
            ) : (
              <p className={layout.setupRowDesc}>
                No board.yaml found. Run the wizard to configure.
              </p>
            )
          ) : (
            <p className={layout.setupRowDesc}>
              Open a folder containing an ALP project to get started.
            </p>
          )}

          <div className={layout.setupRowAction}>
            <div className={layout.btnRow}>
              {!workspaceOpen ? (
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
              ) : (
                <>
                  <Button
                    appearance={boardConfigured ? "secondary" : "primary"}
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "alp.newProjectWizard",
                      })
                    }
                  >
                    {boardConfigured ? "Update Project" : "New Project"}
                  </Button>
                  {!boardConfigured && (
                    <Button
                      appearance="secondary"
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
                </>
              )}
            </div>
          </div>
        </div>

        {/* Scaffold row — only when project is configured */}
        {boardConfigured && (
          <div className={layout.setupRow}>
            <div className={layout.setupRowHeader}>
              <span className={layout.setupRowLabel}>Scaffold Module</span>
            </div>
            <p className={layout.setupRowDesc}>
              Add a new firmware module or component to the project.
            </p>
            <div className={layout.setupRowAction}>
              <Button
                onClick={() =>
                  postMessage({
                    type: "runCommand",
                    command: "alp.scaffoldModule",
                  })
                }
              >
                Scaffold
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
