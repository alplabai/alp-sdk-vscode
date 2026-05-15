import { StatusChip } from "../components/StatusChip";
import type { AlpIdeState, ChipState } from "../types";
import { postMessage } from "../vscode";

interface Props {
  state: AlpIdeState | null;
}

interface SetupRow {
  id: string;
  label: string;
  description: string;
  chipState: ChipState;
  action?: { label: string; command: string };
}

function deriveRows(state: AlpIdeState): SetupRow[] {
  const sdkChip: ChipState = (() => {
    switch (state.sdk.readiness) {
      case "ready":
        return "ready";
      case "incomplete":
        return "setup-required";
      default:
        return state.sdk.activePath ? "setup-required" : "not-installed";
    }
  })();

  return [
    {
      id: "python",
      label: "Python",
      description: "Required by project scripts and the firmware loader",
      chipState: state.setup.pythonAvailable ? "ready" : "not-installed",
      action: state.setup.pythonAvailable
        ? undefined
        : { label: "Run Bootstrap", command: "alp.bootstrap" },
    },
    {
      id: "west",
      label: "west CLI",
      description: "Zephyr meta-tool for build, flash, and module management",
      chipState: state.setup.westAvailable ? "ready" : "not-installed",
      action: state.setup.westAvailable
        ? undefined
        : { label: "Run Bootstrap", command: "alp.bootstrap" },
    },
    {
      id: "sdk",
      label: "ALP SDK",
      description: "Firmware SDK with board support, libraries, and toolchains",
      chipState: sdkChip,
      action:
        sdkChip !== "ready"
          ? { label: "Install SDK", command: "alp.sdk.install" }
          : undefined,
    },
    {
      id: "workspace",
      label: "Workspace",
      description: "Open a folder or workspace containing a project",
      chipState: state.setup.workspaceOpen ? "ready" : "setup-required",
      action: !state.setup.workspaceOpen
        ? { label: "Open Folder", command: "vscode.openFolder" }
        : undefined,
    },
  ];
}

export function SetupSection({ state }: Props) {
  if (!state) {
    return (
      <div className="section">
        <p className="section-title">Environment</p>
        <div className="loading-row">
          <vscode-progress-ring />
        </div>
      </div>
    );
  }

  const rows = deriveRows(state);
  const issueCount = rows.filter((r) => r.chipState !== "ready").length;

  return (
    <div className="section">
      <p className="section-title">Environment</p>

      <div
        className={`readiness-banner ${issueCount === 0 ? "banner-ok" : "banner-warn"}`}
      >
        {issueCount === 0
          ? "All systems ready"
          : `${issueCount} item${issueCount > 1 ? "s" : ""} need${issueCount === 1 ? "s" : ""} attention`}
      </div>

      <div className="setup-rows">
        {rows.map((row) => (
          <div key={row.id} className="setup-row">
            <div className="setup-row-header">
              <span className="setup-row-label">{row.label}</span>
              <StatusChip state={row.chipState} />
            </div>
            <p className="setup-row-desc">{row.description}</p>
            {row.action && (
              <div className="setup-row-action">
                <vscode-button
                  appearance="secondary"
                  onClick={() =>
                    postMessage({
                      type: "runCommand",
                      command: row.action!.command,
                    })
                  }
                >
                  {row.action.label}
                </vscode-button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
