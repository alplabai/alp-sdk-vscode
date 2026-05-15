import { StatusChip } from "../components/StatusChip";
import type { AlpIdeState, ChipState } from "../types";
import { postMessage } from "../vscode";

interface Props {
  state: AlpIdeState | null;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export function ProjectSection({ state }: Props) {
  if (!state) {
    return (
      <div className="section">
        <p className="section-title">Project</p>
        <div className="loading-row">
          <vscode-progress-ring />
        </div>
      </div>
    );
  }

  const workspaceOpen = state.workspace.workspaceRoot !== null;
  const boardConfigured = workspaceOpen && state.workspace.boardYamlExists;
  const configChip: ChipState = boardConfigured ? "ready" : "setup-required";

  return (
    <div className="section">
      <p className="section-title">Project</p>
      <div className="setup-rows">
        {/* Workspace / board.yaml row */}
        <div className="setup-row">
          <div className="setup-row-header">
            <span className="setup-row-label">
              {workspaceOpen
                ? basename(state.workspace.workspaceRoot!)
                : "No Workspace"}
            </span>
            <StatusChip state={configChip} />
          </div>

          {workspaceOpen ? (
            boardConfigured ? (
              <p className="setup-row-desc">
                board.yaml configured — project is ready.
              </p>
            ) : (
              <p className="setup-row-desc">
                No board.yaml found. Run the wizard to configure.
              </p>
            )
          ) : (
            <p className="setup-row-desc">
              Open a folder containing an ALP project to get started.
            </p>
          )}

          <div className="setup-row-action">
            <div className="btn-row">
              {!workspaceOpen ? (
                <vscode-button
                  appearance="primary"
                  onClick={() =>
                    postMessage({
                      type: "runCommand",
                      command: "vscode.openFolder",
                    })
                  }
                >
                  Open Folder
                </vscode-button>
              ) : (
                <>
                  <vscode-button
                    appearance={boardConfigured ? "secondary" : "primary"}
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "alp.newProjectWizard",
                      })
                    }
                  >
                    {boardConfigured ? "Update Project" : "New Project"}
                  </vscode-button>
                  {!boardConfigured && (
                    <vscode-button
                      appearance="secondary"
                      onClick={() =>
                        postMessage({
                          type: "runCommand",
                          command: "vscode.openFolder",
                        })
                      }
                    >
                      Open Folder
                    </vscode-button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Scaffold row — only when project is configured */}
        {boardConfigured && (
          <div className="setup-row">
            <div className="setup-row-header">
              <span className="setup-row-label">Scaffold Module</span>
            </div>
            <p className="setup-row-desc">
              Add a new firmware module or component to the project.
            </p>
            <div className="setup-row-action">
              <vscode-button
                onClick={() =>
                  postMessage({
                    type: "runCommand",
                    command: "alp.scaffoldModule",
                  })
                }
              >
                Scaffold
              </vscode-button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
