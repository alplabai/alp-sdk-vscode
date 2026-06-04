// SPDX-License-Identifier: Apache-2.0

import type { BoardConfig } from "@alp-sdk/core/board/models";
import type { ConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import type {
  LocalSdkEntry,
  SdkReadinessState,
  SdkRelease,
} from "@alp-sdk/core/sdk/models";
import type { SocCore, SomPreset } from "@alp-sdk/core/sdkCatalogue/models";
import type { ToolchainFixId } from "@alp-sdk/core/toolchain/bootstrapPlan";
import type { ToolchainReport } from "@alp-sdk/core/toolchain/doctor";

// Re-export so callers only need this module.
export type {
  BoardConfig,
  ConfiguratorViewModel,
  LocalSdkEntry,
  SdkRelease,
  SocCore,
  SomPreset,
  ToolchainFixId,
  ToolchainReport,
};

// ---------------------------------------------------------------------------
// Shared state model (extension → webview)
// ---------------------------------------------------------------------------

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState | "unknown";
  /** Locally discovered SDK installations, sorted by version descending. */
  localEntries: LocalSdkEntry[];
}

export interface ToolVersions {
  python: string | null;
  west: string | null;
  cmake: string | null;
  ninja: string | null;
}

export interface SetupStatus {
  pythonAvailable: boolean;
  westAvailable: boolean;
  /** ISO timestamp of the last time the user triggered bootstrap. Null if never. */
  lastBootstrapAt: string | null;
  /** Raw version strings for each build tool, null when not found. */
  toolVersions: ToolVersions;
}

export interface WorkspaceStatus {
  workspaceRoot: string | null;
  boardYamlExists: boolean;
  /** True when a `.west` directory exists at the workspace root. */
  westInitialized: boolean;
}

export interface AlpIdeState {
  sdk: SdkStatus;
  setup: SetupStatus;
  workspace: WorkspaceStatus;
}

export function emptyAlpIdeState(): AlpIdeState {
  return {
    sdk: {
      activePath: null,
      version: null,
      readiness: "unknown",
      localEntries: [],
    },
    setup: {
      pythonAvailable: false,
      westAvailable: false,
      lastBootstrapAt: null,
      toolVersions: { python: null, west: null, cmake: null, ninja: null },
    },
    workspace: {
      workspaceRoot: null,
      boardYamlExists: false,
      westInitialized: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

/** Increment whenever the message protocol changes in a breaking way. */
export const PROTOCOL_VERSION = 2 as const;

export interface StateUpdateMessage {
  type: "stateUpdate";
  /** Protocol version — webview shows a reload prompt on mismatch. */
  _v: typeof PROTOCOL_VERSION;
  state: AlpIdeState;
}

export interface SdkReleasesLoadedMessage {
  type: "sdkReleasesLoaded";
  releases: SdkRelease[];
}

export interface SdkInstallProgressMessage {
  type: "sdkInstallProgress";
  /** Human-readable status line. */
  log: string;
  done: boolean;
  success?: boolean;
}

export interface ProjectTemplatesDataMessage {
  type: "projectTemplatesData";
  templates: ProjectTemplate[];
  modules: E1mModule[];
}

export interface ConfiguratorRenderMessage {
  type: "configuratorRender";
  viewModel: ConfiguratorViewModel;
  board: BoardConfig;
  boardPath: string;
  sdkConnected: boolean;
}

export interface ConfiguratorSavedMessage {
  type: "configuratorSaved";
  boardPath: string;
}

export interface ToolchainReportMessage {
  type: "toolchainReport";
  report: ToolchainReport;
}

export interface HardwareExplorerDataMessage {
  type: "hardwareExplorerData";
  som: SomPreset | null;
  cores: SocCore[];
  sdkConnected: boolean;
}

// --- Build-plan preview (consumes `alp build --plan`, ADR 0014 BuildPlan) ---

export interface BuildPlanToolStep {
  tool: string;
  args: string[];
  cwd: string;
}

export interface BuildPlanGeneratedFile {
  path: string;
  contents: string;
}

export interface BuildPlanSlice {
  coreId: string;
  backend: "zephyr" | "yocto" | "baremetal";
  buildDir: string;
  configArtefacts: BuildPlanGeneratedFile[];
  /** `null` when the planner can't build this core yet (paired with a warning). */
  command: BuildPlanToolStep | null;
  env: Record<string, string>;
}

export interface BuildPlanWarning {
  code: string;
  coreId?: string;
  message: string;
}

export interface BuildPlanData {
  schemaVersion: number;
  generatedBy?: string;
  boardYaml: string;
  sku: string;
  buildRoot: string;
  slices: BuildPlanSlice[];
  sharedArtefacts: BuildPlanGeneratedFile[];
  warnings: BuildPlanWarning[];
}

export interface BuildPlanDataMessage {
  type: "buildPlanData";
  /** The consumed plan, or `null` when it couldn't be produced (see `error`). */
  plan: BuildPlanData | null;
  error?: string;
}

export type ExtToWebviewMessage =
  | StateUpdateMessage
  | SdkReleasesLoadedMessage
  | SdkInstallProgressMessage
  | ProjectTemplatesDataMessage
  | ConfiguratorRenderMessage
  | ConfiguratorSavedMessage
  | ToolchainReportMessage
  | HardwareExplorerDataMessage
  | BuildPlanDataMessage;

// ---------------------------------------------------------------------------
// New-project / existing-project shared types
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  category: "starter" | "example" | "library";
  icon: string;
  /** Relative path inside examples/ directory, if based on an example. */
  sourceDir?: string;
}

export interface E1mModule {
  id: string;
  displayName: string;
  family: string;
}

// ---------------------------------------------------------------------------
// Webview → Extension messages
// ---------------------------------------------------------------------------

export interface ReadyMessage {
  type: "ready";
}

export interface RunCommandMessage {
  type: "runCommand";
  command: string;
}

export interface SelectSdkPathMessage {
  type: "selectSdkPath";
}

export interface RequestSdkReleasesMessage {
  type: "requestSdkReleases";
}

export interface RequestSdkInstallMessage {
  type: "requestSdkInstall";
  version: string;
}

export interface SwitchSdkMessage {
  type: "switchSdk";
  sdkPath: string;
}

export interface OpenUrlMessage {
  type: "openUrl";
  /** Target URL — must be https:// or vscode:// only. */
  url: string;
  /** Human-readable label used for telemetry tracking. */
  label: string;
}

export interface ClosePanelMessage {
  type: "closePanel";
}

export interface CreateNewProjectMessage {
  type: "createNewProject";
  templateId: string;
  moduleId: string;
  projectName: string;
}

export interface OpenExistingProjectMessage {
  type: "openExistingProject";
  /** true = also run west init after opening folder */
  activate: boolean;
}

export interface ConfiguratorUpdateMessage {
  type: "configuratorUpdate";
  board: BoardConfig;
}

export interface SaveBoardConfigMessage {
  type: "saveBoardConfig";
}

export interface ReloadConfiguratorMessage {
  type: "reloadConfigurator";
}

export interface PreviewEffectiveConfigMessage {
  type: "previewEffectiveConfig";
}

export interface RunToolchainFixMessage {
  type: "runToolchainFix";
  fixId: ToolchainFixId;
}

export interface ReloadToolchainMessage {
  type: "reloadToolchain";
}

export interface ReloadHardwareExplorerMessage {
  type: "reloadHardwareExplorer";
}

export interface RequestBuildPlanMessage {
  type: "requestBuildPlan";
}

export type WebviewToExtMessage =
  | ReadyMessage
  | RunCommandMessage
  | SelectSdkPathMessage
  | RequestSdkReleasesMessage
  | RequestSdkInstallMessage
  | SwitchSdkMessage
  | OpenUrlMessage
  | ClosePanelMessage
  | CreateNewProjectMessage
  | OpenExistingProjectMessage
  | SaveBoardConfigMessage
  | ConfiguratorUpdateMessage
  | ReloadConfiguratorMessage
  | PreviewEffectiveConfigMessage
  | RunToolchainFixMessage
  | ReloadToolchainMessage
  | ReloadHardwareExplorerMessage
  | RequestBuildPlanMessage;
