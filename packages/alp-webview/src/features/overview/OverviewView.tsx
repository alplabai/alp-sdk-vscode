// The ALP LAB wordmark logo (a copy of media/alplab-logo-white.svg: bolt + "ALP
// LAB"). Imported with `?inline` so Vite embeds it as a data URI in the bundle —
// no host-side localResourceRoots/asWebviewUri plumbing. The asset is a single
// flat colour, so we paint it via CSS `mask` in `--text-primary` instead of an
// <img>: that keeps it visible on light themes too (a white SVG would vanish on
// the theme-coloured header), while still reading near-white on dark themes.
import alplabLogo from "../../assets/alplab-logo-white.svg?inline";
import { useAppContext } from "../../shared/AppContext";
import type { IconName } from "../../shared/ui";
import { Icon, Skeleton, StatusChip } from "../../shared/ui";
import { SdkView } from "../sdk";
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
    // tan is managed/auto-fetched, so it is info (never gates "available"):
    // show its version when a binary resolved, else that it is managed.
    parts.push(toolVersions.tan ? `tan ${toolVersions.tan}` : "tan managed");
    return parts.join(" · ") || "All tools available";
  }
  const missing: string[] = [];
  if (!pythonAvailable) missing.push("Python");
  if (!westAvailable) missing.push("west");
  return `Missing: ${missing.join(", ")}`;
}

function workspaceChip(state: AlpIdeState): ChipState {
  // The west workspace is the milestone (central/bootstrap). A project folder is
  // optional — open one to edit a specific app, but it isn't required to be set up.
  return state.workspace.westInitialized ? "ready" : "setup-required";
}

function workspaceMeta(state: AlpIdeState): string {
  const { workspaceRoot, westInitialized, boardYamlExists } = state.workspace;
  if (!westInitialized) return "Run Bootstrap to set up the workspace";
  const parts: string[] = ["Workspace ready"];
  if (workspaceRoot && boardYamlExists) parts.push("board.yaml found");
  else if (!workspaceRoot) parts.push("no folder open");
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
    // West workspace (central) is the milestone; an open project folder is optional.
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
      <span
        className={styles.brandLogo}
        style={{
          maskImage: `url("${alplabLogo}")`,
          WebkitMaskImage: `url("${alplabLogo}")`,
        }}
        role="img"
        aria-label="Alp Lab"
      />
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
  /** When set, the card becomes a button that jumps to a related section. */
  onClick?: () => void;
}

function StatusCard({ icon, title, chip, meta, onClick }: StatusCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={styles.statusCard}
      data-state={chip === "ready" ? "ready" : "error"}
      data-clickable={onClick ? "" : undefined}
      onClick={onClick}
    >
      <div className={styles.cardIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </div>
      <p className={styles.cardTitle}>{title}</p>
      <p className={styles.cardMeta}>{meta}</p>
      <div className={styles.cardChip}>
        <StatusChip state={chip} />
      </div>
    </Tag>
  );
}

function scrollToSdkSection(): void {
  document
    .getElementById("sdk-section")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
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

// The Models card is deliberately absent: the panel exists and still opens
// via `alp.openModelsPanel`, but the pinned tan implements only `model build`
// (#522), so it is not advertised until the CLI surface matures. Restore it
// with the sidebar-hub section and the two commandPalette guards — #524.
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
    // The panel this opens is titled "Alp Dependencies"; the tile says the same
    // thing. It promises no fix, because a row only gets a button when tan
    // supplies one — the old "one-click fixes" wording was dead on every
    // machine where tan resolved.
    title: "Dependencies",
    desc: "Every build tool tan checks, with its status and version.",
    command: "alp.openDependencies",
  },
];

const ACTIONS: ActionItem[] = [
  { icon: "wrench", label: "Setup Wizard", command: "alp.openSetupFlow" },
  { icon: "filePlus", label: "New Project", command: "alp.newProjectWizard" },
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
        <Brand subtitle="Alp IDE" />
        <div className={styles.body}>
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  const allReady = isAllReady(state);
  // When everything's set up, Bootstrap / Setup Wizard are noise — lead with
  // Build instead. Before that, keep the setup-oriented actions.
  const actions: ActionItem[] = allReady
    ? [
        { icon: "play", label: "Build", command: "alp.westBuild" },
        {
          icon: "filePlus",
          label: "New Project",
          command: "alp.newProjectWizard",
        },
        { icon: "settings", label: "Settings", command: "alp.openSettings" },
      ]
    : ACTIONS;

  return (
    <div className={styles.root}>
      <Brand subtitle="Alp IDE" />

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
              // A red "Missing"/"Update Needed" chip was a dead end. When tools
              // aren't ready, open Dependencies — the per-tool table of what tan
              // checked and found; a ready environment stays static.
              onClick={
                envChip(state) === "ready"
                  ? undefined
                  : () => run("alp.openDependencies")
              }
            />
            <StatusCard
              icon="folder"
              title="Workspace"
              chip={workspaceChip(state)}
              meta={workspaceMeta(state)}
              // "Action Required" was a dead end — make the card run Bootstrap
              // (same command as the Quick Action) while the west workspace
              // isn't initialized. Once ready, it's a static status card.
              onClick={
                state.workspace.westInitialized
                  ? undefined
                  : () => run("alp.installDependencies")
              }
            />
            <StatusCard
              icon="package"
              title="Alp SDK"
              chip={sdkChip(state)}
              meta={sdkMeta(state)}
              onClick={scrollToSdkSection}
            />
          </div>
        </section>

        {allReady && (
          <div className={styles.readyBanner} role="status">
            <span className={styles.readyIcon} aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
            All systems are ready. You can now build and flash Alp SDK firmware.
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
            {actions.map((a) => (
              <ActionButton key={a.command} {...a} />
            ))}
          </div>
        </section>

        {/* SDK Manager — folded in from the former standalone panel. The
            `alp.openSdkManager` command opens the Hub and scrolls here. */}
        {/* SdkView renders its own "SDK Manager" header + Refresh/Browse, so no
            outer section label here (that would double the heading). */}
        <section aria-label="SDK Manager" id="sdk-section">
          <SdkView />
        </section>
      </div>
    </div>
  );
}
