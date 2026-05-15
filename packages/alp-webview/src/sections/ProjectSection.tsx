import { StatusChip } from "../components/StatusChip";
import type { AlpIdeState, ChipState } from "../types";
import { postMessage } from "../vscode";

interface Props {
  state: AlpIdeState | null;
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

  const configDesc = boardConfigured
    ? "board.yaml is present. Project is configured."
    : workspaceOpen
      ? "No board.yaml found. Run the wizard to configure your project."
      : "Open a folder containing an ALP project to get started.";

  return (
    <div className="section">
      <p className="section-title">Project</p>
      <div className="setup-rows">
        {/* Configuration row */}
        <div className="setup-row">
          <div className="setup-row-header">
            <span className="setup-row-label">Configuration</span>
            <StatusChip state={configChip} />
          </div>
          <p className="setup-row-desc">{configDesc}</p>
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
                  <vscode-button
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "vscode.openFolder",
                      })
                    }
                  >
                    Open Folder
                  </vscode-button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Scaffold row — only shown when project is configured */}
        {boardConfigured && (
          <div className="setup-row">
            <div className="setup-row-header">
              <span className="setup-row-label">Scaffold Module</span>
            </div>
            <p className="setup-row-desc">
              Add a new firmware module or component to the active project.
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
