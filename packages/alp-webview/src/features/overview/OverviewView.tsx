import { useAppContext } from "../../shared/AppContext";
import type { IconName } from "../../shared/ui";
import { Icon, Skeleton, StatusChip } from "../../shared/ui";
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

function run(command: string) {
  postMessage({ type: "runCommand", command });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span className={styles.bolt} aria-hidden="true">
          <Icon name="bolt" size={18} />
        </span>
        <span className={styles.brandName}>
          ALP<span className={styles.brandLab}>LAB</span>
        </span>
      </div>
      <span className={styles.topDivider} aria-hidden="true" />
      <span className={styles.topTitle}>{subtitle}</span>
    </header>
  );
}

interface StatusCardProps {
  icon: IconName;
  title: string;
  chip: ChipState;
  meta: string;
}

function StatusCard({ icon, title, chip, meta }: StatusCardProps) {
  return (
    <div
      className={styles.statusCard}
      data-state={chip === "ready" ? "ready" : "error"}
    >
      <div className={styles.cardIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </div>
      <p className={styles.cardTitle}>{title}</p>
      <p className={styles.cardMeta}>{meta}</p>
      <div className={styles.cardChip}>
        <StatusChip state={chip} />
      </div>
    </div>
  );
}

interface PanelCardProps {
  icon: IconName;
  title: string;
  desc: string;
  command: string;
}

function PanelCard({ icon, title, desc, command }: PanelCardProps) {
  return (
    <button
      type="button"
      className={styles.panelCard}
      onClick={() => run(command)}
    >
      <span className={styles.panelIcon} aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className={styles.panelBody}>
        <span className={styles.panelTitle}>{title}</span>
        <span className={styles.panelDesc}>{desc}</span>
      </span>
      <span className={styles.panelArrow} aria-hidden="true">
        <Icon name="arrowRight" size={16} />
      </span>
    </button>
  );
}

interface ActionItem {
  icon: IconName;
  label: string;
  command: string;
}

function ActionButton({ icon, label, command }: ActionItem) {
  return (
    <button
      type="button"
      className={styles.actionBtn}
      onClick={() => run(command)}
    >
      <span className={styles.actionBtnIcon} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className={styles.actionBtnLabel}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

const PANELS: PanelCardProps[] = [
  {
    icon: "sliders",
    title: "Board Configurator",
    desc: "Edit board.yaml — cores, chips, OTA, security and IPC.",
    command: "alp.openConfigurator",
  },
  {
    icon: "cpu",
    title: "Hardware Explorer",
    desc: "Inspect SoM compute, on-module chips, E1M pad routes and I2C.",
    command: "alp.openHardwareExplorer",
  },
  {
    icon: "activity",
    title: "Toolchain Doctor",
    desc: "Diagnose build tools and apply one-click fixes.",
    command: "alp.toolchainDoctor",
  },
];

const ACTIONS: ActionItem[] = [
  { icon: "wrench", label: "Setup Wizard", command: "alp.openSetupFlow" },
  { icon: "filePlus", label: "New Project", command: "alp.newProjectWizard" },
  { icon: "download", label: "SDK Manager", command: "alp.openSdkManager" },
  {
    icon: "refresh",
    label: "Run Bootstrap",
    command: "alp.installDependencies",
  },
  { icon: "settings", label: "Settings", command: "alp.openSettings" },
];

export function OverviewView() {
  const { state } = useAppContext();

  if (!state) {
    return (
      <div className={styles.root}>
        <Brand subtitle="ALP IDE" />
        <div className={styles.body}>
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  const allReady = isAllReady(state);

  return (
    <div className={styles.root}>
      <Brand subtitle="ALP IDE" />

      <div className={styles.body}>
        <p className={styles.lead}>
          {allReady
            ? "Workspace is configured and ready for development."
            : "Complete the steps below to set up your development environment."}
        </p>

        {/* Status cards */}
        <section aria-labelledby="status-heading">
          <p id="status-heading" className={styles.sectionLabel}>
            Workspace Status
          </p>
          <div className={styles.cardGrid}>
            <StatusCard
              icon="terminal"
              title="Environment"
              chip={envChip(state)}
              meta={envMeta(state)}
            />
            <StatusCard
              icon="folder"
              title="Workspace"
              chip={workspaceChip(state)}
              meta={workspaceMeta(state)}
            />
            <StatusCard
              icon="package"
              title="ALP SDK"
              chip={sdkChip(state)}
              meta={sdkMeta(state)}
            />
          </div>
        </section>

        {allReady && (
          <div className={styles.readyBanner} role="status">
            <span className={styles.readyIcon} aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
            All systems are ready. You can now build and flash ALP SDK firmware.
          </div>
        )}

        {/* Featured panels */}
        <section aria-labelledby="panels-heading">
          <p id="panels-heading" className={styles.sectionLabel}>
            Panels
          </p>
          <div className={styles.panelGrid}>
            {PANELS.map((p) => (
              <PanelCard key={p.command} {...p} />
            ))}
          </div>
        </section>

        {/* Quick actions */}
        <section aria-labelledby="actions-heading">
          <p id="actions-heading" className={styles.sectionLabel}>
            Quick Actions
          </p>
          <div className={styles.actionGrid}>
            {ACTIONS.map((a) => (
              <ActionButton key={a.command} {...a} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
