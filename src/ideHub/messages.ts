// SPDX-License-Identifier: Apache-2.0

import type { BoardConfig } from "@alp-sdk/core/board/models";
import type { ConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import type {
  DependencyAction,
  DependencyActionEffect,
  DependencyReport,
  DependencyRow,
} from "@alp-sdk/core/deps/planner";
import type { DependencyState } from "@alp-sdk/core/deps/state";
import type {
  ManifestFreshness,
  ManifestProvenance,
} from "@alp-sdk/core/systemManifest/staleness";
import type {
  LocalSdkEntry,
  SdkReadinessState,
  SdkRelease,
} from "@alp-sdk/core/sdk/models";
import type { SocCore, SomPreset } from "@alp-sdk/core/sdkCatalogue/models";
import type {
  SizeReport,
  SystemManifest,
} from "@alp-sdk/core/systemManifest/models";
import type { ToolchainFixId } from "@alp-sdk/core/toolchain/bootstrapPlan";

// Re-export so callers only need this module.
export type {
  BoardConfig,
  ConfiguratorViewModel,
  DependencyAction,
  // The verb a row's button promises (`install` / `open-docs` / `bootstrap`),
  // read off the host's own fix dispatch. Mirrored in the webview types.
  DependencyActionEffect,
  DependencyReport,
  DependencyRow,
  // Ready / Will install / Needs you — presentation over the (status, action)
  // pair, never a re-derivation of tan's verdict (#466 §1). Mirrored in the
  // webview types.
  DependencyState,
  LocalSdkEntry,
  // fresh / stale / unknown, and the file mtime behind it (#470). Mirrored in
  // the webview types.
  ManifestFreshness,
  ManifestProvenance,
  SdkRelease,
  SocCore,
  SizeReport,
  SomPreset,
  SystemManifest,
  ToolchainFixId,
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
  tan: string | null;
  cmake: string | null;
  ninja: string | null;
}

/**
 * The `runInTerminal` task `name` EVERY bootstrap dispatch runs under —
 * `alp.installDependencies`/`alp.bootstrap` (`tan bootstrap`, src/bootstrap.ts)
 * and the Toolchain Doctor's build fix (`tan bootstrap`, src/toolchain.ts).
 * Both deliberately share ONE name so `runInTerminal`'s
 * reservation refuses a second concurrent bootstrap against the same venv
 * (issue #146); that shared name is also what lets a single probe
 * (`bootstrapRunning`, src/ideHub/vscodeAdapter.ts) answer "is a bootstrap
 * running" for either entry point.
 *
 * Lives HERE, next to the `SetupStatus.bootstrapRunning` field it feeds,
 * because it is the one string the dispatch sites, the probe and the
 * task-start refresh must all agree on — and this module is the only shared
 * one all three can import (it pulls in no `vscode`, so importing it costs a
 * dispatch site nothing). A second spelling anywhere and the probe watches a
 * name nobody runs under: no spinner, and Build/Flash offered over a
 * half-fetched module tree. Host-side only — the webview never dispatches a
 * terminal, so this is NOT part of the mirrored protocol.
 */
export const BOOTSTRAP_RUN_NAME = "Alp Bootstrap";

export interface SetupStatus {
  pythonAvailable: boolean;
  westAvailable: boolean;
  /**
   * True while a bootstrap run (`BOOTSTRAP_RUN_NAME`) is STILL EXECUTING in a
   * terminal.
   *
   * Every other gate in this state is a snapshot of the disk, and
   * `workspace.westInitialized` flips the moment `.west/config` is written —
   * the FIRST thing `tan bootstrap` does, not the last. So without this term
   * every readiness surface reports a half-fetched module tree as ready and
   * offers Build/Flash over it. tan v0.4.0 widens that window: it no longer
   * reuses a workspace across a patch-level Zephyr bump, so a `west update`
   * can now run where none did before — minutes, not seconds.
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
      bootstrapRunning: false,
      lastBootstrapAt: null,
      toolVersions: {
        python: null,
        west: null,
        tan: null,
        cmake: null,
        ninja: null,
      },
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

/**
 * Increment whenever the message protocol changes in a breaking way.
 *
 * 3 — the Toolchain Doctor protocol (`toolchainReport` / `reloadToolchain` /
 * `runToolchainFix`) was REMOVED and replaced by the dependency panel's
 * `dependencyReport` / `refreshDependencies` / `runDependencyAction`. Removal is
 * breaking in both directions: a stale webview posting `runToolchainFix` would
 * be dropped on the floor, and one waiting on `toolchainReport` would spin
 * forever. The bump is what makes it show the reload prompt instead.
 */
export const PROTOCOL_VERSION = 3 as const;

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

/** Ask the Hub webview to scroll a named section into view (e.g. opening the
 *  SDK Manager, now a Hub section, from the command palette or sidebar). */
export interface FocusSectionMessage {
  type: "focusSection";
  section: "sdk";
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

/**
 * The dependency table (`tan doctor --build`, planned by
 * `@alp-sdk/core/deps/planner`). One push carries the whole table — rows,
 * tan's own three counts, and whether this tan could say what is missing.
 *
 * `report: null` + `error` is the honest "the CLI could not answer" state.
 * The panel says so; it never renders an empty table as a clean bill of health.
 */
export interface DependencyReportMessage {
  type: "dependencyReport";
  report: DependencyReport | null;
  error?: string;
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

/** The system manifest — the post-build IDE/tool contract (`alp build
 *  --manifest`). Pushed alongside the build plan: the plan is the planner's
 *  pre-build intent, the manifest is the resolved per-core slices + ipc +
 *  helper MCUs (post-build when `build/system-manifest.yaml` exists, else the
 *  SDK's pre-build projection). */
export interface SystemManifestDataMessage {
  type: "systemManifestData";
  manifest: SystemManifest | null;
  /** True when `manifest` is the populated `build/system-manifest.yaml`;
   *  false when it's the SDK's pre-build projection (slices `status: pending`). */
  postBuild: boolean;
  /**
   * WHEN that file was written and whether it still describes the last build
   * (#470). `null` on the projection path, which has no file — a projection is
   * computed on the spot and cannot be stale.
   *
   * `postBuild` alone was the defect: it says a manifest EXISTS, and the panel
   * read that as "this is what your last build did". After a failed build the
   * previous green build's slices and memory figures rendered as current, with
   * nothing on screen saying so.
   */
  provenance: ManifestProvenance | null;
  error?: string;
}

/** Per-slice firmware footprint vs the SoM memory budget — the `alp-size/1`
 *  payload from `tan size --format json`, keyed by the same `core_id` as the
 *  manifest slices. Only requested post-build: `tan size` measures ELFs, so
 *  before a build every row would read `not-built`. */
export interface SliceSizesDataMessage {
  type: "sliceSizesData";
  report: SizeReport | null;
  error?: string;
}

/** The folder the user picked for the new project's parent directory. */
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
  /** Per-core topology (id + resolved OS) from `alp presets`; drives the
   *  heterogeneous `alp init --cores` scaffold. Absent for the built-in fallback. */
  cores?: { id: string; os: string }[];
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

/** Remove a local SDK (deletes its folder on disk, after confirmation). */
export interface UninstallSdkMessage {
  type: "uninstallSdk";
  sdkPath: string;
}

/** Clear the active SDK (deactivate) without deleting anything. */
export interface DeactivateSdkMessage {
  type: "deactivateSdk";
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
  /** Active SDK to pin for the new project (absolute path); omitted = default. */
  sdkPath?: string;
  /** Parent directory chosen in the wizard; omitted = prompt with a dialog. */
  destination?: string;
  /** Open the created project in the CURRENT window (replace the workspace) vs a
   *  new window. Omitted = true (the wizard checkbox defaults to on). */
  openInCurrentWindow?: boolean;
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

/**
 * Re-run `tan doctor --build` and push a fresh `dependencyReport`. The user
 * asked, so this is also the one path allowed to spend a GitHub request on the
 * latest-SDK lookup regardless of the cache TTL (src/deps/panel.ts).
 */
export interface RefreshDependenciesMessage {
  type: "refreshDependencies";
}

/**
 * Run one dependency row's action.
 *
 * Carries the ROW ID (`DependencyRow.name`, which is tan's `check.name`) and
 * nothing else. The host looks the id up in the report it last sent and runs
 * THAT row's `action` — so what executes is always something the host itself
 * produced. A webview that handed over a command string to execute would be a
 * command-injection seam: the panel renders untrusted CLI output, and a
 * compromised or merely buggy renderer could then choose the command.
 *
 * An unknown id, or a row whose `action` is `null`, is a no-op.
 */
export interface RunDependencyActionMessage {
  type: "runDependencyAction";
  name: string;
}

/**
 * Run every installing row, one at a time (#466 §2).
 *
 * Carries NOTHING — not the row ids, not the commands. The host resolves the
 * set from the report it last sent, the same rule `runDependencyAction`
 * follows: a webview that named the rows could name a different set than the
 * one on screen, and a webview that posted commands would be an injection seam.
 *
 * Progress, cancellation and the result live in VS Code's own notification UI
 * rather than in this protocol. A run can outlive the panel — the user can
 * close it mid-install — and a progress bar that vanished with the panel would
 * leave a long install running with nothing on screen saying so.
 */
export interface RunFixAllMessage {
  type: "runFixAll";
}

export interface ReloadHardwareExplorerMessage {
  type: "reloadHardwareExplorer";
}

export interface RequestBuildPlanMessage {
  type: "requestBuildPlan";
}

/** Materialise the plan's files to disk (`alp build --materialise`). */
export interface MaterialiseBuildPlanMessage {
  type: "materialiseBuildPlan";
}

/** Run the build live in a terminal (`alp build`). */
export interface RunBuildMessage {
  type: "runBuild";
}

/** Flash a single manifest slice (`alp flash --core <id>`). */
export interface FlashSliceMessage {
  type: "flashSlice";
  coreId: string;
}

/** Ask the host to open a folder picker for the new project's parent directory. */
export interface PickProjectLocationMessage {
  type: "pickProjectLocation";
  /** Current selection, to seed the dialog's default location. */
  current?: string;
}

/** Re-fetch the template + SoM catalog against a wizard-selected SDK, so the
 *  Examples/Hardware lists match the SDK the project is scaffolded from. */
export interface ReloadProjectTemplatesMessage {
  type: "reloadProjectTemplates";
  /** Selected SDK root to source the catalog from; omitted = active/default. */
  sdkPath?: string;
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
