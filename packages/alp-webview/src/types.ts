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
  tan: string | null;
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
/** Scroll a named Hub section into view (e.g. the SDK Manager section). */
export interface FocusSectionMessage {
  type: "focusSection";
  section: "sdk";
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

// --- Models panel (mirrors messages.ts; merges `tan model list` +
// `tan model doctor` envelopes). `models`/`toolchains` stay `unknown[]` at
// the boundary — narrowed here, not re-declared from the tan-owned schema. ---
export interface ModelsDataMessage {
  type: "modelsData";
  ok: boolean;
  models: unknown[];
  toolchains: unknown[];
  issues: { code: string; severity: string; message: string }[];
}
export interface ModelBuildProgressMessage {
  type: "modelBuildProgress";
  log: string;
  done: boolean;
  success?: boolean;
}

/** Per-model fit verdicts from `tan model check --board`. `models` stays
 *  `unknown[]` at the boundary — the board-mode payload
 *  ([{name,source,backends?,suggestion?,error?}]) is narrowed in the webview. */
export interface ModelFitDataMessage {
  type: "modelFitData";
  /** Envelope `ok` (false → show issues, e.g. the alp stderr via `model.failed`). */
  ok: boolean;
  /** `envelope.data.sku` (the board's `som.sku`); absent on failure. */
  sku?: string;
  /** `envelope.data.models` — board-mode per-model results. */
  models: unknown[];
  issues: { code: string; severity: string; message: string }[];
}

/** Ack that `tan model prep` actually started (both file dialogs confirmed) —
 *  lets the webview flip `prepping:true` only for real work, so a cancelled
 *  dialog (panel.ts returns early, posts nothing) never sticks the button. */
export interface ModelPrepStartedMessage {
  type: "modelPrepStarted";
}

/** Result of `tan model prep` — the quantized artifact + accuracy report. */
export interface ModelPrepResultMessage {
  type: "modelPrepResult";
  ok: boolean;
  quantized?: string;
  accuracy?: {
    samples: number;
    top1_agreement_pct: number;
    mean_cosine: number;
    max_abs_err: number;
    verdict: string;
    guidance: string | null;
  };
  issues: { code: string; severity: string; message: string }[];
}

/** Ack that a `tan model run`/`tan model ab` measurement actually started
 *  (the file dialog(s) confirmed) — lets the webview flip `measuring:true`
 *  only for real work, so a cancelled dialog (panel.ts returns early, posts
 *  nothing) never sticks the button. Mirrors ModelPrepStartedMessage. */
export interface ModelMeasureStartedMessage {
  type: "modelMeasureStarted";
}

/** A real bench-measured energy result (`alp_model.measure.EnergyMeasurement`
 *  in alp-sdk) attached to a `tan model run --on-device`/`tan model ab`
 *  payload. `source`/`scope` are always `"measured"`/`"carrier-rail-delta"` —
 *  a board-level carrier-rail delta, never an isolated NPU/U85/U55/M55
 *  figure; `scope` drives the webview's label (never hardcode "NPU power" /
 *  "silicon energy" from it). Undefined on a host-only run (the
 *  overwhelmingly common case) or when the CLI's energy object was
 *  malformed. */
export interface ModelEnergyMeasurement {
  source: string;
  scope: string;
  value_mj_per_inference: number;
  rails: string[];
  n_inferences: number;
  window_ms: number;
  sample_count: number;
  spread_mj: number | null;
}

/** Result of `tan model run` — a host reference (CPU) inference measurement. */
export interface ModelRunResultMessage {
  type: "modelRunResult";
  ok: boolean;
  run?: {
    backend: string;
    latency_ms: number;
    output_argmax: number | null;
    peak_sram_kib: number | null;
    power_mj: number | null;
    runs: number;
    random_input: boolean;
    note: string;
    accuracy?: { expected: number; match: boolean };
    energy?: ModelEnergyMeasurement;
  };
  issues: { code: string; severity: string; message: string }[];
}

/** Result of `tan model ab` — two models' host reference measurements + a
 *  head-to-head comparison. */
export interface ModelAbResultMessage {
  type: "modelAbResult";
  ok: boolean;
  ab?: {
    a: {
      model: string;
      backend: string;
      latency_ms: number;
      energy?: ModelEnergyMeasurement;
    };
    b: {
      model: string;
      backend: string;
      latency_ms: number;
      energy?: ModelEnergyMeasurement;
    };
    comparison: {
      faster: string;
      latency_ratio: number | null;
      a_latency_ms: number;
      b_latency_ms: number;
      size_delta_bytes: number | null;
      /** Present only when BOTH `a`/`b` carry a real energy object — mirrors
       *  the CLI, which omits the key entirely rather than sending `null`
       *  when either side lacks one. */
      energy_delta_mj_per_inference?: number;
    };
    note: string;
  };
  issues: { code: string; severity: string; message: string }[];
}

/** A single curated zoo entry from `tan model zoo --board` — `runs_here` is
 *  `true`/`false` when the board's `som.sku` was resolvable, `null` when it
 *  wasn't (e.g. no board.yaml yet) — the MVP shows every entry badged rather
 *  than silently hiding the ones it can't validate. */
export interface ZooEntry {
  id: string;
  task: string;
  description: string;
  license: string;
  validated_soms: string[];
  runs_here: boolean | null;
}

/** Zoo gallery state from `tan model zoo --board`. */
export interface ZooDataMessage {
  type: "zooData";
  ok: boolean;
  entries: ZooEntry[];
  issues: { code: string; severity: string; message: string }[];
}

/** Ack that `tan model add` actually started — mirrors ModelPrepStartedMessage
 *  (Add mutates board.yaml + fetches, so it gets the same started-ack shape
 *  as prep: the webview poster does NOT set `adding` optimistically). */
export interface ZooAddStartedMessage {
  type: "zooAddStarted";
}

/** Result of `tan model add <id> --board` — the fetched model appended to
 *  board.yaml. */
export interface ZooAddResultMessage {
  type: "zooAddResult";
  ok: boolean;
  added?: string;
  issues: { code: string; severity: string; message: string }[];
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
  | FocusSectionMessage
  | ConfiguratorRenderMessage
  | ConfiguratorSavedMessage
  | ToolchainReportMessage
  | HardwareExplorerDataMessage
  | ProjectLocationPickedMessage
  | BuildPlanDataMessage
  | SystemManifestDataMessage
  | ModelsDataMessage
  | ModelBuildProgressMessage
  | ModelFitDataMessage
  | ModelPrepStartedMessage
  | ModelPrepResultMessage
  | ModelMeasureStartedMessage
  | ModelRunResultMessage
  | ModelAbResultMessage
  | ZooDataMessage
  | ZooAddStartedMessage
  | ZooAddResultMessage;

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
export interface RequestModelsMessage {
  type: "requestModels";
}
export interface BuildModelMessage {
  type: "buildModel";
  name?: string;
}
export interface CheckModelFitMessage {
  type: "checkModelFit";
}
export interface PrepModelMessage {
  type: "prepModel";
}
export interface RunModelMessage {
  type: "runModel";
}
export interface AbModelsMessage {
  type: "abModels";
}
export interface RequestZooMessage {
  type: "requestZoo";
}
export interface AddFromZooMessage {
  type: "addFromZoo";
  id: string;
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
  | FlashSliceMessage
  | RequestModelsMessage
  | BuildModelMessage
  | CheckModelFitMessage
  | PrepModelMessage
  | RunModelMessage
  | AbModelsMessage
  | RequestZooMessage
  | AddFromZooMessage;
