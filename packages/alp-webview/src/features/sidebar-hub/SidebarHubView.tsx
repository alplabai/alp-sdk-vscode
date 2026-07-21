// SPDX-License-Identifier: Apache-2.0
//
// The Alp IDE side panel, as a webview. Same information architecture as the
// former native tree sidebar — Setup / Workspace / Project / SDK / Build & Flash
// — rendered with the Alp design system (tokens + Icon/StatusChip) so it reads
// as one product instead of a stack of generic tree rows. Pure presentation:
// every row's state comes from `AlpIdeState`, every action posts an allowlisted
// `runCommand`; no domain logic lives here. The full-width Overview hub is a
// separate page (alp.openOverview) and is intentionally NOT duplicated here.

// The real Alp Lab wordmark (shared with the full-width Overview). Imported
// `?inline` so Vite embeds it as a data URI — no host-side asWebviewUri
// plumbing — and painted via CSS `mask` in the theme foreground colour, so it
// reads correctly on both light and dark VS Code themes.
import { useState } from "react";
import alplabLogo from "../../assets/alplab-logo-white.svg?inline";
import { useAppContext } from "../../shared/AppContext";
import { Icon, Skeleton } from "../../shared/ui";
import type { IconName } from "../../shared/ui";
import type { AlpIdeState } from "../../types";
import { getUiState, postMessage, setUiState } from "../../vscode";
import styles from "./SidebarHubView.module.css";

function run(command: string) {
  postMessage({ type: "runCommand", command });
}

type Health = "ok" | "warn" | "idle";

// ── Rows ────────────────────────────────────────────────────────────────────

/** A read-out row: icon + label on the left, a value + health dot on the right.
 *  Clickable when a command is given (the whole row is the target). */
function StatusRow({
  icon,
  label,
  value,
  health,
  command,
}: {
  icon: IconName;
  label: string;
  value: string;
  health: Health;
  command?: string;
}) {
  const Tag = command ? "button" : "div";
  return (
    <Tag
      type={command ? "button" : undefined}
      className={styles.statusRow}
      data-clickable={command ? "" : undefined}
      onClick={command ? () => run(command) : undefined}
    >
      <span className={styles.rowIcon} aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      <span
        className={styles.dot}
        data-health={health}
        aria-label={
          health === "ok"
            ? "ready"
            : health === "warn"
              ? "action needed"
              : "not set"
        }
      />
    </Tag>
  );
}

/** An action row: icon + label + one-line description, whole row is the button.
 *  `disabled` mirrors the tree's gating (e.g. build actions before a workspace
 *  is buildable) — shown, dimmed, and inert rather than hidden. */
function ActionRow({
  icon,
  label,
  desc,
  command,
  disabled,
}: {
  icon: IconName;
  label: string;
  desc?: string;
  command: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.actionRow}
      disabled={disabled}
      onClick={() => run(command)}
    >
      <span className={styles.rowIcon} aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <span className={styles.actionText}>
        <span className={styles.actionLabel}>{label}</span>
        {desc && <span className={styles.actionDesc}>{desc}</span>}
      </span>
      <span className={styles.actionArrow} aria-hidden="true">
        <Icon name="chevronRight" size={14} />
      </span>
    </button>
  );
}

// Section collapse state persists in the webview's own state, keyed by title,
// so a user's expand/collapse choices survive reloads.
const COLLAPSE_KEY = "sidebarSections";
function sectionOpen(title: string, fallback: boolean): boolean {
  const map = getUiState<Record<string, boolean>>(COLLAPSE_KEY, {});
  return title in map ? map[title]! : fallback;
}
function persistSectionOpen(title: string, open: boolean): void {
  const map = getUiState<Record<string, boolean>>(COLLAPSE_KEY, {});
  setUiState(COLLAPSE_KEY, { ...map, [title]: open });
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => sectionOpen(title, defaultOpen));
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      persistSectionOpen(title, next);
      return next;
    });
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        aria-expanded={open}
        onClick={toggle}
      >
        <span
          className={styles.sectionChevron}
          data-open={open ? "" : undefined}
          aria-hidden="true"
        >
          <Icon name="chevronRight" size={12} />
        </span>
        <span className={styles.sectionLabel}>{title}</span>
      </button>
      {open && <div className={styles.rows}>{children}</div>}
    </section>
  );
}

// ── State → view helpers (mirror the retired tree providers) ─────────────────

function sdkValue(sdk: AlpIdeState["sdk"]): string {
  if (sdk.readiness === "ready")
    return sdk.version ? `v${sdk.version}` : "Installed";
  if (sdk.readiness === "partial") return "Update needed";
  if (sdk.activePath) return "Not ready";
  return "Not configured";
}

// ── Main view ────────────────────────────────────────────────────────────────

const BUILD_ACTIONS: Array<{ icon: IconName; label: string; command: string }> =
  [
    { icon: "play", label: "Build", command: "alp.westBuild" },
    { icon: "bolt", label: "Flash (west)", command: "alp.westFlash" },
    {
      icon: "monitor",
      label: "Run (native_sim)",
      command: "alp.westRunNativeSim",
    },
    { icon: "package", label: "Image", command: "alp.westAlpImage" },
    { icon: "rocket", label: "Flash all cores", command: "alp.westAlpFlash" },
    { icon: "bug", label: "Debug", command: "alp.debug" },
    { icon: "cpu", label: "Renode", command: "alp.westAlpRenode" },
    // "West Update" lives in the Workspace section (module maintenance, not a
    // build/flash action) — don't duplicate it here.
    { icon: "x", label: "Clean", command: "alp.westAlpClean" },
  ];

export function SidebarHubView() {
  const { state } = useAppContext();

  if (!state) {
    return (
      <div className={styles.root}>
        <Skeleton lines={6} />
      </div>
    );
  }

  const { sdk, workspace } = state;
  // Readiness gate (matches OverviewView.isAllReady + the status-bar item):
  // Python + west + a ready SDK + an initialized west workspace. tan does not
  // gate (managed/auto-fetched).
  const ready =
    state.setup.pythonAvailable &&
    state.setup.westAvailable &&
    sdk.readiness === "ready" &&
    workspace.westInitialized;
  const wsName = workspace.workspaceRoot
    ? workspace.workspaceRoot
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .pop()
    : null;
  const buildReady = workspace.westInitialized && workspace.boardYamlExists;

  return (
    <div className={styles.root}>
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
        <span className={styles.topTitle}>Alp IDE</span>
      </header>

      <Section title="Setup">
        <ActionRow
          icon="book"
          label="Hub"
          desc="Open the full-width hub"
          command="alp.openHub"
        />
        {!ready && (
          <ActionRow
            icon="wrench"
            label="Finish setup"
            desc="Run the setup wizard"
            command="alp.openSetupFlow"
          />
        )}
      </Section>

      <Section title="Workspace">
        {wsName ? (
          <>
            <StatusRow
              icon="folder"
              label={wsName}
              value={
                workspace.westInitialized ? "Initialized" : "Not initialized"
              }
              health={workspace.westInitialized ? "ok" : "warn"}
            />
            <ActionRow
              icon="refresh"
              label="West Update"
              desc="Fetch & update modules"
              command="alp.westUpdate"
              disabled={!workspace.westInitialized}
            />
          </>
        ) : (
          <ActionRow
            icon="folder"
            label="Open a folder"
            desc="Open a folder to get started"
            command="vscode.openFolder"
          />
        )}
      </Section>

      <Section title="Project" defaultOpen={workspace.boardYamlExists}>
        {workspace.boardYamlExists && wsName ? (
          <StatusRow
            icon="sliders"
            label={wsName}
            value="Active project"
            health="ok"
            command="alp.openConfigurator"
          />
        ) : (
          <ActionRow
            icon="filePlus"
            label="New Project"
            desc="Create or open an Alp project"
            command="alp.newProjectWizard"
          />
        )}
        <ActionRow
          icon="sliders"
          label="Configure Board"
          desc="Open board configurator"
          command="alp.openConfigurator"
          disabled={!workspace.boardYamlExists}
        />
        <ActionRow
          icon="check"
          label="Validate board.yaml"
          command="alp.validateBoardYaml"
          disabled={!workspace.boardYamlExists}
        />
        <ActionRow
          icon="eye"
          label="Preview Config"
          desc="Preview effective config"
          command="alp.previewEffectiveConfig"
          disabled={!workspace.boardYamlExists}
        />
      </Section>

      <Section title="SDK Manager">
        <StatusRow
          icon="package"
          label={sdk.activePath ? "Active SDK" : "No SDK configured"}
          value={sdkValue(sdk)}
          health={sdk.readiness === "ready" ? "ok" : "warn"}
          command="alp.openSdkManager"
        />
        <ActionRow
          icon="download"
          label="Manage SDKs"
          desc="Install, switch, update"
          command="alp.openSdkManager"
        />
      </Section>

      <Section title="Build & Flash" defaultOpen={buildReady}>
        <ActionRow
          icon="eye"
          label="Preview Build Plan"
          desc="Inspect the SDK build plan"
          command="alp.showBuildPlan"
        />
        {BUILD_ACTIONS.map((a) => (
          <ActionRow
            key={a.command}
            icon={a.icon}
            label={a.label}
            command={a.command}
            disabled={!buildReady}
          />
        ))}
      </Section>
    </div>
  );
}
