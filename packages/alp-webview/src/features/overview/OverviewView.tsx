import { useAppContext } from "../../shared/AppContext";
import { Button, Spinner } from "../../shared/ui";
import { StatusChip } from "../../shared/ui/StatusChip";
import type { AlpIdeState, ChipState } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./OverviewView.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envChip(state: AlpIdeState): ChipState {
  if (state.setup.pythonAvailable && state.setup.westAvailable) return "ready";
  if (state.setup.pythonAvailable || state.setup.westAvailable)
    return "not-updated";
  return "not-installed";
}

function envMeta(state: AlpIdeState): string {
  const { pythonAvailable, westAvailable, toolVersions } = state.setup;
  if (pythonAvailable && westAvailable) {
    const parts: string[] = [];
    if (toolVersions.python) parts.push(`Python ${toolVersions.python}`);
    if (toolVersions.west) parts.push(`west ${toolVersions.west}`);
    return parts.join(" · ") || "All tools available";
  }
  const missing: string[] = [];
  if (!pythonAvailable) missing.push("Python");
  if (!westAvailable) missing.push("west");
  return `Missing: ${missing.join(", ")}`;
}

function workspaceChip(state: AlpIdeState): ChipState {
  if (state.workspace.workspaceRoot && state.workspace.westInitialized)
    return "ready";
  if (state.workspace.workspaceRoot) return "not-updated";
  return "setup-required";
}

function workspaceMeta(state: AlpIdeState): string {
  const { workspaceRoot, westInitialized, boardYamlExists } = state.workspace;
  if (!workspaceRoot) return "No folder open";
  const parts: string[] = [];
  if (boardYamlExists) parts.push("board.yaml found");
  parts.push(westInitialized ? "west ready" : "west not initialized");
  return parts.join(" · ");
}

function sdkChip(state: AlpIdeState): ChipState {
  switch (state.sdk.readiness) {
    case "ready":
      return "ready";
    case "partial":
      return "not-updated";
    case "missing":
    case "unknown":
    default:
      return "not-installed";
  }
}

function sdkMeta(state: AlpIdeState): string {
  const { readiness, version, activePath } = state.sdk;
  if (readiness === "ready" && version) return `v${version}`;
  if (readiness === "ready") return "Installed";
  if (readiness === "partial") return "Partial install — update needed";
  if (activePath) return `Path set but not ready`;
  return "Not installed";
}

function isAllReady(state: AlpIdeState): boolean {
  return (
    state.setup.pythonAvailable &&
    state.setup.westAvailable &&
    state.workspace.workspaceRoot !== null &&
    state.workspace.westInitialized &&
    state.sdk.readiness === "ready"
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CardProps {
  icon: string;
  title: string;
  chip: ChipState;
  meta: string;
}

function StatusCard({ icon, title, chip, meta }: CardProps) {
  return (
    <div
      className={styles.card}
      data-state={chip === "ready" ? "ready" : "error"}
    >
      <div className={styles.cardIcon} aria-hidden="true">
        {icon}
      </div>
      <p className={styles.cardTitle}>{title}</p>
      <p className={styles.cardMeta}>{meta}</p>
      <div className={styles.cardChip}>
        <StatusChip state={chip} />
      </div>
    </div>
  );
}

interface ActionItem {
  icon: string;
  label: string;
  desc: string;
  onClick: () => void;
}

function ActionButton({ icon, label, desc, onClick }: ActionItem) {
  return (
    <button className={styles.actionBtn} onClick={onClick}>
      <span className={styles.actionBtnIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.actionBtnLabel}>{label}</span>
      <span className={styles.actionBtnDesc}>{desc}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function OverviewView() {
  const { state } = useAppContext();

  if (!state) {
    return (
      <div className={styles.root}>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>ALP IDE</h1>
          <p className={styles.heroSub}>Loading workspace state…</p>
        </div>
        <div style={{ padding: "var(--space-8) var(--space-10)" }}>
          <Spinner />
        </div>
      </div>
    );
  }

  const allReady = isAllReady(state);

  const actions: ActionItem[] = [
    {
      icon: "🔧",
      label: "Setup Wizard",
      desc: "Step-by-step environment setup",
      onClick: () =>
        postMessage({ type: "runCommand", command: "alp.openSetupFlow" }),
    },
    {
      icon: "📦",
      label: "SDK Manager",
      desc: "Install or switch ALP SDK version",
      onClick: () =>
        postMessage({ type: "runCommand", command: "alp.ideHub.focus" }),
    },
    {
      icon: "✨",
      label: "New Project",
      desc: "Create project from template",
      onClick: () =>
        postMessage({ type: "runCommand", command: "alp.newProjectWizard" }),
    },
    {
      icon: "⚙️",
      label: "Configure Board",
      desc: "Open board.yaml configurator",
      onClick: () =>
        postMessage({ type: "runCommand", command: "alp.openConfigurator" }),
    },
    {
      icon: "🔄",
      label: "Run Bootstrap",
      desc: "Install / update build tools",
      onClick: () =>
        postMessage({
          type: "runCommand",
          command: "alp.installDependencies",
        }),
    },
    {
      icon: "⚙️",
      label: "Settings",
      desc: "ALP IDE extension settings",
      onClick: () =>
        postMessage({ type: "runCommand", command: "alp.openSettings" }),
    },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>ALP IDE</h1>
        <p className={styles.heroSub}>
          {allReady
            ? "Workspace is configured and ready for development."
            : "Complete the steps below to set up your development environment."}
        </p>
      </div>

      <div className={styles.body}>
        {/* Status cards */}
        <section aria-labelledby="status-heading">
          <p id="status-heading" className={styles.sectionLabel}>
            Workspace Status
          </p>
          <div className={styles.cardGrid}>
            <StatusCard
              icon="🐍"
              title="Environment"
              chip={envChip(state)}
              meta={envMeta(state)}
            />
            <StatusCard
              icon="📁"
              title="Workspace"
              chip={workspaceChip(state)}
              meta={workspaceMeta(state)}
            />
            <StatusCard
              icon="🧰"
              title="ALP SDK"
              chip={sdkChip(state)}
              meta={sdkMeta(state)}
            />
          </div>
        </section>

        {/* All-ready banner */}
        {allReady && (
          <div className={styles.readyBanner} role="status">
            <span className={styles.readyIcon} aria-hidden="true">
              ✅
            </span>
            All systems are ready. You can now build and flash ALP SDK
            firmware.
          </div>
        )}

        {/* Quick actions */}
        <section aria-labelledby="actions-heading">
          <p id="actions-heading" className={styles.sectionLabel}>
            Quick Actions
          </p>
          <div className={styles.actionGrid}>
            {actions.map((a) => (
              <ActionButton key={a.label} {...a} />
            ))}
          </div>
        </section>

        {/* Open ALP IDE panel button */}
        <div>
          <Button
            appearance="secondary"
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "alp.ideHub.focus",
              })
            }
          >
            Open ALP IDE Panel
          </Button>
        </div>
      </div>
    </div>
  );
}
