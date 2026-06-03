import { useAppContext } from "../../shared/AppContext";
import { Button, Skeleton, StatusChip } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import type { AlpIdeState, ChipState } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./SetupView.module.css";

type Severity = "ok" | "blocker" | "warning";
type RemediationKind = "auto" | "guided" | "manual";

interface SetupRow {
  id: string;
  label: string;
  description: string;
  chipState: ChipState;
  severity: Severity;
  version?: string | null;
  action?: { label: string; command: string; kind: RemediationKind };
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SetupView() {
  const { state } = useAppContext();
  if (!state) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>Environment</p>
        <div className={layout.loadingRow}>
          <Skeleton lines={2} />
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

  const bannerKind = allOk ? "ok" : blockers.length > 0 ? "err" : "warn";
  const bannerText = allOk
    ? `✓ All systems ready (${totalCount}/${totalCount})`
    : blockers.length > 0
      ? `${readyCount} of ${totalCount} ready — ${blockers.length} blocker${blockers.length > 1 ? "s" : ""}${warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}`
      : `${readyCount} of ${totalCount} ready — ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`;

  return (
    <div className={layout.section}>
      <div className={layout.sectionTitleRow}>
        <p className={layout.sectionTitle}>Environment</p>
        <button
          className={styles.recheckBtn}
          title="Retry Check"
          aria-label="Retry Check"
          onClick={() =>
            postMessage({ type: "runCommand", command: "alp.ideHub.refresh" })
          }
        >
          ↺
        </button>
      </div>

      <div className={styles.banner} data-kind={bannerKind}>
        <span>{bannerText}</span>
      </div>

      {!allOk && (
        <div className={layout.setupRows}>
          {rows
            .filter((r) => r.severity !== "ok")
            .map((row) => {
              const isOk = row.severity === "ok";
              return (
                <div
                  key={row.id}
                  className={layout.setupRow}
                  data-ok={isOk ? "" : undefined}
                >
                  <div className={layout.setupRowHeader}>
                    <span className={layout.setupRowLabel}>{row.label}</span>
                    <div className={layout.setupRowHeaderRight}>
                      {row.action && !isOk && (
                        <Button
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
                        </Button>
                      )}
                      <StatusChip state={row.chipState} />
                    </div>
                  </div>
                  {!isOk && (
                    <>
                      <p className={layout.setupRowDesc}>{row.description}</p>
                      {row.instruction && (
                        <p className={styles.rowInstruction}>
                          {row.instruction}
                        </p>
                      )}
                    </>
                  )}
                  {isOk && row.version && (
                    <p className={styles.rowVersion}>{row.version}</p>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {state.setup.lastBootstrapAt && (
        <p className={styles.lastBootstrap}>
          Last bootstrap: {relativeTime(state.setup.lastBootstrapAt)}
        </p>
      )}
    </div>
  );
}
