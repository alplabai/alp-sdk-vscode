import { StatusChip } from "../components/StatusChip";
import type { AlpIdeState, ChipState } from "../types";
import { postMessage } from "../vscode";

interface Props {
  state: AlpIdeState | null;
}

type Severity = "ok" | "blocker" | "warning";
type RemediationKind = "auto" | "guided" | "manual";

interface SetupRow {
  id: string;
  label: string;
  description: string;
  chipState: ChipState;
  severity: Severity;
  /** Version string shown as a detail line when the tool is available. */
  version?: string | null;
  action?: { label: string; command: string; kind: RemediationKind };
  /** Shown for manual remediations where no automated fix is available. */
  instruction?: string;
}

function deriveRows(state: AlpIdeState): SetupRow[] {
  const { toolVersions } = state.setup;

  const sdkChip: ChipState = (() => {
    switch (state.sdk.readiness) {
      case "ready":
        return "ready";
      case "partial":
        return "setup-required";
      default:
        return state.sdk.activePath ? "setup-required" : "not-installed";
    }
  })();

  const sdkSeverity: Severity =
    sdkChip === "ready"
      ? "ok"
      : sdkChip === "setup-required"
        ? "warning"
        : "blocker";

  const cmakeAvail = toolVersions.cmake !== null;
  const ninjaAvail = toolVersions.ninja !== null;

  return [
    {
      id: "python",
      label: "Python",
      description: "Required by project scripts and the firmware loader",
      chipState: state.setup.pythonAvailable ? "ready" : "not-installed",
      severity: state.setup.pythonAvailable ? "ok" : "blocker",
      version: toolVersions.python,
      action: state.setup.pythonAvailable
        ? undefined
        : {
            label: "Run Bootstrap",
            command: "alp.installDependencies",
            kind: "auto",
          },
    },
    {
      id: "west",
      label: "west CLI",
      description: "Zephyr meta-tool for build, flash, and module management",
      chipState: state.setup.westAvailable ? "ready" : "not-installed",
      severity: state.setup.westAvailable ? "ok" : "blocker",
      version: toolVersions.west,
      action: state.setup.westAvailable
        ? undefined
        : {
            label: "Run Bootstrap",
            command: "alp.installDependencies",
            kind: "auto",
          },
    },
    {
      id: "cmake",
      label: "CMake",
      description: "Build system generator required for firmware compilation",
      chipState: cmakeAvail ? "ready" : "not-installed",
      severity: cmakeAvail ? "ok" : "warning",
      version: toolVersions.cmake,
      action: cmakeAvail
        ? undefined
        : {
            label: "Run Bootstrap",
            command: "alp.installDependencies",
            kind: "auto",
          },
    },
    {
      id: "ninja",
      label: "Ninja",
      description: "Fast build executor used with CMake",
      chipState: ninjaAvail ? "ready" : "not-installed",
      severity: ninjaAvail ? "ok" : "warning",
      version: toolVersions.ninja,
      action: ninjaAvail
        ? undefined
        : {
            label: "Run Bootstrap",
            command: "alp.installDependencies",
            kind: "auto",
          },
    },
    {
      id: "sdk",
      label: "ALP SDK",
      description: "Firmware SDK with board support, libraries, and toolchains",
      chipState: sdkChip,
      severity: sdkSeverity,
      action:
        sdkChip !== "ready"
          ? {
              label: "Open SDK Manager",
              command: "alp.ideHub.focus",
              kind: "guided",
            }
          : undefined,
    },
    {
      id: "workspace",
      label: "Workspace",
      description: "Open a folder or workspace containing a project",
      chipState:
        state.workspace.workspaceRoot !== null ? "ready" : "setup-required",
      severity: state.workspace.workspaceRoot !== null ? "ok" : "warning",
      action:
        state.workspace.workspaceRoot === null
          ? {
              label: "Open Folder",
              command: "vscode.openFolder",
              kind: "manual",
            }
          : undefined,
      instruction:
        state.workspace.workspaceRoot === null
          ? "Use File → Open Folder to open a project directory."
          : undefined,
    },
  ];
}

/** Format an ISO timestamp as a human-readable relative time. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const blockers = rows.filter((r) => r.severity === "blocker");
  const warnings = rows.filter((r) => r.severity === "warning");
  const allOk = blockers.length === 0 && warnings.length === 0;
  const readyCount = rows.filter((r) => r.severity === "ok").length;
  const totalCount = rows.length;

  const bannerClass = allOk
    ? "readiness-banner banner-ok"
    : blockers.length > 0
      ? "readiness-banner banner-err"
      : "readiness-banner banner-warn";

  const bannerText = allOk
    ? `✓ All systems ready (${totalCount}/${totalCount})`
    : blockers.length > 0
      ? `${readyCount} of ${totalCount} ready — ${blockers.length} blocker${blockers.length > 1 ? "s" : ""}${warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}`
      : `${readyCount} of ${totalCount} ready — ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`;

  return (
    <div className="section">
      <div className="section-title-row">
        <p className="section-title">Environment</p>
        <button
          className="recheck-btn"
          title="Re-check environment"
          aria-label="Re-check environment"
          onClick={() =>
            postMessage({ type: "runCommand", command: "alp.ideHub.refresh" })
          }
        >
          ↺
        </button>
      </div>

      <div className={bannerClass}>
        <span>{bannerText}</span>
      </div>

      <div className="setup-rows">
        {rows.map((row) => {
          const isOk = row.severity === "ok";
          return (
            <div
              key={row.id}
              className={`setup-row${isOk ? " setup-row-ok" : ""}`}
            >
              <div className="setup-row-header">
                <span className="setup-row-label">{row.label}</span>
                <div className="setup-row-header-right">
                  {row.action && !isOk && (
                    <vscode-button
                      appearance={
                        row.action.kind === "auto" ? "primary" : "secondary"
                      }
                      onClick={() =>
                        postMessage({
                          type: "runCommand",
                          command: row.action!.command,
                        })
                      }
                    >
                      {row.action.label}
                    </vscode-button>
                  )}
                  <StatusChip state={row.chipState} />
                </div>
              </div>
              {!isOk && (
                <>
                  <p className="setup-row-desc">{row.description}</p>
                  {row.instruction && (
                    <p className="setup-row-instruction">{row.instruction}</p>
                  )}
                </>
              )}
              {isOk && row.version && (
                <p className="setup-row-version">{row.version}</p>
              )}
            </div>
          );
        })}
      </div>

      {state.setup.lastBootstrapAt && (
        <p className="setup-last-bootstrap">
          Last bootstrap: {relativeTime(state.setup.lastBootstrapAt)}
        </p>
      )}
    </div>
  );
}
