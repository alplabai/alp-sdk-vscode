// Types mirrored from src/ideHub/messages.ts — kept in sync manually.
// The webview is a separate build; we do not share source with the extension.

/** Must match PROTOCOL_VERSION in src/ideHub/messages.ts. */
export const PROTOCOL_VERSION = 3 as const;

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
  /** Decided host-side (#361) — do NOT re-derive with `path === activePath`. */
  active?: boolean;
  /** Only meaningful when `active`: `"pinned"` = the user pinned it
   *  (`alpSdk.path` / `.alp/sdk-path`), so Deactivate has something to clear.
   *  `"auto"` = nothing was pinned and resolution guessed (single sibling SDK,
   *  or newest install in ~/.alp/sdk) — render "Default (auto-detected)" and
   *  offer "Use", never "Active" + "Deactivate". Mirrors LocalSdkEntry in
   *  @alp-sdk/core/sdk/models. */
  activeSource?: "pinned" | "auto";
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
  /**
   * True while a `tan bootstrap` run is still executing in a terminal.
   * `workspace.westInitialized` goes true at the START of that run (the first
   * write of `.west/config`), so any readiness a surface renders from it alone
   * is wrong for the whole run — the workspace is still being fetched. Every
   * surface that renders "ready" or enables Build/Flash must AND in
   * `!bootstrapRunning`, or it will disagree with the status bar.
   */
  bootstrapRunning: boolean;
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
  /**
   * The SDK category this example renders under (`aen`, `ai`, `multicore`, …),
   * or absent when it has none (#482 §2).
   *
   * DISTINCT from `category` above, which is the KIND — starter / example /
   * library. This is the heading WITHIN the examples, and only examples carry
   * it. Derived host-side by `exampleCategory` (@alp-sdk/core/examples/category)
   * from the leading segment of `sourceDir`, deferring to tan the day its
   * envelope carries one outright.
   */
  group?: string;
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
  // No `raw?: boolean` — mirrors @alp-sdk/core's StoragePartition, where the
  // reason is spelled out: alp-sdk v0.15.0 deleted the legacy `fs: raw` alias
  // and storage items are `additionalProperties: false`.
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
  console?: "auto" | "alp" | "uart" | "ram" | "linux" | "none";
  sim_console?: boolean;
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
  hwConsole?: boolean;
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

// ── Dependencies panel — mirrored from @alp-sdk/core/deps/planner and
//    @alp-sdk/core/toolchain/bootstrapPlan. Kept in sync manually (separate
//    webview build). Only the REPORT half of the planner crosses the wire; its
//    envelope inputs stay host-side. ──

/**
 * Mirrors `ToolchainFixId` in packages/alp-core/src/toolchain/bootstrapPlan.ts.
 * Every member core can emit must be listed — this union silently lost "gdb"
 * once, which `test/deps.protocol.test.js` now guards in both directions.
 */
export type ToolchainFixId =
  | "python-deps"
  | "west"
  | "west-workspace"
  | "build-tools"
  | "zephyr-sdk"
  | "gdb";

/**
 * A row's status, VERBATIM from tan. Deliberately `string`, not a union: the
 * view prints it as-is, so a status tan adds later shows up rather than being
 * coerced into today's vocabulary.
 */
export type DependencyStatus = string;

/** `"pin"` = the extension requires exactly this version, so it is never an
 *  update to offer; `"release"` = the row chases latest. */
export interface DependencyLatest {
  version: string;
  kind: "release" | "pin";
}

/**
 * What pressing the button ACTUALLY does, so the label can say it. Mirrors
 * `DependencyActionEffect` in packages/alp-core/src/deps/planner.ts.
 *
 * `"open-docs"` opens a web page and installs NOTHING (the `build-tools` and
 * `zephyr-sdk` fixes are exactly that), and `"bootstrap"` starts a whole
 * `tan bootstrap` run — neither may be labelled "Install".
 */
export type DependencyActionEffect = "install" | "open-docs" | "bootstrap";

/**
 * What a row's button does. `null` (no action) is a first-class outcome.
 *
 * `effect` picks the label and `title` is the tooltip: both are on every kind,
 * so the view never has to guess a verb or leave a button unexplained.
 */
export type DependencyAction =
  | {
      kind: "command";
      command: string;
      effect: "install";
      title: string;
    }
  | {
      kind: "fix";
      fixId: ToolchainFixId;
      effect: DependencyActionEffect;
      title: string;
    };

/**
 * The state word the panel leads with, mirrored from
 * `@alp-sdk/core/deps/state` (#466 §1). Computed HOST-SIDE from the
 * (`status`, `action.effect`) pair — the webview renders it and derives
 * nothing, which is the only shape that does not re-derive tan's verdict.
 *
 * `unknown` is not just tan's own `unknown`: any status the host mapping does
 * not recognise lands here rather than being coerced into one of the other
 * three. Render it as unknown, never as a guess.
 */
export type DependencyState =
  | "ready"
  | "will-install"
  | "needs-you"
  | "unknown";

export interface DependencyRow {
  /** tan's `check.name`, verbatim — the row's identity and what the webview
   *  posts back in `runDependencyAction`. */
  name: string;
  label: string;
  status: DependencyStatus;
  /** Ready / Will install / Needs you / Unknown. An EXTRA field: `status`
   *  above is still tan's word and is still rendered, so nothing this
   *  summarises can be lost. */
  state: DependencyState;
  detail: string;
  /** tan's own `check.fix` PROSE, verbatim, or `null` when tan gave none.
   *  DISPLAY ONLY — rendered under the detail, never parsed into a command
   *  (#347). On a row with no button it is the only remedy the user gets. */
  hint: string | null;
  /** `null` whenever tan reports no version — render an em dash, never a
   *  fabricated version and never the word "unknown". */
  installed: string | null;
  latest: DependencyLatest | null;
  updateAvailable: boolean;
  action: DependencyAction | null;
}

export interface DependencyReport {
  rows: DependencyRow[];
  /** tan's `data.summary` verbatim. There is deliberately no `ok` boolean: an
   *  older tan caps an absent PATH tool at `warn`, so any `fail === 0` verdict
   *  would print "all good" while Ninja is missing. The pinned v0.4.0 rates it
   *  `fail` (tan-cli#103), but a binary set through `alpSdk.cliPath` may not.
   *  The view must not invent one. */
  counts: { pass: number; warn: number; fail: number };
  /** True when this tan emitted no `missingPrerequisites` at all — v0.3.1 and
   *  earlier, not the pinned v0.4.0. The panel says so in one line instead of
   *  implying tan looked and found nothing. */
  prerequisiteDataUnavailable: boolean;
}

export interface DependencyReportMessage {
  type: "dependencyReport";
  report: DependencyReport | null;
  error?: string;
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
  hwConsole?: boolean;
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

// --- `alp-size/1` (mirrors @alp-sdk/core/systemManifest/models) -------------
// `tan size` reads build/system-manifest.yaml, measures each slice's ELF and
// resolves the SoM memory budget. Every number is nullable: tan reports null
// rather than guessing when a slice is unbuilt, unmeasurable, or has no
// resolvable budget. Render null as "unknown", never as 0.
export interface SizeRegion {
  used: number | null;
  total: number | null;
  pct: number | null;
}
export type SliceSizeStatus =
  | "ok"
  | "warn"
  | "over"
  | "not-built"
  | "no-budget"
  | "n/a";
export interface SliceSize {
  core_id: string;
  os: string;
  status: SliceSizeStatus;
  flash: SizeRegion;
  ram: SizeRegion;
  source?: string | null;
  budget_note?: string;
  notes?: string[];
}
export interface SizeReport {
  schema: string;
  slices: SliceSize[];
  summary: { over_budget: string[]; unknown_budget: string[] };
}
export interface SliceSizesDataMessage {
  type: "sliceSizesData";
  report: SizeReport | null;
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
  | DependencyReportMessage
  | HardwareExplorerDataMessage
  | ProjectLocationPickedMessage
  | BuildPlanDataMessage
  | SystemManifestDataMessage
  | SliceSizesDataMessage;

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
  /** Open the created project in the CURRENT window (replace the workspace) vs a
   *  new window. Omitted = true (the wizard checkbox defaults to on). */
  openInCurrentWindow?: boolean;
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
export interface RefreshDependenciesMessage {
  type: "refreshDependencies";
}
/** Run one row's action. Carries the ROW ID only — the host resolves it
 *  against the report it last sent, so what runs is always something the host
 *  produced. Posting a command string to execute would be an injection seam. */
export interface RunDependencyActionMessage {
  type: "runDependencyAction";
  name: string;
}
/** Run every installing row, one at a time (#466 §2). Carries NOTHING: the
 *  host resolves the set from the report it last sent, so the webview can
 *  neither name a different set than the one on screen nor post a command. */
export interface RunFixAllMessage {
  type: "runFixAll";
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
  | RefreshDependenciesMessage
  | RunDependencyActionMessage
  | RunFixAllMessage
  | ReloadHardwareExplorerMessage
  | RequestBuildPlanMessage
  | MaterialiseBuildPlanMessage
  | RunBuildMessage
  | FlashSliceMessage;
