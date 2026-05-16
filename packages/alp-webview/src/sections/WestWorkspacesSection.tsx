// SPDX-License-Identifier: Apache-2.0

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

export function WestWorkspacesSection({ state }: Props) {
  if (!state) {
    return (
      <div className="section">
        <p className="section-title">West Workspace</p>
        <div className="loading-row">
          <vscode-progress-ring />
        </div>
      </div>
    );
  }

  const { workspaceRoot, westInitialized } = state.workspace;
  const workspaceOpen = workspaceRoot !== null;
  const westAvailable = state.setup.westAvailable;

  const initChip: ChipState = !workspaceOpen
    ? "setup-required"
    : westInitialized
      ? "ready"
      : "not-updated";

  return (
    <div className="section">
      <p className="section-title">West Workspace</p>
      <div className="setup-rows">
        <div className="setup-row">
          <div className="setup-row-header">
            <span className="setup-row-label">
              {workspaceOpen ? basename(workspaceRoot!) : "No Workspace"}
            </span>
            <StatusChip state={initChip} />
          </div>

          {!workspaceOpen ? (
            <p className="setup-row-desc">
              Open a folder to see west workspace status.
            </p>
          ) : westInitialized ? (
            <p className="setup-row-desc">
              West workspace initialised — modules are tracked.
            </p>
          ) : (
            <p className="setup-row-desc">
              No <code>.west</code> directory found. Run Bootstrap to initialise
              the west workspace and fetch modules.
            </p>
          )}

          {workspaceOpen && (
            <div className="setup-row-action">
              <div className="btn-row">
                {westInitialized ? (
                  <vscode-button
                    appearance="secondary"
                    disabled={!westAvailable || undefined}
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "alp.westUpdate",
                      })
                    }
                  >
                    West Update
                  </vscode-button>
                ) : (
                  <vscode-button
                    appearance="primary"
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "alp.bootstrap",
                      })
                    }
                  >
                    Bootstrap
                  </vscode-button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
