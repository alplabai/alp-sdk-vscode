// SPDX-License-Identifier: Apache-2.0

import { StatusChip } from "../../shared/ui/StatusChip";
import layout from "../../shared/ui/layout.module.css";
import type { AlpIdeState, ChipState } from "../../types";
import { postMessage } from "../../vscode";

interface Props {
  state: AlpIdeState | null;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export function WestWorkspacesView({ state }: Props) {
  if (!state) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>West Workspace</p>
        <div className={layout.loadingRow}>
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
    <div className={layout.section}>
      <p className={layout.sectionTitle}>West Workspace</p>
      <div className={layout.setupRows}>
        <div className={layout.setupRow}>
          <div className={layout.setupRowHeader}>
            <span className={layout.setupRowLabel}>
              {workspaceOpen ? basename(workspaceRoot!) : "No Workspace"}
            </span>
            <StatusChip state={initChip} />
          </div>

          {!workspaceOpen ? (
            <p className={layout.setupRowDesc}>
              Open a folder to see west workspace status.
            </p>
          ) : westInitialized ? (
            <p className={layout.setupRowDesc}>
              West workspace initialised — modules are tracked.
            </p>
          ) : (
            <p className={layout.setupRowDesc}>
              No <code>.west</code> directory found. Run Bootstrap to initialise
              the west workspace and fetch modules.
            </p>
          )}

          {workspaceOpen && (
            <div className={layout.setupRowAction}>
              <div className={layout.btnRow}>
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
