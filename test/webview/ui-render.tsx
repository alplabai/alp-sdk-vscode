// SPDX-License-Identifier: Apache-2.0
//
// Renders every Alp IDE webview surface in a headless DOM, feeds it a realistic
// extension state, inspects what the user actually SEES (error/blank states),
// and clicks every button — the real "check the UI" test. esbuild-bundled then
// run under Node; see test/webview/run.mjs.
import "./jsdom-setup.js";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../../packages/alp-webview/src/shared/AppContext";
import { ErrorBoundary } from "../../packages/alp-webview/src/shared/ui";
import { TextInput } from "../../packages/alp-webview/src/features/configurator/ConfiguratorView";
import { OverviewView } from "../../packages/alp-webview/src/features/overview";
import { SidebarHubView } from "../../packages/alp-webview/src/features/sidebar-hub";
import { SetupFlowView } from "../../packages/alp-webview/src/features/setup-flow";
import { NewProjectFlowView } from "../../packages/alp-webview/src/features/new-project-flow";
import {
  CoresStep,
  defaultCoreChoices,
} from "../../packages/alp-webview/src/features/new-project-flow/NewProjectFlowView";
import { ExistingProjectFlowView } from "../../packages/alp-webview/src/features/existing-project-flow";
import { SdkView } from "../../packages/alp-webview/src/features/sdk";
import { DependenciesView } from "../../packages/alp-webview/src/features/dependencies";
import { HardwareExplorerView } from "../../packages/alp-webview/src/features/hardware-explorer";
import { BuildPlanView } from "../../packages/alp-webview/src/features/build-plan";
import { ModelsView } from "../../packages/alp-webview/src/features/models";
// Imported, not hardcoded: a hardcoded `_v: 2` outlived the bump to 3, so every
// AppProvider here saw a protocol mismatch, held `state` at null, and rendered
// nine skeletons that the harness scored as PASS.
import { PROTOCOL_VERSION } from "../../packages/alp-webview/src/types";
import type {
  DependencyAction,
  DependencyRow,
} from "../../packages/alp-webview/src/types";

const g = globalThis as any;
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Drain enough macrotask turns for React to have committed and flushed passive
 * effects, including for components mounted by an ancestor's state update.
 *
 * This used to be two bare `await tick()`s, which was silently too few. React
 * 19 commits passive effects on its own scheduler turn, so a hook subscribing
 * BELOW AppProvider — `useBuildPlan`, and every other feature hook — had not
 * called `onMessage` yet when the harness dispatched its data. Instrumenting
 * `onMessage` showed the nine AppProviders registering as listeners #1-#10 and
 * receiving everything, while `useBuildPlan` registered as #11/#12 after the
 * last dispatch and received nothing at all.
 *
 * The harness reported PASS regardless: it only looked for ERROR_MARKERS, and
 * a view stuck in its loading/empty state contains none. So "9/9 views
 * rendered" meant they rendered EMPTY. Any assertion about data-driven content
 * depends on this settling, which is why the #331 checks below are the first
 * thing that would have caught it.
 */
const settle = async (turns = 12): Promise<void> => {
  for (let i = 0; i < turns; i++) await tick();
};

// Take and clear whatever jsdom-setup's window `error` / `unhandledrejection`
// listeners collected since the last call. Draining (not just reading) keeps
// one broken handler from being re-reported against every later button.
const drainErrors = (): string[] => g.__ALP_ERRORS__.splice(0);

// Error boundary that records the actual render error instead of letting React
// swallow it — so a component that crashes shows up as a PROBLEM, not a pass.
class Boundary extends React.Component<
  { onError: (e: unknown) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  componentDidCatch(err: unknown) {
    this.state.failed = true;
    this.props.onError(err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const readyState = {
  sdk: {
    activePath: "/sdk",
    version: "0.11.0",
    readiness: "ready",
    localEntries: [
      { path: "/sdk", version: "0.11.0", removable: false, active: true },
    ],
  },
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    lastBootstrapAt: null,
    toolVersions: {
      python: "3.11",
      west: "1.2",
      tan: "0.1.0",
      cmake: "3.28",
      ninja: "1.11",
    },
  },
  workspace: {
    workspaceRoot: "/ws",
    boardYamlExists: true,
    westInitialized: true,
  },
};

// One dependency row, with the cells this harness never varies filled in: tan
// reports no per-check version, so `installed`/`latest` are null and the view
// renders a dash.
const row = (
  name: string,
  label: string,
  status: string,
  detail: string,
  hint: string | null = null,
  action: DependencyAction | null = null,
): DependencyRow => ({
  name,
  label,
  status,
  detail,
  hint,
  installed: null,
  latest: null,
  updateAvailable: false,
  action,
});

// The two fallback actions the pinned tan v0.3.1 produces on a POSIX host, with
// the effect + tooltip `fixPresentation` derives from `fixCommand` itself.
const BOOTSTRAP_FIX: DependencyAction = {
  kind: "fix",
  fixId: "west",
  effect: "bootstrap",
  title:
    "Runs the Alp SDK bootstrap in a terminal — installs west and the Zephyr Python dependencies into the workspace venv",
};
const docsFix = (fixId: "build-tools" | "zephyr-sdk"): DependencyAction => ({
  kind: "fix",
  fixId,
  effect: "open-docs",
  title: "Opens the Zephyr docs in your browser — nothing is installed",
});

// Messages that populate the data-driven views (New Project, SDK Manager).
function feedState() {
  g.__ALP_POST_TO_WEBVIEW__({
    type: "stateUpdate",
    _v: PROTOCOL_VERSION,
    state: readyState,
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "projectTemplatesData",
    templates: [
      {
        id: "minimal-app",
        title: "Minimal app",
        description: "A minimal app",
        category: "starter",
      },
      {
        id: "gpio-button-led",
        title: "gpio-button-led",
        description: "GPIO demo",
        category: "example",
        sourceDir: "peripheral-io/gpio-button-led",
      },
    ],
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "sdkReleasesLoaded",
    releases: [
      {
        tag: "v0.11.0",
        publishedAt: "2026-07-01",
        tarballUrl: "https://example/alp.tgz",
        releaseNotesSummary: "0.11.0",
        releaseNotes: "0.11.0 notes",
      },
    ],
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "buildPlanData",
    plan: {
      schemaVersion: 2,
      boardYaml: "board.yaml",
      sku: "E1M-AEN801",
      buildRoot: "build",
      slices: [
        {
          coreId: "m55_hp",
          backend: "zephyr",
          buildDir: "build/m55_hp",
          configArtefacts: [],
          command: { tool: "west", args: ["build"], cwd: "." },
          env: {},
        },
      ],
      sharedArtefacts: [],
      warnings: [],
    },
  });
  // Models panel: a `tan model list`/`doctor` merge, plus REAL
  // `tan model check --board board.yaml [--exact] --format json` payloads
  // captured on E1M-AEN801 (which resolves `ethos_u` only) against
  // metadata/npu_ops/ethos_u/u85@vela-5.1.0.json, with `--exact` run through
  // a real vela 5.1.0. Every backend block below is copied field-for-field
  // and note-for-note from one of those runs — nothing here is a
  // transcription of the vocabulary. Between them the four rows exercise all
  // four badge branches, so a regression in the ADR-0028 mapping shows up as
  // a rendered problem rather than a silent relabel:
  //   tiny          static screen, `full-eligible`  -> eligibility, never green
  //   tiny_compiled the SAME model under `--exact`, `fits` -> proven, green
  //   f32fc         `--exact`, `cpu-only` at 0 % placed, yet its KEPT static
  //                 `ops[0].status` still reads `npu-eligible` — the
  //                 disagreement the op-derived lines are suppressed for
  //   onnxmodel     `undetermined` from a format ethos_u does not ingest
  // (`tiny_compiled` is `tiny`'s `--exact` result under a second name only so
  // both bases can sit in one fixture message.)
  g.__ALP_POST_TO_WEBVIEW__({
    type: "modelsData",
    ok: true,
    models: [
      {
        name: "tiny",
        source: "tiny_int8.tflite",
        artifact: { exists: true, bytes: 712, stale: false },
      },
      {
        name: "tiny_compiled",
        source: "tiny_int8.tflite",
        artifact: { exists: true, bytes: 712, stale: false },
      },
      {
        name: "f32fc",
        source: "float32_fc.tflite",
        artifact: { exists: false },
      },
      {
        name: "onnxmodel",
        source: "v_npu_full.onnx",
        artifact: { exists: false },
      },
    ],
    toolchains: [
      { backend: "ethos_u", tool: "vela", available: true, version: "5.1.0" },
    ],
    issues: [],
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "modelFitData",
    ok: true,
    sku: "E1M-AEN801",
    models: [
      {
        name: "tiny",
        source: "/ws/tiny_int8.tflite",
        backends: [
          {
            backend: "ethos_u",
            variant: "u85",
            table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
            npuCoverage: "full-eligible",
            computeOnNpuPctMax: 100.0,
            npuPlacementPctReal: null,
            uncostedCpuOpCount: 0,
            basis: "static-screen",
            confidence: "screening",
            notes: [
              "static screen (screening): operator-name membership against u85@vela-5.1.0.json only. Eligible ops still carry unchecked quantization/shape/dtype constraints this check cannot verify -- the model will run either way, an unsupported op falls back to the CPU silently rather than failing. Only a real compile proves NPU execution.",
            ],
            ops: [
              {
                op: "FULLY_CONNECTED",
                status: "npu-eligible",
                reason: "constraint-unchecked",
                macs: 8,
              },
            ],
          },
        ],
      },
      {
        name: "tiny_compiled",
        source: "/ws/tiny_int8.tflite",
        backends: [
          {
            backend: "ethos_u",
            variant: "u85",
            table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
            npuCoverage: "fits",
            computeOnNpuPctMax: null,
            npuPlacementPctReal: 100.0,
            uncostedCpuOpCount: 0,
            basis: "compiled",
            confidence: "certain",
            notes: [
              "vela compiled for ethos-u85-256: 1/1 operators placed on the NPU (100%); arena 32 bytes, SRAM 1 KiB.",
              "vela used its BUILT-IN default system-config Ethos_U85_SYS_DRAM_Mid for bandwidth/latency estimates -- no module-authored one is available -- so its scheduling is tuned for that system, not this module's. The arena/SRAM figures are unaffected: they follow --memory-mode Sram_Only, which came from this module's SoC metadata, whose const/arena/cache areas are all one AXI port every system config maps to SRAM.",
            ],
            ops: [],
          },
        ],
      },
      {
        name: "f32fc",
        source: "/ws/float32_fc.tflite",
        backends: [
          {
            backend: "ethos_u",
            variant: "u85",
            table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
            npuCoverage: "cpu-only",
            computeOnNpuPctMax: null,
            npuPlacementPctReal: 0.0,
            uncostedCpuOpCount: 0,
            basis: "compiled",
            confidence: "certain",
            notes: [
              "vela compiled for ethos-u85-256: 0/1 operators placed on the NPU (0%); arena 0 bytes, SRAM 0 KiB.",
              "vela used its BUILT-IN default system-config Ethos_U85_SYS_DRAM_Mid for bandwidth/latency estimates -- no module-authored one is available -- so its scheduling is tuned for that system, not this module's. The arena/SRAM figures are unaffected: they follow --memory-mode Sram_Only, which came from this module's SoC metadata, whose const/arena/cache areas are all one AXI port every system config maps to SRAM.",
            ],
            ops: [
              {
                op: "FULLY_CONNECTED",
                status: "npu-eligible",
                reason: "constraint-unchecked",
                macs: 8,
              },
            ],
          },
        ],
      },
      {
        name: "onnxmodel",
        source: "/ws/v_npu_full.onnx",
        backends: [
          {
            backend: "ethos_u",
            variant: "u85",
            table: null,
            npuCoverage: "undetermined",
            computeOnNpuPctMax: null,
            npuPlacementPctReal: null,
            uncostedCpuOpCount: 0,
            basis: "static-screen",
            confidence: "screening",
            notes: [
              "ethos_u does not ingest 'onnx' source models; no score computed. This is not a verdict on the model, only on the format/backend pairing.",
            ],
            ops: [],
          },
        ],
      },
    ],
    issues: [],
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "zooData",
    ok: true,
    entries: [],
    issues: [],
  });
  // A real post-build manifest, not `null` — the System manifest section was
  // never rendered by this harness at all, so nothing here covered it. The
  // shape is the one #331 is about: one slice that succeeded and one that did
  // not, the latter carrying the `reason` the UI used to drop.
  // #484: the address-space view of that same manifest, host-computed by
  // `buildMemoryView`. Hand-written here rather than derived, so the harness
  // covers all four shapes the renderer branches on and no single-source bug
  // can make the fixture agree with a broken narrower: a sized carve-out (a
  // band), two load addresses with no size (hairline markers), a
  // device-relative partition (no absolute address, by design), and a blocked
  // entry whose reason must reach the screen verbatim. Values are the real
  // E1M-AEN801 ones.
  const MEMORY_VIEW = {
    sku: "E1M-AEN801",
    spans: [
      {
        id: "slot_image:m55_he",
        kind: "slot_image" as const,
        label: "m55_he",
        base: 0x80010000,
        deviceOffset: null,
        sizeBytes: null,
        region: null,
        device: null,
        cores: ["m55_he"],
        fs: null,
      },
      {
        id: "slot_image:m55_hp",
        kind: "slot_image" as const,
        label: "m55_hp",
        base: 0x802b0000,
        deviceOffset: null,
        sizeBytes: null,
        region: null,
        device: null,
        cores: ["m55_hp"],
        fs: null,
      },
      {
        id: "carve_out:alp_shmem0",
        kind: "carve_out" as const,
        label: "alp_shmem0",
        base: 0x80540000,
        deviceOffset: null,
        sizeBytes: 262144,
        region: "mram_main",
        device: null,
        cores: ["m55_hp", "m55_he"],
        fs: null,
      },
      {
        id: "partition:data",
        kind: "partition" as const,
        label: "data",
        base: null,
        deviceOffset: 0,
        sizeBytes: 65536,
        region: null,
        device: "mram_main",
        cores: [],
        fs: "littlefs",
      },
    ],
    unresolved: [
      {
        id: "carve_out:alp_default_rpmsg",
        kind: "carve_out" as const,
        label: "alp_default_rpmsg",
        cores: ["m55_hp", "a32_cluster"],
        status: "blocked",
        // Verbatim from a generated manifest — the sentence names the file and
        // the field to change, and a summarised one names neither.
        reason:
          "memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801; " +
          "this SoM hasn't been HW-mapped yet so IPC carve-outs cannot be " +
          "allocated.",
      },
    ],
  };

  g.__ALP_POST_TO_WEBVIEW__({
    type: "systemManifestData",
    postBuild: true,
    memory: MEMORY_VIEW,
    manifest: {
      schema_version: 1,
      generated_by: "tan",
      hw_info: { sku: "E1M-AEN801" },
      slices: [
        {
          core_id: "m55_hp",
          os: "zephyr",
          status: "ok",
          build_dir: "build/m55_hp",
          output_artefact: "build/m55_hp/zephyr/zephyr.elf",
          flash_method: "jlink",
          toolchain: "arm-zephyr-eabi",
        },
        {
          // No `toolchain` — either an SDK predating the field, or a preset
          // that declares none. Deliberately paired with the slice above that
          // has one, so the harness covers both the reported and the "not
          // reported" branch of the readout.
          core_id: "a32_cluster",
          os: "yocto",
          status: "skipped",
          reason: "bitbake not found",
          log_path: "build/a32_cluster/bitbake.log",
        },
        {
          // `os: "off"` — this slice never builds. The real fixture
          // (test/fixtures/system-manifest.aen801.yaml) carries exactly this
          // shape: an off slice with a `toolchain` value still on it. The
          // build-toolchain row must be gated on `active`, like the Flash
          // button, so this value must NOT reach the screen (asserted below).
          core_id: "a32_idle",
          os: "off",
          status: "pending",
          toolchain: "poky-glibc",
        },
      ],
      ipc: [
        {
          name: "rpmsg0",
          kind: "rpmsg",
          endpoints: ["m55_hp", "a32_cluster"],
          status: "degraded",
          reason: "peer slice skipped",
        },
      ],
      helper_mcus: [],
      boot_order: [],
    },
  });
  // #359: per-slice footprint from `tan size`. Deliberately mixed — one slice
  // in budget with real numbers, one that produced nothing — so the harness
  // covers both the measured and the no-data branch.
  g.__ALP_POST_TO_WEBVIEW__({
    type: "sliceSizesData",
    report: {
      schema: "alp-size/1",
      slices: [
        {
          core_id: "m55_hp",
          os: "zephyr",
          status: "ok",
          flash: { used: 99452, total: 5767168, pct: 1.7 },
          ram: { used: 16968, total: 262144, pct: 6.5 },
          source: "size-tool",
        },
        {
          core_id: "a32_cluster",
          os: "yocto",
          status: "not-built",
          flash: { used: null, total: null, pct: null },
          ram: { used: null, total: null, pct: null },
          source: null,
        },
      ],
      summary: { over_budget: [], unknown_budget: [] },
    },
  });
  // The tan-cli#103 machine, verbatim: `fail: 0` while `ninja` sits at `warn`
  // because tan caps an absent PATH tool there. Ninja is missing, the build
  // cannot run, and the old panel printed "All required tools present" over it.
  // Rows are the pinned tan v0.3.1's own check names and detail strings; counts
  // are tan's summary, which does NOT count the host-owned `tan` row.
  g.__ALP_POST_TO_WEBVIEW__({
    type: "dependencyReport",
    report: {
      counts: { pass: 4, warn: 6, fail: 0 },
      // v0.3.1 emits no `missingPrerequisites`, so actions fall back to the
      // fix ids this extension knows — which is what puts a button on ninja.
      prerequisiteDataUnavailable: true,
      rows: [
        row("sdk", "alp-sdk", "pass", "alp-sdk 0.11.0 selected."),
        row("boardYaml", "board.yaml", "pass", "board.yaml found."),
        row(
          "workspace",
          "Zephyr workspace",
          "pass",
          "Zephyr workspace at /ws.",
        ),
        row("cmake", "CMake", "pass", "cmake is available."),
        row(
          "westResolved",
          "west (workspace)",
          "warn",
          "west not found — run `tan bootstrap` to create the workspace venv",
          "tan bootstrap",
          BOOTSTRAP_FIX,
        ),
        row(
          "west",
          "west",
          "warn",
          "west not found on PATH — needed for Zephyr builds.",
          "Install west via `tan bootstrap`.",
          BOOTSTRAP_FIX,
        ),
        row(
          "ninja",
          "Ninja",
          "warn",
          "ninja not found on PATH — needed for Zephyr builds.",
          "Install Ninja.",
          docsFix("build-tools"),
        ),
        row(
          "zephyrSdk",
          "Zephyr SDK",
          "warn",
          "Zephyr SDK toolchain not detected (ZEPHYR_SDK_INSTALL_DIR unset).",
          "Install the Zephyr SDK: https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html",
          docsFix("zephyr-sdk"),
        ),
        // No button: this extension knows no fix for either, so tan's own prose
        // hint is the whole remedy the user gets.
        row(
          "yoctoHost",
          "Yocto host",
          "warn",
          "Yocto builds are Linux-only; use WSL2 or a Linux host/container.",
          "Run Yocto builds on Linux (WSL2 / Docker).",
        ),
        row(
          "vendorToolchain",
          "Vendor toolchain",
          "warn",
          "Baremetal needs a vendor toolchain (Alif/Renesas/NXP), per SoC family.",
          "Install the vendor toolchain for your SoC (see docs/getting-started.md §8).",
        ),
        {
          ...row("tan", "tan CLI", "pass", "pinned to 0.3.1"),
          installed: "0.3.1",
          latest: { version: "0.3.1", kind: "pin" },
        },
      ],
    },
  });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "hardwareExplorerData",
    som: {
      sku: "E1M-AEN801",
      displayName: "E1M-AEN801 (Alif Ensemble E8)",
      family: "alif-ensemble",
      silicon: "alif:ensemble:e8",
      topology: [],
      onModule: [],
      padRoutes: [],
      i2cDevices: [],
    },
    cores: [{ id: "m55_hp", type: "M55", count: 1 }],
    sdkConnected: true,
  });
}

const VIEWS: Array<[string, React.FC]> = [
  ["overview", OverviewView],
  ["sidebar-hub", SidebarHubView],
  ["setup-flow", SetupFlowView],
  ["new-project-flow", NewProjectFlowView],
  ["existing-project-flow", ExistingProjectFlowView],
  ["sdk-manager", SdkView],
  // The mode string src/deps/panel.ts writes to `<body data-alp-mode>`.
  ["dependencies", DependenciesView],
  ["hardware-explorer", HardwareExplorerView],
  ["build-plan", BuildPlanView],
  ["models", ModelsView],
];

// Text a broken/degraded UI shows — flagged so we SEE the problem, not skip it.
const ERROR_MARKERS = [
  "cli unavailable",
  "alp cli unavailable",
  "failed to",
  "could not",
  "render error",
  "undefined",
  "[object object]",
  "nan",
];

async function main() {
  let totalButtons = 0;
  let totalClicked = 0;
  const problems: string[] = [];
  let rendered = 0;

  for (const [mode, View] of VIEWS) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let ok = true;
    let renderErr: unknown = null;
    try {
      const root = createRoot(container);
      root.render(
        React.createElement(
          Boundary,
          { onError: (e) => (renderErr = e) },
          React.createElement(AppProvider, null, React.createElement(View)),
        ),
      );
      await settle();
      feedState();
      // AppProvider renders its children only once it HAS state, so a feature
      // hook that subscribes below it (useBuildPlan, useModels, …) does not
      // exist until this first feed has been processed and committed. Feed
      // again once it does — see `settle` for why two ticks were never enough.
      await settle();
      feedState();
      await settle();
    } catch (err) {
      ok = false;
      problems.push(`${mode}: RENDER THREW — ${String(err)}`);
    }
    const noteCrash = () => {
      if (!renderErr) return false;
      ok = false;
      problems.push(
        `${mode}: component crashed on render — ${
          renderErr instanceof Error ? renderErr.message : String(renderErr)
        }`,
      );
      renderErr = null;
      return true;
    };
    // Drain before the first click so a report from mount/effects is blamed on
    // the view, not on whichever button happens to be clicked first.
    for (const err of drainErrors()) {
      ok = false;
      problems.push(`${mode}: error reported during render — ${err}`);
    }
    if (noteCrash()) {
      console.log(`  FAIL  ${mode}: render error`);
      continue;
    }
    rendered += 1;

    const text = (container.textContent || "").toLowerCase();
    for (const marker of ERROR_MARKERS) {
      if (text.includes(marker)) {
        problems.push(`${mode}: visible text contains "${marker}"`);
      }
    }
    // #331: a slice that did not build must say WHY. The manifest already
    // carried `reason`, `log_path` and `output_artefact`; the row rendered
    // only the status chip, so "skipped" arrived with no explanation and the
    // produced artefact and log were invisible. `text` is lowercased above.
    if (mode === "build-plan") {
      for (const needle of [
        "bitbake not found", // slice reason
        "build/a32_cluster/bitbake.log", // slice log_path
        "build/m55_hp/zephyr/zephyr.elf", // slice output_artefact
        "peer slice skipped", // ipc link reason
        // #359 — footprint from `tan size`, and the no-data branch beside it.
        "97.1 kib / 5.50 mib (1.7%)", // flash, measured
        "16.6 kib / 256.0 kib (6.5%)", // ram, measured
        "in budget", // status verdict
        "not built", // a slice tan could not measure
        // #314 readout half — the per-slice toolchain from THIS build's
        // emitted manifest, and the explicit absence text for the slice that
        // has none (never a blank cell, never the Hardware Explorer preset).
        "arm-zephyr-eabi", // m55_hp: toolchain reported
        "not reported", // a32_cluster: toolchain absent from the manifest
      ]) {
        if (!text.includes(needle)) {
          problems.push(
            `build-plan: system manifest detail missing "${needle}"`,
          );
        }
      }
      // The build-toolchain row is gated on `active` (`os !== "off"`), same as
      // the Flash button — an `os: "off"` slice never builds, so its manifest
      // toolchain value (a32_idle: "poky-glibc") must not render even though
      // the manifest carries one.
      for (const forbidden of ["poky-glibc"]) {
        if (text.includes(forbidden)) {
          problems.push(
            `build-plan: system manifest rendered "${forbidden}" for an inactive (os: "off") slice`,
          );
        }
      }
      // #484 — the Memory tab. Reached by clicking, because the section opens
      // on Slices; without this the tab would be covered only by the
      // click-every-button sweep below, which asserts nothing about what it
      // then shows.
      const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
      const memoryTab = tabs.find((b) =>
        (b.textContent || "").toLowerCase().includes("memory"),
      );
      if (!memoryTab) {
        problems.push("build-plan: no Memory tab on the system manifest");
      } else {
        (memoryTab as HTMLButtonElement).click();
        await settle();
        const memText = (container.textContent || "").toLowerCase();
        for (const needle of [
          "alp_shmem0", // a sized carve-out, drawn as a band
          "0x80540000 – 0x80580000", // its extent, both ends
          "mram_main", // the region it came from
          "+0 b in mram_main", // the partition: an offset, never an address
          "64.0 kib", // its size
          "size not in the manifest", // a slot address with no size
          "alp-sdk#1365", // what the picture is missing, and why
          // The blocked entry's reason, verbatim.
          "memory_map.base is tbd for region 'mram_main'",
        ]) {
          if (!memText.includes(needle)) {
            problems.push(`build-plan: memory tab missing "${needle}"`);
          }
        }
        // A slot image is a hairline, never a block: the manifest pins its
        // base and says nothing about its size, and an invented height would
        // put a wall where there is a point.
        const bands = Array.from(
          container.querySelectorAll('[data-kind="slot_image"]'),
        );
        if (bands.length === 0) {
          problems.push("build-plan: memory tab drew no slot markers");
        }
        (tabs[0] as HTMLButtonElement).click();
        await settle();
      }
    }
    // The defect this panel exists to remove, asserted at the surface a customer
    // actually reads. Fed the tan-cli#103 report — `fail: 0`, `ninja` at `warn`,
    // Ninja missing — the panel must state the three counts and nothing else.
    // src/toolchain.ts:244 drew `fail === 0` as a verdict and printed "All
    // required tools present" over a build that cannot run; any of these words
    // reaching the screen here means that verdict has grown back.
    if (mode === "dependencies") {
      // `textContent` glues adjacent elements together — the heading and the
      // counts arrive as "dependenciesall required tools present4pass" — which
      // silently defeats a \b match on the first and last word of every string.
      // Strip the tags instead, so each rendered string is its own token.
      // (Leaves HTML entities encoded; none of the words below is one.)
      const spaced = (container.innerHTML || "")
        .replace(/<[^>]*>/g, " ")
        .toLowerCase();
      // The rows must be on screen first — a panel still showing "Running
      // checks…" carries no verdict either, and would pass vacuously.
      if (!spaced.includes("ninja not found on path")) {
        problems.push("dependencies: the ninja warn row did not render");
      }
      for (const word of ["all", "present", "ready"]) {
        // Word boundaries: "Install", "Installed" and "already" are not verdicts.
        if (new RegExp(`\\b${word}\\b`).test(spaced)) {
          problems.push(
            `dependencies: renders the verdict word "${word}" over a warn row`,
          );
        }
      }
    }
    // The Hub Environment card surfaces the tan CLI next to python/west.
    if (mode === "overview" && !text.includes("tan 0.1.0")) {
      problems.push("overview: Environment card missing tan version");
    }
    // SDK Manager is folded into the Hub as a scrollable section.
    if (
      mode === "overview" &&
      !(container.innerHTML || "").includes('id="sdk-section"')
    ) {
      problems.push("overview: SDK Manager section missing");
    }
    // Sidebar Setup section is actions-only now: the "Host Tools" status
    // read-out is gone (moved to the status bar + Hub) and the Hub link is
    // present. (Other sections keep their contextual status rows.)
    if (mode === "sidebar-hub") {
      if (text.includes("host tools")) {
        problems.push("sidebar-hub: Host Tools status row still present");
      }
      if (!text.includes("hub")) {
        problems.push("sidebar-hub: Hub link missing");
      }
    }

    // The Models panel must never render the retired `fits | cpu-fallback |
    // no-fit` vocabulary, and must never turn `undetermined` into a negative.
    if (mode === "models") {
      // Anchored on the old panel's `${backend}: ${FIT_LABEL[verdict]}` badge
      // shape, NOT on the bare words: "certain CPU fallback" is tan's own
      // current wording for the cpu-certain op list, so a bare "cpu fallback"
      // needle would fire on correct output.
      for (const retired of [": cpu fallback", ": no fit", ": fits"]) {
        if (text.includes(retired)) {
          problems.push(
            `models: retired verdict vocabulary rendered ("${retired}")`,
          );
        }
      }
      // Anchored on the BADGE, not the bare words. `UNDETERMINED_CAVEAT`
      // contains the string "not determined" and renders under the same
      // `anyUndetermined` condition as the badge itself, so a bare needle was
      // satisfied by the caveat and could never fail: renaming the badge to
      // "ZZZ", or flipping its variant to `err`, both left this green. The
      // `onnxmodel` fixture's undetermined backend is `ethos_u`/`u85`.
      if (!text.includes("ethos-u85: not determined")) {
        problems.push(
          "models: `undetermined` backend not rendered as 'not determined'",
        );
      }
      if (!text.includes("all ops npu-eligible")) {
        problems.push(
          "models: static-screen positive not rendered as eligibility",
        );
      }
      if (!text.includes("all ops on npu (proven)")) {
        problems.push("models: compiled result not rendered as proven");
      }
      // The compiled `cpu-only` row must report the compiler's own placement,
      // never a figure recomputed from the STATIC per-op verdicts it keeps —
      // those still read `npu-eligible` beside a real 0 % placement.
      if (!text.includes("0% of operators placed on the npu")) {
        problems.push(
          "models: proven result not rendered as compiler-measured placement",
        );
      }
      if (!text.includes("falls back to the cpu silently")) {
        problems.push("models: silent-CPU-fallback caveat missing from the UI");
      }
    }

    const buttons = Array.from(container.querySelectorAll("button"));
    if (process.env.ALP_DUMP) {
      console.log(
        `  [dump ${mode}] html=${(container.innerHTML || "").length}b :: ${(container.textContent || "").trim().slice(0, 120)}`,
      );
    }
    totalButtons += buttons.length;
    let clickedHere = 0;
    for (const btn of buttons) {
      const before = g.__ALP_POSTED__.length;
      const label = (btn.textContent || "").trim().slice(0, 30);
      try {
        (btn as HTMLButtonElement).click();
        await tick();
        clickedHere += 1;
        totalClicked += 1;
      } catch (err) {
        // Only a throw from click() ITSELF (a jsdom fault) reaches here — a
        // handler's own throw is reported, not propagated. drainErrors() below
        // is what actually catches a broken button.
        problems.push(
          `${mode}: button "${label}" threw on click — ${String(err)}`,
        );
      }
      for (const err of drainErrors()) {
        ok = false;
        problems.push(`${mode}: button "${label}" threw on click — ${err}`);
      }
      void before;
    }
    await tick();
    noteCrash(); // catch a crash triggered by a click or a late re-render
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${mode}: rendered, ${buttons.length} button(s), clicked ${clickedHere}`,
    );
  }

  // ── the example filter degrades to nothing when there is nothing to filter (#482 §5) ──
  // #507 landed the domain chips and the grouped headings. The degrade posture
  // -- "when the fields are absent, hide the filter row rather than showing
  // empty controls" -- was implemented with it but never gated: the derivation
  // (`exampleCategory`) has nine tests, the RENDER had none. `domains.length >
  // 1` is one character away from `>= 1`, and an older tan that sends no
  // category is exactly the case nobody re-runs by hand.
  {
    const CHIP_ROW = '[aria-label="Filter examples by domain"]';
    const example = (id: string, group?: string) => ({
      id,
      title: id,
      description: `${id} demo`,
      category: "example",
      sourceDir: `dir/${id}`,
      ...(group ? { group } : {}),
    });

    const cases: Array<{
      name: string;
      templates: unknown[];
      wantRow: boolean;
    }> = [
      // An older tan sends no category at all; nothing is derivable.
      {
        name: "no group on any example",
        templates: [example("a"), example("b")],
        wantRow: false,
      },
      // One chip is a control with nothing to choose -- still hidden.
      {
        name: "exactly one group",
        templates: [example("a", "ai"), example("b", "ai")],
        wantRow: false,
      },
      // Two domains is the first state where filtering means anything.
      {
        name: "two groups",
        templates: [example("a", "ai"), example("b", "peripheral-io")],
        wantRow: true,
      },
    ];

    for (const c of cases) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      root.render(
        React.createElement(
          AppProvider,
          null,
          React.createElement(NewProjectFlowView),
        ),
      );
      await settle();
      feedState();
      await settle();
      g.__ALP_POST_TO_WEBVIEW__({
        type: "projectTemplatesData",
        templates: c.templates,
      });
      await settle();

      const row = container.querySelector(CHIP_ROW);
      if (c.wantRow && !row) {
        problems.push(
          `example-filter-degrade: ${c.name} -- the filter row is missing, so two domains cannot be narrowed`,
        );
      }
      if (!c.wantRow && row) {
        problems.push(
          `example-filter-degrade: ${c.name} -- an empty filter row rendered, which is the control #482 §5 says to hide`,
        );
      }
      // Whatever the row does, the examples themselves must still be reachable:
      // hiding the control must never hide the content it filters.
      const text = container.textContent ?? "";
      for (const id of ["a", "b"]) {
        if (!text.includes(`${id} demo`)) {
          problems.push(
            `example-filter-degrade: ${c.name} -- example "${id}" did not render`,
          );
        }
      }
    }

    // An ungrouped example alongside grouped ones goes in a trailing bucket,
    // never under a heading with an empty name.
    {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      root.render(
        React.createElement(
          AppProvider,
          null,
          React.createElement(NewProjectFlowView),
        ),
      );
      await settle();
      feedState();
      await settle();
      g.__ALP_POST_TO_WEBVIEW__({
        type: "projectTemplatesData",
        templates: [
          example("a", "ai"),
          example("b", "peripheral-io"),
          example("c"),
        ],
      });
      await settle();
      const text = container.textContent ?? "";
      if (!text.includes("c demo")) {
        problems.push(
          "example-filter-degrade: an ungrouped example vanished when its siblings had groups",
        );
      }
    }

    console.log(
      `  ${problems.length === 0 ? "PASS" : "FAIL"}  example-filter-degrade: the filter row appears only when it can narrow`,
    );
  }

  // ── the CLI-capability gap is ONE notice, not four alarms (#522) ──
  // The pinned tan (0.6.0, re-measured at GA — #609) implements only `model
  // build` and refuses the
  // other eight subcommands the panel drives. Every refusal used to render on
  // its own, so one fact reached the customer as FOUR red `Models unavailable`
  // banners carrying tan's command-line text. Feed the real refusal envelope
  // and assert the panel states it once, in the neutral style, with the actions
  // it cannot drive switched off.
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const refusal = (sub: string) => ({
      code: "model.unknown-subcommand",
      severity: "error",
      message: `Unknown model subcommand: ${sub}. Available: build.`,
    });
    const root = createRoot(container);
    root.render(
      React.createElement(AppProvider, null, React.createElement(ModelsView)),
    );
    await settle();
    feedState();
    await settle();
    feedState();
    await settle();
    g.__ALP_POST_TO_WEBVIEW__({
      type: "modelsData",
      ok: false,
      models: [],
      toolchains: [],
      issues: [refusal("list"), refusal("doctor")],
    });
    g.__ALP_POST_TO_WEBVIEW__({
      type: "modelFitData",
      ok: false,
      sku: null,
      models: [],
      issues: [refusal("check")],
    });
    g.__ALP_POST_TO_WEBVIEW__({
      type: "zooData",
      ok: false,
      entries: [],
      issues: [refusal("zoo")],
    });
    await settle();

    const text = container.textContent ?? "";
    const alarms = container.querySelectorAll('[data-ok="false"]').length;
    if (alarms !== 0) {
      problems.push(
        `models-cli-gap: ${alarms} red alarm banner(s) still rendered for a capability gap`,
      );
    }
    if (!text.includes("These model tools need a newer CLI.")) {
      problems.push("models-cli-gap: the capability notice was not rendered");
    }
    // Stated ONCE. The whole defect was the same fact repeated per section.
    const stated = text.split("These model tools need a newer CLI.").length - 1;
    if (stated !== 1) {
      problems.push(
        `models-cli-gap: notice rendered ${stated} times, want exactly 1`,
      );
    }
    const labels = [...container.querySelectorAll("button")].map((b) => ({
      label: (b.textContent ?? "").trim(),
      disabled: (b as HTMLButtonElement).disabled,
    }));
    for (const want of [
      "Check NPU coverage",
      "Prep model",
      "Run model",
      "A/B compare",
    ]) {
      const hit = labels.find((l) => l.label === want);
      if (!hit) {
        problems.push(`models-cli-gap: no "${want}" button to check`);
      } else if (!hit.disabled) {
        problems.push(
          `models-cli-gap: "${want}" is clickable against a CLI that cannot run it`,
        );
      }
    }
    // `model build` IS implemented — switching Refresh off would be a second
    // wrong answer, hiding the one action that still works.
    const refreshBtn = labels.find((l) => l.label === "Refresh");
    if (refreshBtn && refreshBtn.disabled) {
      problems.push("models-cli-gap: Refresh was disabled, but it still works");
    }
    console.log(
      `  ${problems.length === 0 ? "PASS" : "FAIL"}  models-cli-gap: one notice, unusable actions disabled`,
    );
  }

  // ── the wizard's Cores step (#534) ──
  // `tan init --cores` splices companions APP-LESS, so before this step a
  // dual-M55 SoM — the Alif Ensemble line's defining topology — scaffolded as a
  // single-core project with the second M55 absent from board.yaml entirely.
  // Two things are pinned: the DEFAULT layout (the first Zephyr core must land
  // on `./src`, because that is where `tan init` puts the template's real
  // source — anything else orphans it), and that a core built from a Yocto
  // image offers no app directory to type into.
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const problemsBefore = problems.length;

    // Verbatim from `tan presets` at alp-sdk v0.16.0-rc1.
    const AEN801 = [
      { id: "a32_cluster", os: "yocto" },
      { id: "m55_hp", os: "zephyr" },
      { id: "m55_he", os: "zephyr" },
    ];
    const defaults = defaultCoreChoices(AEN801);
    const byId = Object.fromEntries(defaults.map((c) => [c.id, c]));

    if (byId.m55_hp?.app !== "./src") {
      problems.push(
        `cores-step: the first Zephyr core must default to ./src (tan's own directory) — got "${byId.m55_hp?.app}"`,
      );
    }
    if (byId.m55_he?.app !== "./m55_he") {
      problems.push(
        `cores-step: the second Zephyr core must get its own directory — got "${byId.m55_he?.app}"`,
      );
    }
    if (byId.a32_cluster?.app !== "") {
      problems.push(
        `cores-step: a yocto core must get no app directory — got "${byId.a32_cluster?.app}"`,
      );
    }
    if (byId.m55_hp?.app === byId.m55_he?.app) {
      problems.push(
        "cores-step: two cores defaulted to the same directory — tan build would build one source twice",
      );
    }

    const root = createRoot(container);
    root.render(
      React.createElement(CoresStep, {
        choices: defaults,
        onChange: () => {},
        isExample: false,
      }),
    );
    await settle();

    const rows = container.querySelectorAll("select");
    if (rows.length !== 3) {
      problems.push(
        `cores-step: expected one runtime picker per declared core, got ${rows.length}`,
      );
    }
    const yoctoInput = container.querySelector(
      'input[aria-label="App directory for a32_cluster"]',
    ) as HTMLInputElement | null;
    if (!yoctoInput) {
      problems.push(
        "cores-step: the yocto core had no app-directory field at all",
      );
    } else if (yoctoInput.disabled) {
      // THE RULE MOVED, and this assertion is inverted on purpose (#624).
      //
      // It used to require the field be inert, on the reading that a Linux
      // core's image always comes from a recipe rather than this project. That
      // is the DEFAULT, not the whole story: `board.schema.json` documents an
      // app-only `os: yocto` slice — `app:` naming a project-relative source
      // directory, `recipe:` naming the bitbake recipe that packages it, no
      // `image:` — and the wizard could never produce it, which is what #624
      // opened about.
      //
      // The field is now live. The stock image is still what a Linux core gets
      // by default (`defaultCoreChoices` leaves it empty), and the pair is
      // still indivisible — the recipe input below is what enforces that.
      problems.push(
        "cores-step: a yocto core's app directory must be typeable — the " +
          "app-only slice (app: + recipe:, no image:) is a documented mode " +
          "and the wizard is its only path (#624)",
      );
    }

    // The PAIR, which is what actually decides whether the slice builds
    // (#624). `_slice_command`'s yocto branch returns None for an `app:` with
    // no `recipe:`, so the recipe field is not decoration — without it the
    // wizard could express only the unbuildable half.
    //
    // Asserted by RE-RENDERING rather than by typing: `CoresStep` is
    // controlled, so an `input` event only calls `onChange` and the harness
    // holds `choices` fixed. What is under test here is the rendering rule —
    // the recipe field follows the app directory — and that is exactly what a
    // second render with a filled-in choice measures.
    const recipeBefore = container.querySelector(
      'input[aria-label="Bitbake recipe for a32_cluster"]',
    );
    if (recipeBefore) {
      problems.push(
        "cores-step: the recipe field is shown before an app directory is " +
          "typed — a recipe with nothing to package is not a slice",
      );
    }
    root.render(
      React.createElement(CoresStep, {
        choices: defaults.map((c) =>
          c.id === "a32_cluster" ? { ...c, app: "./linux" } : c,
        ),
        onChange: () => {},
        isExample: false,
      }),
    );
    await settle();
    if (
      !container.querySelector(
        'input[aria-label="Bitbake recipe for a32_cluster"]',
      )
    ) {
      problems.push(
        "cores-step: a Linux core WITH an app directory offered no recipe " +
          "field — an app: without a recipe: is carried by the SDK as " +
          "skipped/no-command, so the wizard would express only the " +
          "unbuildable half",
      );
    }
    const hpInput = container.querySelector(
      'input[aria-label="App directory for m55_hp"]',
    ) as HTMLInputElement | null;
    if (hpInput?.disabled) {
      problems.push(
        "cores-step: a Zephyr core's app directory must be editable",
      );
    }

    // An example brings its own board.yaml; the step must not offer edits that
    // would be overwritten.
    root.render(
      React.createElement(CoresStep, {
        choices: defaults,
        onChange: () => {},
        isExample: true,
      }),
    );
    await settle();
    if (container.querySelectorAll("select").length !== 0) {
      problems.push(
        "cores-step: an example's cores must not be offered for editing — its board.yaml already assigns them",
      );
    }

    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  cores-step: every declared core is assignable`,
    );
  }

  // ── the configurator's inputs must be typeable (#532) ──
  // The `value` prop is the HOST's view model, which lags every keystroke by a
  // full round-trip: the mutation is debounced 200 ms, written to the document,
  // re-parsed, and posted back as `configuratorRender`. Bound straight to that,
  // React re-rendered each keystroke with the stale value and WIPED the
  // character just typed — "./peer" came out as nothing, or as one letter.
  //
  // Reproduced exactly that way here: type, then re-render with the OLD prop,
  // which is what the lagging echo does. The field must still hold what the
  // customer typed. Then blur and push a new prop — a field nobody is typing in
  // must still follow the document, or an external YAML edit would never show.
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const problemsBefore = problems.length;
    const typed: string[] = [];
    const root = createRoot(container);

    root.render(
      React.createElement(TextInput, {
        label: "App directory",
        value: "",
        placeholder: "./src",
        onChange: (v: string) => typed.push(v),
      }),
    );
    await settle();

    const input = container.querySelector(
      'input[aria-label="App directory"]',
    ) as HTMLInputElement | null;
    if (!input) {
      problems.push(
        "configurator-typing: the App directory input did not render",
      );
    } else {
      // jsdom + React: set through the native setter so React's own value
      // tracker does not swallow the event as a no-op.
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      input.focus();
      for (const text of ["./p", "./pe", "./pee", "./peer"]) {
        setValue?.call(input, text);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
        // The stale echo: the host has not caught up, so it re-renders with the
        // value it still believes in.
        root.render(
          React.createElement(TextInput, {
            label: "App directory",
            value: "",
            placeholder: "./src",
            onChange: (v: string) => typed.push(v),
          }),
        );
        await settle();
      }

      if (input.value !== "./peer") {
        problems.push(
          `configurator-typing: a stale host echo overwrote the field — expected "./peer", got "${input.value}"`,
        );
      }
      if (typed[typed.length - 1] !== "./peer") {
        problems.push(
          `configurator-typing: the last keystroke never reached onChange — got "${typed[typed.length - 1] ?? "nothing"}"`,
        );
      }

      // Blurred, the field must accept the document again.
      input.blur();
      root.render(
        React.createElement(TextInput, {
          label: "App directory",
          value: "./from-disk",
          placeholder: "./src",
          onChange: (v: string) => typed.push(v),
        }),
      );
      await settle();
      if (input.value !== "./from-disk") {
        problems.push(
          `configurator-typing: a blurred field ignored an external edit — expected "./from-disk", got "${input.value}"`,
        );
      }
    }
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  configurator-typing: a stale echo cannot eat a keystroke`,
    );
  }

  // ── the real ErrorBoundary, not the harness's own (#517) ──
  // Every view above is wrapped by `ErrorBoundary` in App.tsx. Without it a
  // throwing render unmounts the whole tree and leaves an EMPTY panel, which
  // reads to a customer as "nothing to report" rather than "this broke". Assert
  // the boundary turns that into words, and that the words name the failure —
  // a boundary rendering a bare "something went wrong" swaps a blank panel for
  // an uninformative one and no bug report survives it.
  {
    const container = document.createElement("div");
    document.body.appendChild(container);
    function Throws(): React.ReactElement {
      throw new Error("harness-induced render failure");
    }
    let threw = false;
    try {
      const root = createRoot(container);
      root.render(
        React.createElement(ErrorBoundary, null, React.createElement(Throws)),
      );
      await settle();
    } catch (err) {
      threw = true;
      problems.push(`error-boundary: escaped the boundary — ${String(err)}`);
    }
    const text = (container.textContent ?? "").toLowerCase();
    if (!threw && text.length === 0) {
      problems.push(
        "error-boundary: rendered nothing — a blank panel is the failure it exists to prevent",
      );
    }
    if (!threw && !text.includes("this view failed to render")) {
      problems.push("error-boundary: did not say the view failed to render");
    }
    if (!threw && !text.includes("harness-induced render failure")) {
      problems.push(
        "error-boundary: swallowed the error message, leaving nothing to report a bug with",
      );
    }
    console.log(
      `  ${problems.length === 0 ? "PASS" : "FAIL"}  error-boundary: caught a throwing render`,
    );
  }

  console.log(
    `\nwebview-ui: ${rendered}/${VIEWS.length} views rendered, ` +
      `${totalClicked}/${totalButtons} buttons clicked, ${problems.length} problem(s)`,
  );
  if (problems.length) {
    for (const p of problems) console.log(`  PROBLEM  ${p}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("webview-ui harness crashed:", err);
  process.exit(1);
});
