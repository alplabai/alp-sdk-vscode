// Types mirrored from src/ideHub/messages.ts — kept in sync manually.
// The webview is a separate build; we do not share source with the extension.

/** Must match PROTOCOL_VERSION in src/ideHub/messages.ts. */
export const PROTOCOL_VERSION = 2 as const;

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
  /** True when Alp installed this SDK (under ~/.alp/sdk) and may remove it. */
  removable?: boolean;
}

export interface SdkRelease {
  tag: string;
  publishedAt: string;
  tarballUrl: string;
  releaseNotesSummary: string;
  releaseNotes: string;
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
  /** Per-core topology (id + resolved OS) from `alp presets`; shown in the
   *  Confirm step and drives the heterogeneous `alp init --cores` scaffold. */
  cores?: { id: string; os: string }[];
}

// ── Configurator (board.yaml) — rich model mirrored from
//    @alp-sdk/core/board/models + configurator/viewModel. The webview is a
//    separate build and cannot import core sources, so these are kept in sync
//    manually. ──
export type CoreOs = "zephyr" | "yocto" | "baremetal" | "off";
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogLevelOrOff = LogLevel | "off";

export interface CoreInference {
  default_arena_kib?: number;
}
export interface CoreIot {
  wifi?: boolean;
  mqtt?: boolean;
  ble?: boolean;
  tls?: boolean;
}
export interface CoreEntry {
  os?: CoreOs;
  app?: string;
  image?: string;
  peripherals?: string[];
  inference?: CoreInference;
  iot?: CoreIot;
}

/** A top-level `libraries[]` entry (ADR 0018, board.schema.json `libraries`).
 * A bare name is shorthand for a project-wide `{name}`; the object form scopes
 * the pick to `cores` (omitted = project-wide). There is no per-core
 * `cores.<id>.libraries` field. */
export type LibraryEntry = string | { name: string; cores?: string[] };

export interface StoragePartition {
  name: string;
  size_kib: number;
  fs?: "littlefs" | "fat" | "ext4" | "raw";
  mount?: string;
  flash_device?: string;
  offset_kib?: number;
  raw?: boolean;
}

export interface SecurityPsa {
  persistent_slots?: number;
  its_storage?: string;
  ps_storage?: string;
  tfm?: boolean;
  attestation_root?: "optiga_trust_m" | "tfm_internal" | "none";
}
export interface Security {
  psa?: SecurityPsa;
}

export interface BootSigning {
  algorithm: "ecdsa_p256" | "rsa2048" | "rsa3072" | "ed25519";
  key_file: string;
}
export interface Boot {
  method?: "mcuboot" | "none";
  signing?: BootSigning;
  swap_algorithm?: "scratch" | "move" | "overwrite";
  scratch_size_kib?: number;
  anti_rollback?: boolean;
  build_type?: "Release" | "Debug" | "MinSizeRel";
}

export interface OtaServer {
  url: string;
  tenant?: string;
  tls_ca_bundle?: string;
}
export interface Ota {
  provider: "mender" | "hawkbit" | "mcumgr" | "none";
  artifact_name?: string;
  signing_key?: string;
  server?: OtaServer;
  poll_interval_s?: number;
}

export interface IpcEntry {
  kind: "rpmsg" | "raw_shmem" | "mailbox_only";
  endpoints: string[];
  carve_out_kb: number;
  name: string;
  cacheable?: boolean;
  address?: number;
}

export interface Diagnostics {
  last_error?: boolean;
  log_level?: LogLevel;
  modules?: Record<string, LogLevelOrOff>;
}

/** An AI model to compile + package into .alpmodel (board.schema.json `models`). */
export interface ModelEntry {
  name: string;
  source: string;
  spec?: string;
  inputs?: unknown[];
  /** Per-backend NPU compile configuration (paths to config/calibration/spec). */
  compile?: {
    deepx_dxm1?: { config: string; calibration: string };
    drpai?: { spec: string };
  };
}

export interface BoardConfig {
  name?: string;
  description?: string;
  preset?: string;
  hw_rev?: string;
  som: { sku: string; hw_rev?: string };
  cores: Record<string, CoreEntry>;
  populated?: Record<string, boolean>;
  chips?: string[];
  libraries?: LibraryEntry[];
  ipc?: IpcEntry[];
  models?: ModelEntry[];
  diagnostics?: Diagnostics;
  storage?: StoragePartition[];
  security?: Security;
  boot?: Boot;
  ota?: Ota;
  [key: string]: unknown;
}

// ── Configurator view-model (host-computed, read-only on the webview) ──
export interface SomOptionGroup {
  family: string;
  soms: { sku: string; displayName: string; preliminary: boolean }[];
}
export interface HardwareCard {
  sku: string;
  displayName: string;
  silicon: string;
  cores: { id: string; type: string; count: number; freqMhz?: number }[];
  preferredBackend?: string;
  defaultBoard?: string;
  onModule: string[];
  preliminary: boolean;
}
export interface CorePanel {
  id: string;
  inheritedFromTopology: boolean;
  os?: string;
  app?: string;
  image?: string;
  peripherals: string[];
  libraries: string[];
  iot: { wifi: boolean; mqtt: boolean; ble: boolean; tls: boolean };
  inferenceArenaKib?: number;
}
export interface ChipChoice {
  chipId: string;
  displayName: string;
  vendor?: string;
  bus?: string;
  driverStatus?: string;
  enabled: boolean;
}
export interface AcceleratorAvail {
  id: string;
  label: string;
  available: boolean;
}
export interface BoardPreset {
  name: string;
  displayName: string;
  hostsSomFamilies: string[];
  populated: Record<string, boolean>;
}
export interface ValidationResult {
  errors: string[];
  warnings: string[];
}
export interface ConfiguratorViewModel {
  sdkConnected: boolean;
  som: { selected: string; options: SomOptionGroup[] };
  hardware: HardwareCard | null;
  accelerators: AcceleratorAvail[];
  boardMode: "preset" | "inline";
  carriers: { selected?: string; options: BoardPreset[] };
  cores: CorePanel[];
  libraries: string[];
  chips: ChipChoice[];
  projectChips: string[];
  validation: ValidationResult;
}

export interface ConfiguratorRenderMessage {
  type: "configuratorRender";
  viewModel: ConfiguratorViewModel;
  board: BoardConfig;
  boardPath: string;
  sdkConnected: boolean;
  /** Non-null when the document is unparseable YAML: the board is the stub,
   *  the view must show the error, and edits are blocked (issue #127). */
  parseError?: string | null;
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

// --- Build-plan preview (mirrors messages.ts; consumes `alp build --plan`) ---
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
  plan: BuildPlanData | null;
  error?: string;
}

// --- System manifest (mirrors @alp-sdk/core/systemManifest/models; the
// post-build IDE/tool contract from `alp build --manifest`) ---
export interface ManifestHwInfo {
  sku: string;
  som_hw_rev?: string | null;
  board_name?: string | null;
  board_hw_rev?: string | null;
  silicon?: string | null;
}
export interface ManifestSlice {
  core_id: string;
  os: string;
  app?: string;
  image?: string;
  machine?: string;
  board?: string;
  toolchain?: string;
  build_dir?: string;
  output_artefact?: string;
  status: string;
  log_path?: string;
  reason?: string;
  flash_method?: string;
  flash_args?: Record<string, unknown>;
}
export interface ManifestIpcLink {
  name: string;
  kind: string;
  endpoints: string[];
  status?: string;
  reason?: string;
  [key: string]: unknown;
}
export interface ManifestHelperMcu {
  name: string;
  chip: string;
  firmware_path?: string;
  flash_method?: string;
  flash_args?: Record<string, unknown> | string;
  [key: string]: unknown;
}
export interface SystemManifest {
  schema_version: number;
  generated_by: string;
  hw_info: ManifestHwInfo;
  slices: ManifestSlice[];
  ipc: ManifestIpcLink[];
  helper_mcus: ManifestHelperMcu[];
  boot_order: unknown[];
  storage?: unknown[];
}
export interface SystemManifestDataMessage {
  type: "systemManifestData";
  manifest: SystemManifest | null;
  postBuild: boolean;
  error?: string;
}

export interface ProjectLocationPickedMessage {
  type: "projectLocationPicked";
  path: string;
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
  | ProjectLocationPickedMessage
  | BuildPlanDataMessage
  | SystemManifestDataMessage;

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
export interface UninstallSdkMessage {
  type: "uninstallSdk";
  sdkPath: string;
}
export interface DeactivateSdkMessage {
  type: "deactivateSdk";
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
  /** Active SDK to pin for the new project (absolute path); omitted = default. */
  sdkPath?: string;
  /** Parent directory chosen in the wizard; omitted = prompt with a dialog. */
  destination?: string;
}
export interface PickProjectLocationMessage {
  type: "pickProjectLocation";
  current?: string;
}
export interface ReloadProjectTemplatesMessage {
  type: "reloadProjectTemplates";
  /** Selected SDK root to source the catalog from; omitted = active/default. */
  sdkPath?: string;
}
export interface OpenExistingProjectMessage {
  type: "openExistingProject";
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
export interface MaterialiseBuildPlanMessage {
  type: "materialiseBuildPlan";
}
export interface RunBuildMessage {
  type: "runBuild";
}
export interface BuildSliceMessage {
  type: "buildSlice";
  coreId: string;
}
export interface FlashSliceMessage {
  type: "flashSlice";
  coreId: string;
}

export type WebviewToExtMessage =
  | ReadyMessage
  | RunCommandMessage
  | SelectSdkPathMessage
  | RequestSdkReleasesMessage
  | RequestSdkInstallMessage
  | SwitchSdkMessage
  | UninstallSdkMessage
  | DeactivateSdkMessage
  | OpenUrlMessage
  | ClosePanelMessage
  | CreateNewProjectMessage
  | PickProjectLocationMessage
  | ReloadProjectTemplatesMessage
  | OpenExistingProjectMessage
  | SaveBoardConfigMessage
  | ConfiguratorUpdateMessage
  | ReloadConfiguratorMessage
  | PreviewEffectiveConfigMessage
  | RunToolchainFixMessage
  | ReloadToolchainMessage
  | ReloadHardwareExplorerMessage
  | RequestBuildPlanMessage
  | MaterialiseBuildPlanMessage
  | RunBuildMessage
  | BuildSliceMessage
  | FlashSliceMessage;
