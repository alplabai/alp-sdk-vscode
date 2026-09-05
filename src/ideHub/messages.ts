// SPDX-License-Identifier: Apache-2.0

import type { BoardConfig } from "@alp-sdk/core/board/models";
import type { ConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import type {
  DependencyAction,
  DependencyActionEffect,
  DependencyCommandStep,
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
import type { MemoryView } from "@alp-sdk/core/systemManifest/memoryView";
import type { ToolchainFixId } from "@alp-sdk/core/toolchain/bootstrapPlan";

// Re-export so callers only need this module.
export type {
  BoardConfig,
  ConfiguratorViewModel,
  DependencyAction,
  // The verb a row's button promises (`install` / `open-docs` / `bootstrap`),
  // read off the host's own fix dispatch. Mirrored in the webview types.
  DependencyActionEffect,
  // One dispatch inside a `command` action's `commands[]` (#603). Mirrored in
  // the webview types.
  DependencyCommandStep,
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
  /**
   * Why the example catalogue came back empty, when tan said why — verbatim.
   *
   * `tan examples` reports an unresolved SDK as a SUCCESS: exit 0, `ok: true`,
   * an empty `data.examples`, and the reason only in
   * `issues[].code == examples.sdk-root-unresolved`. Without this the wizard
   * simply rendered no Examples section, so a user whose SDK is not resolved
   * lost all of them with nothing on screen saying why.
   *
   * Absent when the catalogue is legitimately empty — a `--category` that
   * matched nothing returns the same empty list with NO issue attached, and
   * that is not a problem to report.
   */
  examplesUnavailableReason?: string;
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

/** Models panel state — merges `tan model list` + `tan model doctor` envelopes.
 *  `models`/`toolchains` stay `unknown[]` at the boundary: they carry the
 *  tan-owned payload shapes, narrowed in the webview, not re-declared here. */
export interface ModelsDataMessage {
  type: "modelsData";
  /** Envelope `ok` (false → show the error/issues, e.g. "update tan"). */
  ok: boolean;
  /** `envelope.data.models` from `tan model list` (ModelListEntry[]). */
  models: unknown[];
  /** `envelope.data.toolchains` from `tan model doctor`. */
  toolchains: unknown[];
  /** `envelope.issues` from both calls, merged. */
  issues: { code: string; severity: string; message: string }[];
}

/** Long-running model build progress; mirrors SdkInstallProgressMessage. */
export interface ModelBuildProgressMessage {
  type: "modelBuildProgress";
  log: string;
  done: boolean;
  success?: boolean;
}

/** Per-model NPU-coverage reports from `tan model check --board`. `models`
 *  stays `unknown[]` at the boundary — the payload
 *  ([{name,source,backends:[{backend,variant,table,npuCoverage,
 *  computeOnNpuPctMax,npuPlacementPctReal,uncostedCpuOpCount,basis,
 *  confidence,notes,ops}]}]) is narrowed in the webview's
 *  features/models/coverage.ts, which owns the ADR-0028 vocabulary. There is
 *  no per-model `error` field: tan reports a per-model failure as an envelope
 *  issue coded `model.check-failed`. The message TYPE keeps its name — it is
 *  the webview↔extension protocol, not the tan vocabulary. */
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

/** The system manifest — the post-build IDE/tool contract. Pushed alongside
 *  the build plan: the plan is the planner's pre-build intent, the manifest is
 *  the resolved per-core slices + ipc + helper MCUs that a build wrote to
 *  `build/system-manifest.yaml`.
 *
 *  There is no longer a pre-build projection to fall back on: `--manifest` is
 *  RETIRED, not pending, so with no file on disk the panel posts a null
 *  manifest and names what produces the file (`retiredBuildOptionMessage`)
 *  rather than a flag to wait for. */
export interface SystemManifestDataMessage {
  type: "systemManifestData";
  manifest: SystemManifest | null;
  /** True when `manifest` is the populated `build/system-manifest.yaml`.
   *  False means there is no such file — not a projection standing in for it. */
  postBuild: boolean;
  /**
   * WHEN that file was written and whether it still describes the last build
   * (#470). `null` when there is no file, which has no date to report.
   *
   * `postBuild` alone was the defect: it says a manifest EXISTS, and the panel
   * read that as "this is what your last build did". After a failed build the
   * previous green build's slices and memory figures rendered as current, with
   * nothing on screen saying so.
   */
  provenance: ManifestProvenance | null;
  /**
   * The address-space view of that same manifest (#484): the extents it
   * actually pins, and the customer-declared entries it could not place.
   *
   * Derived host-side rather than in the webview so the narrowing has one
   * home and a test can reach it — every field there becomes an ADDRESS on
   * screen, and `parseSystemManifest`'s tolerant whole-array cast is the wrong
   * doctrine for that. `null` exactly when `manifest` is null.
   */
  memory: MemoryView | null;
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

/**
 * Send the New Project wizard back to one of its steps (#530).
 *
 * `stepId`, not an index: the step order is the webview's own (`STEPS` in
 * `NewProjectFlowView.tsx`), and an index sent from the host would silently
 * point at a different screen the first time a step is inserted.
 */
export interface NewProjectFlowGoToStepMessage {
  type: "newProjectFlowGoToStep";
  stepId: string;
}

/** One file `tan init --preview` says it would write, exactly as tan reports
 *  it — see `NewProjectPreviewDataMessage`. `kind` (`"new"`/`"update"`/…) is a
 *  plain `string`, not narrowed to a closed union: an unseen word must still
 *  be LISTED to the customer, never silently dropped (same rule
 *  `@alp-sdk/core/wizard/scaffoldPayload`'s `ScaffoldFileChange.kind` states
 *  for `tan scaffold`'s near-identical payload). */
export interface NewProjectFileChange {
  relativePath: string;
  kind: string;
}

/**
 * Answer to `requestNewProjectPreview` — `tan init --preview`'s own file list
 * (#616), so Create no longer writes a project the customer has never seen a
 * file list for.
 *
 * `files: null` means the preview COULD NOT BE READ — the spawn failed, tan
 * refused the (template, SoM) pair, or the envelope's `data` did not narrow
 * (`@alp-sdk/core/project/initPreview`'s `narrowInitPreview`) — and is NOT
 * "zero files". Every real template's preview lists at least one file
 * (measured on the pinned tan 0.6.0: 8 for `minimal-app`), so a genuinely
 * empty list would itself be surprising; the webview must not render `null`
 * as an empty list, the same failure `written ?? []` caused for module
 * scaffold (`test/ideHub.materialiseGuard.test.js`, #611, #517).
 *
 * Preview is an AID, never a gate: unlike `createNewProject`, a failure here
 * has no refusal-classification path and does not block Create — the panel
 * logs the reason to the "Alp SDK" output channel and answers `files: null`,
 * and Create sends the same argv (minus `--preview`) regardless.
 *
 * NOTE, correcting #616's own body: it claims `data.sdkPinned` is "a fact the
 * customer should see before Create". Measured on the pinned tan 0.6.0,
 * `data.sdkPinned` is `null` on a `--preview` pass — only the REAL
 * (non-preview) run resolves and reports it. This message carries no
 * `sdkPinned` field on purpose; do not add one that promises a value the
 * preview pass cannot supply.
 */
export interface NewProjectPreviewDataMessage {
  type: "newProjectPreviewData";
  files: NewProjectFileChange[] | null;
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
  | NewProjectFlowGoToStepMessage
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
  | ZooAddResultMessage
  | SliceSizesDataMessage
  | NewProjectPreviewDataMessage;

// ---------------------------------------------------------------------------
// New-project / existing-project shared types
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  category: "starter" | "example" | "library";
  /**
   * NOTE: there is deliberately no `icon` on this wire. The host used to ship
   * one and it was an emoji, which DESIGN.md's No-Emoji Rule now forbids; the
   * field was also untyped `string`, so fixtures had drifted to codicon names
   * (`circuit-board`) that the webview's own icon set does not contain and
   * that rendered as literal text. The view derives its icon from `category`
   * instead — one mapping, in the module that owns rendering.
   */
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

/** Ask the extension to (re-)fetch the Models panel data. */
export interface RequestModelsMessage {
  type: "requestModels";
}

/** Build one model, or all models when `name` is omitted. */
export interface BuildModelMessage {
  type: "buildModel";
  name?: string;
}

/** Ask the extension to run the NPU-coverage check on the board's models. */
export interface CheckModelFitMessage {
  type: "checkModelFit";
}

/** Ask the extension to prep a model (prompts for model + calibration dir). */
export interface PrepModelMessage {
  type: "prepModel";
}

/** Ask the extension to run a model (host reference measurement; prompts for
 *  the model file). */
export interface RunModelMessage {
  type: "runModel";
}

/** Ask the extension to A/B compare two models (host reference measurement;
 *  prompts for two model files). */
export interface AbModelsMessage {
  type: "abModels";
}

/** Ask the extension to (re-)fetch the zoo gallery (`tan model zoo --board`). */
export interface RequestZooMessage {
  type: "requestZoo";
}

/** Add a curated zoo entry to board.yaml (`tan model add <id> --board`). */
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
  /**
   * What the wizard's Cores step decided, one entry per core the SoM declares
   * (#534). Omitted by an older webview, and by a single-core SoM, in which
   * case the scaffold is whatever `tan init` produced on its own.
   *
   * `app` is the directory that core's application lives in, relative to the
   * project root. `tan init --cores` cannot express an app for anything but the
   * plan's own app core, so the host writes the rest into `board.yaml` after
   * the scaffold and creates each directory.
   */
  cores?: {
    id: string;
    os: string;
    app?: string;
    /** The bitbake recipe packaging `app` on an app-only `os: yocto` slice
     *  (#624). Carried alongside `app` because the SDK requires the pair —
     *  an `app:` with no `recipe:` is refused by `_slice_command` and the
     *  slice is carried as `skipped` / `no-command`. */
    recipe?: string;
  }[];
}

/**
 * Ask what Create WOULD write, without writing it (#616) — `tan init
 * --preview`, answered by `newProjectPreviewData`.
 *
 * Carries the same fields `createNewProject` does, MINUS `openInCurrentWindow`
 * (a post-scaffold decision the preview does not need). Deliberately a
 * SEPARATE interface rather than `Omit<CreateNewProjectMessage, …>` — the two
 * are sent from different points in the wizard for different reasons, and
 * coupling their shapes would make a field added for one silently reshape the
 * other's wire contract too.
 *
 * `destination` is REQUIRED here, unlike `createNewProject`'s optional one:
 * `tan init --preview` still needs somewhere to preview INTO, and the webview
 * does not send this message until the Name step has set one — there is no
 * "prompt with a dialog" fallback for a request the customer did not
 * explicitly make (see `NewProjectFlowView.tsx`'s Confirm-step effect).
 */
export interface RequestNewProjectPreviewMessage {
  type: "requestNewProjectPreview";
  templateId: string;
  moduleId: string;
  projectName: string;
  sdkPath?: string;
  destination: string;
  cores?: { id: string; os: string; app?: string }[];
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
  | RequestNewProjectPreviewMessage
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
  | FlashSliceMessage
  | RequestModelsMessage
  | BuildModelMessage
  | CheckModelFitMessage
  | PrepModelMessage
  | RunModelMessage
  | AbModelsMessage
  | RequestZooMessage
  | AddFromZooMessage;
