// SPDX-License-Identifier: Apache-2.0

import { useAppContext } from "../../shared/AppContext";
import { Button, Icon, Skeleton, StatusChip } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { ChipState } from "../../types";
import { postMessage } from "../../vscode";

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export function WestWorkspacesView() {
  const { state } = useAppContext();
  if (!state) {
    return (
      <div className={layout.section}>
        <div className={layout.sectionTitleRow}>
          <p className={layout.sectionTitle}>West Workspace</p>
        </div>
        <div className={layout.loadingRow}>
          <Skeleton lines={2} />
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
      <div className={layout.sectionTitleRow}>
        <p className={layout.sectionTitle}>West Workspace</p>
        <div className={layout.sectionActions}>
          <button
            className={layout.sectionIconBtn}
            title="New workspace"
            aria-label="New workspace"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.newProjectWizard",
              })
            }
          >
            <Icon name="filePlus" size={14} />
          </button>
          <button
            className={layout.sectionIconBtn}
            title="Switch workspace"
            aria-label="Switch workspace"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.switchWorkspace",
              })
            }
          >
            <Icon name="swap" size={14} />
          </button>
          <button
            className={layout.sectionIconBtn}
            title="Activate workspace"
            aria-label="Activate workspace"
            disabled={!workspaceOpen}
            onClick={() =>
              postMessage({ type: "runCommand", command: "alp.bootstrap" })
            }
          >
            <Icon name="play" size={14} />
          </button>
          <button
            className={layout.sectionIconBtn}
            title="Refresh"
            aria-label="Refresh"
            onClick={() =>
              postMessage({ type: "runCommand", command: "alp.ideHub.refresh" })
            }
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            className={layout.sectionIconBtn}
            title="Save configuration"
            aria-label="Save configuration"
            disabled={!westInitialized}
            onClick={() =>
              postMessage({ type: "runCommand", command: "alp.generateAll" })
            }
          >
            <Icon name="save" size={14} />
          </button>
        </div>
      </div>
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
                  <>
                    <Button
                      appearance="secondary"
                      disabled={!westAvailable}
                      onClick={() =>
                        postMessage({
                          type: "runCommand",
                          command: "alp.westUpdate",
                        })
                      }
                    >
                      West Update
                    </Button>
                    <Button
                      appearance="secondary"
                      onClick={() =>
                        postMessage({
                          type: "runCommand",
                          command: "alp.removeWestInit",
                        })
                      }
                    >
                      Remove Init
                    </Button>
                  </>
                ) : (
                  <Button
                    appearance="primary"
                    onClick={() =>
                      postMessage({
                        type: "runCommand",
                        command: "alp.bootstrap",
                      })
                    }
                  >
                    Bootstrap
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
