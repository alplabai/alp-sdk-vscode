// Types mirrored from src/ideHub/messages.ts — kept in sync manually.
// The webview is a separate build; we do not share source with the extension.

/** Must match PROTOCOL_VERSION in src/ideHub/messages.ts. */
export const PROTOCOL_VERSION = 1 as const;

export type SdkReadinessState = "ready" | "partial" | "missing" | "unknown";

/** Visual state for a readiness status chip. */
export type ChipState =
  | "ready"
  | "setup-required"
  | "not-installed"
  | "not-updated";

export interface LocalSdkEntry {
  path: string;
  version: string | null;
  readiness: SdkReadinessState;
  issues: string[];
}

export interface SdkRelease {
  tag: string;
  publishedAt: string;
  tarballUrl: string;
  releaseNotesSummary: string;
}

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState;
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

// Extension → Webview
export interface StateUpdateMessage {
  type: "stateUpdate";
  _v: number;
  state: AlpIdeState;
}
export interface SdkReleasesLoadedMessage {
  type: "sdkReleasesLoaded";
  releases: SdkRelease[];
}
export interface SdkInstallProgressMessage {
  type: "sdkInstallProgress";
  log: string;
  done: boolean;
  success?: boolean;
}
export interface ProjectTemplatesDataMessage {
  type: "projectTemplatesData";
  templates: ProjectTemplate[];
  modules: E1mModule[];
}

// ── New-project / existing-project shared types ──
export interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  category: "starter" | "example" | "library";
  icon: string;
  sourceDir?: string;
}

export interface E1mModule {
  id: string;
  displayName: string;
  family: string;
}

// ── Configurator (board.yaml) model — mirrored from
//    @alp-sdk/core/configurator/models. The webview is a separate build and
//    cannot import core sources, so these are kept in sync manually. ──
export interface CoreEntry {
  os: "zephyr" | "yocto" | "baremetal" | "off";
  app?: string;
  image?: string;
  peripherals?: string[];
  libraries?: string[];
  inference?: { backend?: string; default_arena_kib?: number };
  iot?: { wifi?: boolean; mqtt?: boolean; ble?: boolean; tls?: boolean };
}

export interface IpcCarveOut {
  name: string;
  endpoints: string[];
  size_kib: number;
}

export interface BoardModel {
  schema_version: number;
  som: { sku: string };
  carrier?: { name: string; populated?: Record<string, boolean> };
  /** v1 only. Absent in schema_version >= 2 (use `cores` instead). */
  os?: string;
  /** v2 only. Per-core runtime + app mapping. */
  cores?: Record<string, CoreEntry>;
  /** v2 only. Cross-core IPC shared-memory carve-outs. */
  ipc?: IpcCarveOut[];
  inference?: { backend?: string; default_arena_kib?: number };
  libraries?: string[];
  iot?: { wifi?: boolean; mqtt?: boolean; ble?: boolean; tls?: boolean };
  diagnostics?: { last_error?: boolean; log_level?: string };
  [key: string]: unknown;
}

export interface CarrierPreset {
  name: string;
  populated: Record<string, boolean>;
}

export interface PresetCatalogue {
  skus: string[];
  carriers: CarrierPreset[];
  libraries: string[];
  inferenceBackends: string[];
  logLevels: string[];
  osChoices: string[];
}

export interface ConfiguratorInitMessage {
  type: "configuratorInit";
  model: BoardModel;
  catalogue: PresetCatalogue;
  boardPath: string;
}

export interface ConfiguratorSavedMessage {
  type: "configuratorSaved";
  boardPath: string;
}

// ── Toolchain Doctor — mirrored from @alp-sdk/core/toolchain/doctor +
//    bootstrapPlan. Kept in sync manually (separate webview build). ──
export type ToolchainFixId =
  | "python-deps"
  | "west"
  | "build-tools"
  | "zephyr-sdk";

export type DoctorCheckStatus = "ok" | "missing" | "warn";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
  required: boolean;
  fixId?: ToolchainFixId;
}

export interface ToolchainReport {
  checks: DoctorCheck[];
  ok: boolean;
  missingRequired: number;
}

export interface ToolchainReportMessage {
  type: "toolchainReport";
  report: ToolchainReport;
}

// ── Hardware Explorer model — mirrored from @alp-sdk/core/sdkCatalogue/models ──
export interface ExplorerPadRoute {
  e1m: string;
  dispatch: string;
  dispatchPin?: string;
  doc?: string;
}
export interface ExplorerI2cDevice {
  bus: string;
  chip: string;
  role?: string;
  address?: string;
}
export interface ExplorerTopologyCore {
  id: string;
  app?: string;
  image?: string;
  machine?: string;
  board?: string;
  toolchain?: string;
}
export interface ExplorerCore {
  id: string;
  type: string;
  count: number;
  freqMhz?: number;
}
export interface HardwareExplorerSom {
  sku: string;
  displayName: string;
  family: string;
  silicon: string;
  topology: ExplorerTopologyCore[];
  onModule: string[];
  padRoutes: ExplorerPadRoute[];
  i2cDevices: ExplorerI2cDevice[];
}
export interface HardwareExplorerDataMessage {
  type: "hardwareExplorerData";
  som: HardwareExplorerSom | null;
  cores: ExplorerCore[];
  sdkConnected: boolean;
}

export type ExtToWebviewMessage =
  | StateUpdateMessage
  | SdkReleasesLoadedMessage
  | SdkInstallProgressMessage
  | ProjectTemplatesDataMessage
  | ConfiguratorInitMessage
  | ConfiguratorSavedMessage
  | ToolchainReportMessage
  | HardwareExplorerDataMessage;

// Webview → Extension
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
  url: string;
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
  activate: boolean;
}
export interface SaveBoardModelMessage {
  type: "saveBoardModel";
  model: BoardModel;
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
  | SaveBoardModelMessage
  | ReloadConfiguratorMessage
  | PreviewEffectiveConfigMessage
  | RunToolchainFixMessage
  | ReloadToolchainMessage
  | ReloadHardwareExplorerMessage;
