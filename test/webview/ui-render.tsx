// SPDX-License-Identifier: Apache-2.0
//
// Renders every Alp IDE webview surface in a headless DOM, feeds it a realistic
// extension state, inspects what the user actually SEES (error/blank states),
// and clicks every button — the real "check the UI" test. esbuild-bundled then
// run under Node; see test/webview/run.mjs.
import "./jsdom-setup.js";
// esbuild's `text` loader (configured in run.mjs) inlines these as plain
// strings AT BUNDLE TIME — before the bundle ever runs from the temp
// directory run.mjs builds it into. Reading them with fs + __dirname at
// RUN time would resolve against that temp directory instead of this
// file's real location; see run.mjs's own comment.
declare module "*.yaml" {
  const content: string;
  export default content;
}
import aenFixtureText from "../fixtures/system-manifest.rpmsg-aen.memory.yaml";
import v2nFixtureText from "../fixtures/system-manifest.rpmsg-v2n.memory.yaml";
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
// #484: the harness runs the REAL narrower, not a hand-written payload.
import { buildMemoryView } from "../../packages/alp-core/src/systemManifest/memoryView";
import { parseSystemManifest } from "../../packages/alp-core/src/systemManifest/service";
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
  // #484: the address-space view of that same manifest. NOT hand-written —
  // `buildMemoryView` is the narrower the panel itself runs, so this harness
  // exercises the real thing end to end. A hand-written payload is what let the
  // first revision ship reading the resolver's dataclass field names instead of
  // the keys the emitter writes: the fixture agreed with the broken code and
  // every gate was green. The manifest above therefore carries the EMITTER's
  // keys (`carve_out_base`, `carve_out_size`, `carve_out_region`,
  // `offset_kib`), verbatim in shape.

  const MANIFEST = {
    schema_version: 1,
    generated_by: "tan",
    hw_info: { sku: "E1M-AEN801" },
    slices: [
      {
        // The second M55: a load address and NO tan-size row, so a hairline
        // with no budget band beside one that has both. It also makes the
        // window's span indivisible by the 22x detail factor, which is what
        // lets the fractional-address gate below actually fire — a gate that
        // cannot go red is not a gate.
        core_id: "m55_he",
        os: "zephyr",
        status: "ok",
        board: "alp_e1m_aen801_m55_he",
        flash_args: { slot0_load_address: "0x80010000" },
      },
      {
        core_id: "m55_hp",
        os: "zephyr",
        status: "ok",
        build_dir: "build/m55_hp",
        output_artefact: "build/m55_hp/zephyr/zephyr.elf",
        flash_method: "jlink",
        toolchain: "arm-zephyr-eabi",
        flash_args: { slot0_load_address: "0x802b0000" },
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
      {
        // A RESOLVED carve-out, in the emitter's own spelling: quoted hex,
        // `carve_out_*` keys, and no `status` at all — absence is what
        // "resolved" looks like in this contract.
        name: "alp_shmem0",
        kind: "raw_shmem",
        endpoints: ["m55_hp", "a32_cluster"],
        carve_out_base: "0x80540000",
        carve_out_size: "0x00040000",
        carve_out_region: "mram_main",
        cacheable: false,
        mailbox_channel: 0,
      },
      {
        // Pinned by hand onto the HP image slot (`ipc[].address:`). The
        // allocator compares carve-outs against carve-outs in the same
        // region, so this pair is checked nowhere upstream — the view's own
        // conflict pass is the only thing that reports it.
        name: "alp_shmem1",
        kind: "raw_shmem",
        endpoints: ["m55_hp", "m55_he"],
        carve_out_base: "0x802b0000",
        carve_out_size: "0x00001000",
        carve_out_region: "mram_main",
        cacheable: false,
        mailbox_channel: 1,
      },
    ],
    storage: [
      {
        name: "data",
        fs: "littlefs",
        flash_device: "storage",
        dt_label: "storage",
        offset_kib: 0,
        size_kib: 64,
        mount: "/lfs",
      },
    ],
    helper_mcus: [],
    boot_order: [],
  };
  g.__ALP_POST_TO_WEBVIEW__({
    type: "systemManifestData",
    postBuild: true,
    manifest: MANIFEST,
    memory: buildMemoryView(MANIFEST as never),
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

/**
 * Dispatch a real `keydown` and hand the event back, so a check can read
 * `defaultPrevented` as well as what the handler did with it.
 *
 * `bubbles` is not optional: React listens on the root container, never on
 * the row itself, so an event dispatched without it reaches no handler at all
 * and every assertion downstream of it passes by measuring nothing.
 */
function pressKey(el: Element, key: string): Event {
  const view = window as unknown as { KeyboardEvent: typeof KeyboardEvent };
  const event = new view.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  return event;
}

/**
 * A tab stop's own name, so a failure message says WHICH element it found.
 *
 * BOUNDED. When focus has fallen off the widget entirely `document
 * .activeElement` is `<body>`, whose `textContent` is every rendered view in
 * this harness at once — 70 KB of prose in what was meant to be a one-line
 * failure. The tag name is what actually identifies that case.
 */
function describeStop(el: Element): string {
  const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
  if (name.length === 0) return `<${el.tagName.toLowerCase()}>`;
  // A row's accessible name is a ", "-joined list whose FIRST segment is the
  // row's own name, so that segment is the identifying half; everything after
  // it is authority class and provenance, which no failure here is about.
  const head = name.split(", ")[0];
  return head.length > 60 ? `<${el.tagName.toLowerCase()}>` : head;
}

/**
 * `els` holds exactly ONE tab stop, it is `expected`, and every other element
 * carries an explicit `tabindex="-1"`.
 *
 * READ FROM THE NEGATIVE, ON PURPOSE. Counting elements whose `tabindex`
 * equals `"0"` reads 1 the moment the active one is marked, and goes on
 * reading 1 whether the rest carry `-1` or carry no `tabindex` attribute at
 * all — and a native `<button>` with no `tabindex` is Tab-reachable anyway.
 * A positive count cannot see what is missing: absence is not -1. Both tab
 * strips this harness checks were in exactly that state (three `role="tab"`
 * buttons, no `tabindex` attribute on any of them), where a count of
 * `tabindex="0"` reads 0 rather than the 3 tab stops a user actually meets.
 */
function checkRovingTabStop(
  els: Element[],
  expected: Element | null,
  what: string,
  passName: string,
  problems: string[],
) {
  const stops = els.filter((e) => e.getAttribute("tabindex") === "0");
  if (stops.length !== 1) {
    problems.push(
      `${passName}: ${stops.length} of ${els.length} ${what} carry tabindex="0", want exactly 1`,
    );
  } else if (expected && stops[0] !== expected) {
    problems.push(
      `${passName}: the ${what} tab stop is "${describeStop(stops[0])}", want "${describeStop(expected)}"`,
    );
  }
  const stillReachable = els.filter(
    (e) => e !== stops[0] && e.getAttribute("tabindex") !== "-1",
  );
  if (stillReachable.length > 0) {
    problems.push(
      `${passName}: ${stillReachable.length} of ${els.length} ${what} carry no tabindex="-1" and stay Tab-reachable — a single tabindex="0" does not make a roving model`,
    );
  }
}

/**
 * Every heading in `container`, read in document order, starts at h1 and
 * skips no rung on the way down.
 *
 * Two separate faults, and the flat-set one is the easier to miss. A panel
 * whose headings are all h3 skips nothing BETWEEN them, so a "no skipped
 * level" check alone calls it well-formed — while the outline it builds has
 * no top at all, and a reader jumping by heading arrives in the middle of a
 * document with nothing above them saying which one it is.
 */
function checkHeadingOutline(
  container: HTMLElement,
  passName: string,
  problems: string[],
) {
  const levels = Array.from(
    container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  ).map((h) => Number(h.tagName.slice(1)));
  if (levels.length === 0) {
    problems.push(`${passName}: the view renders no headings at all`);
    return;
  }
  if (levels[0] !== 1) {
    problems.push(
      `${passName}: the outline starts at h${levels[0]} — the panel has no root heading`,
    );
  }
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      problems.push(
        `${passName}: the heading outline jumps from h${levels[i - 1]} to h${levels[i]}`,
      );
    }
  }
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

// Everything the Build Plan page must still say over the `feedState()`
// manifest, at every width — the wide "build-plan" pass and the narrow pass
// further down check the SAME list, so a narrow width cannot pass by
// checking less. Matched against `reachableText()`: visible text plus every
// `aria-label` and `title`, because a strip box narrower than its name
// keeps the name in its accessible name rather than clipping it mid-glyph.
const BUILD_PLAN_NEEDLES = [
  "bitbake not found", // the skipped core's reason, on its own row
  "build/a32_cluster/bitbake.log", // its log_path, in the row's details
  "build/m55_hp/zephyr/zephyr.elf", // output_artefact, in the details
  "peer slice skipped", // the degraded link's reason, verbatim
  // #359 — footprint from `tan size`: the rounded figure and the percentage
  // on the row, the exact hex in the row's details.
  "97.1 kib",
  "of 5.50 mib",
  "1.7%",
  "16.6 kib",
  "of 256 kib",
  "6.5%",
  "0x1847c",
  "skipped", // a32_cluster: the manifest's own status word
  "arm-zephyr-eabi", // m55_hp: toolchain reported
  "not reported", // a32_cluster: toolchain absent from the manifest
  // The memory strip (#484): a sized carve-out, its INCLUSIVE last byte,
  // the region it came from, the partition's exact device offset, and the
  // conflict the allocator never checks — stated beside the picture.
  "alp_shmem0",
  "0x80540000 – 0x8057ffff",
  "mram_main",
  "+0x0 in storage",
  "64 kib",
  "covers an image load address",
  "0x802b0000",
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

/** Visible text plus every accessible name and tooltip under `root`,
 *  lowercased — what a reader or a screen reader can reach. */
function reachableText(root: Element): string {
  const attrs = Array.from(root.querySelectorAll("[aria-label], [title]"))
    .flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title")])
    .filter((v): v is string => !!v);
  return `${root.textContent || ""}\n${attrs.join("\n")}`.toLowerCase();
}

/** Every strip item a reader can select, in DOM order. */
const stripItems = (root: Element): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));

/** The strip item whose accessible name starts with `name`. */
const stripItem = (root: Element, name: string): HTMLButtonElement | null =>
  stripItems(root).find((b) =>
    (b.getAttribute("aria-label") || "").startsWith(name),
  ) ?? null;

/** An address is an integer or it is not an address: `0x80291745.d`
 *  reached a real screen once (the old fixed-magnification detail rail).
 *  Checked per LEAF element and per attribute, never on a glued
 *  `textContent` — `0x802b1000` beside `4.0 KiB` would otherwise read as
 *  one fractional number. */
function checkNoFractionalAddress(
  root: Element,
  passName: string,
  problems: string[],
) {
  const re = /0x[0-9a-fA-F]+\.[0-9a-fA-F]+/;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const candidates = [
      el.children.length === 0 ? el.textContent || "" : "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
    ];
    for (const text of candidates) {
      const frac = text.match(re);
      if (frac) {
        problems.push(
          `${passName}: rendered a fractional address "${frac[0]}"`,
        );
      }
    }
  }
}

/** Mount one Build Plan panel over `manifest` (run through the REAL
 *  narrower, never a hand-written memory payload) and the given sizes. */
async function mountBuildPlan(
  manifest: unknown,
  sizes: unknown[] = [],
  provenance: unknown = null,
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  createRoot(container).render(
    React.createElement(AppProvider, null, React.createElement(BuildPlanView)),
  );
  await settle();
  feedState();
  await settle();
  feedState();
  await settle();
  g.__ALP_POST_TO_WEBVIEW__({
    type: "systemManifestData",
    postBuild: true,
    manifest,
    provenance,
    memory: buildMemoryView(manifest as never),
  });
  await settle();
  g.__ALP_POST_TO_WEBVIEW__({
    type: "sliceSizesData",
    report: {
      schema: "alp-size/1",
      slices: sizes,
      summary: { over_budget: [], unknown_budget: [] },
    },
  });
  await settle();
  return container;
}

/** The host messages posted since `since`. */
const postedSince = (since: number) =>
  (g.__ALP_POSTED__ as Array<{ type: string; [k: string]: unknown }>).slice(
    since,
  );

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
      // Paths, flash wiring and exact sizes sit behind each row's
      // disclosure, a link's reason behind "Show reason". Open every one, so
      // the needles assert the data is REACHABLE, not merely drawn first.
      for (const toggle of Array.from(
        container.querySelectorAll('button[aria-expanded="false"]'),
      )) {
        (toggle as HTMLButtonElement).click();
      }
      await settle();
      const reach = reachableText(container);
      for (const needle of BUILD_PLAN_NEEDLES) {
        if (!reach.includes(needle)) {
          problems.push(`build-plan: missing "${needle}"`);
        }
      }
      // The toolchain is gated on `active` (`os !== "off"`), same as the
      // Flash button — an `os: "off"` slice never builds, so its manifest
      // toolchain value (a32_idle: "poky-glibc") must not render even though
      // the manifest carries one.
      if (reach.includes("poky-glibc")) {
        problems.push(
          'build-plan: rendered "poky-glibc" for an inactive (os: "off") slice',
        );
      }
      // The page says every fact once: no summary strip, no "needs
      // attention" list repeating what the rows already say.
      for (const retired of ["needs attention", "largest flash use"]) {
        if (reach.includes(retired)) {
          problems.push(`build-plan: the retired "${retired}" surface is back`);
        }
      }
      // #484 — the memory strip. A run neither a span nor a region occupies
      // is COMPRESSED and MARKED, never silently drawn to scale or dropped.
      // This manifest has no `memory:` table, so the 0x2a0000 B run between
      // m55_he's own load address and m55_hp's slot is a real gap.
      if (!container.querySelector("[data-strip-width]")) {
        problems.push("build-plan: no memory strip was drawn");
      }
      const gapMarks = container.querySelectorAll('[data-segment="gap"]');
      if (gapMarks.length === 0) {
        problems.push("build-plan: no compressed gap was marked on the strip");
      }
      for (const mark of Array.from(gapMarks)) {
        if (!/\d/.test(mark.getAttribute("title") || "")) {
          problems.push(
            "build-plan: a compressed gap does not state how much it compressed",
          );
        }
      }
      checkNoFractionalAddress(container, "build-plan", problems);
      // Selecting a slot on the strip prints its exact figures: the range
      // to the slot's INCLUSIVE last byte, the size, the exact used bytes.
      const hp = stripItem(container, "m55_hp");
      if (!hp) {
        problems.push('build-plan: no strip item for "m55_hp"');
      } else {
        hp.click();
        await settle();
        const detail = (container.textContent || "").toLowerCase();
        for (const needle of [
          "0x802b0000 – 0x8082ffff", // base + the 5.50 MiB tan-size budget
          "5.50 mib",
          "from tan size",
          "0x1847c",
        ]) {
          if (!detail.includes(needle)) {
            problems.push(
              `build-plan: selected-slot detail missing "${needle}"`,
            );
          }
        }
        if (hp.getAttribute("aria-pressed") !== "true") {
          problems.push("build-plan: clicking a strip item did not select it");
        }
        // ONE roving tab stop over the strip's items, moved by the arrows.
        const items = stripItems(container);
        checkRovingTabStop(items, hp, "strip items", "build-plan", problems);
        hp.focus();
        const right = pressKey(hp, "ArrowRight");
        await settle();
        const after = stripItems(container).find(
          (b) => b.getAttribute("aria-pressed") === "true",
        );
        if (!right.defaultPrevented || !after || after === hp) {
          problems.push(
            "build-plan: ArrowRight on a strip item did not move the selection",
          );
        } else if (document.activeElement !== after) {
          problems.push(
            "build-plan: ArrowRight moved the selection but not the focus",
          );
        }
        const home = pressKey(after ?? hp, "Home");
        await settle();
        if (
          !home.defaultPrevented ||
          stripItems(container)[0].getAttribute("aria-pressed") !== "true"
        ) {
          problems.push("build-plan: Home did not select the first strip item");
        }
      }
      checkHeadingOutline(container, "build-plan", problems);

      // `tan build --plan` is retired (tan-cli#427), so on the pinned CLI the
      // panel ALWAYS posts `plan: null` with a message. That used to collapse
      // the whole tab into "No build plan" and take the manifest down with
      // it. The manifest stays; the message is one footer sentence.
      g.__ALP_POST_TO_WEBVIEW__({
        type: "buildPlanData",
        plan: null,
        error:
          "`tan build --plan` is deferred and not available in this build " +
          "(see https://github.com/alplabai/tan-cli/issues/427).",
      });
      await settle();
      const noPlan = (container.textContent || "").toLowerCase();
      if (!noPlan.includes("cores") || !noPlan.includes("m55_hp")) {
        problems.push(
          "build-plan: the manifest vanished when no plan was available",
        );
      }
      if (noPlan.includes("no build plan")) {
        problems.push(
          "build-plan: a deferred plan still collapses the page into the empty state",
        );
      }
      if (!noPlan.includes("tan-cli/issues/427")) {
        problems.push(
          "build-plan: the plan's absence is not explained on screen",
        );
      }
      // Put the plan back so the click sweep below sees the normal panel.
      feedState();
      await settle();
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
    const problemsBefore = problems.length;
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
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  example-filter-degrade: the filter row appears only when it can narrow`,
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
    const problemsBefore = problems.length;
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
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  models-cli-gap: one notice, unusable actions disabled`,
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
    const problemsBefore = problems.length;
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
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  error-boundary: caught a throwing render`,
    );
  }

  // ── the memory strip over the real rpmsg-aen golden (#484) ──
  // Six resolved regions (mcuboot / two image slots / reserved / storage /
  // atoc) tile the window; mram_main does not resolve; the IPC link is
  // blocked. The SoM DECLARES write authority here, so the bands carry a
  // tier and the legend is on screen.
  {
    const problemsBefore = problems.length;
    const container = await mountBuildPlan(parseSystemManifest(aenFixtureText));
    const reach = reachableText(container);
    for (const needle of [
      "yours to write", // the legend — only drawn when authority is declared
      "locked",
      "not yours or not proven",
      "mram_main", // the unresolved region, as a ghost
      "alp_default_rpmsg", // the blocked carve-out, as a ghost
    ]) {
      if (!reach.includes(needle)) {
        problems.push(`memory-aen: missing "${needle}"`);
      }
    }
    const bands = Array.from(
      container.querySelectorAll('[data-lane="regions"] button'),
    );
    const bandNames = bands.map(
      (b) => (b.getAttribute("aria-label") || "").split(", ")[0],
    );
    for (const name of [
      "mcuboot",
      "he_slot0",
      "hp_slot0",
      "reserved",
      "storage",
      "atoc",
    ]) {
      if (!bandNames.includes(name)) {
        problems.push(`memory-aen: no band for region ${name}`);
      }
    }
    // Every band carries its tier mark (the CSS stub echoes class names, so
    // `.tierMark` is literal here) — three tiers across the six.
    const tiers = new Set(
      Array.from(container.querySelectorAll('[data-lane="regions"] .tierMark'))
        .map((m) => m.getAttribute("data-tier"))
        .filter(Boolean),
    );
    if (tiers.size !== 3) {
      problems.push(
        `memory-aen: expected the three authority tiers on the bands, found [${[...tiers].join(", ")}]`,
      );
    }
    // Selecting a band prints the region's exact figures and its authority
    // in words — and the accessible name carries the exact CLASS, so a
    // declared `customer_image` and a fail-closed `unstated` never announce
    // the same thing.
    const heSlot = stripItem(container, "he_slot0");
    if (!heSlot) {
      problems.push("memory-aen: he_slot0 is not selectable");
    } else {
      if (
        !(heSlot.getAttribute("aria-label") || "").includes("customer_image")
      ) {
        problems.push(
          "memory-aen: a band's accessible name does not carry its authority class",
        );
      }
      heSlot.click();
      await settle();
      const detail = (container.textContent || "").toLowerCase();
      for (const needle of [
        "0x80010000 – 0x802affff",
        "2.63 mib",
        "0x2a0000",
        "customer · written at flash time",
        "used by", // nothing names it here, so this must NOT appear …
      ]) {
        const want = needle !== "used by";
        if (detail.includes(needle) !== want) {
          problems.push(
            `memory-aen: selected-region detail ${want ? "missing" : "wrongly carries"} "${needle}"`,
          );
        }
      }
    }
    // A ghost's detail carries the resolver's reason WHOLE, and the two
    // host actions a blocked board.yaml entry gets.
    const ghost = stripItem(container, "alp_default_rpmsg");
    if (!ghost) {
      problems.push("memory-aen: the blocked carve-out has no ghost");
    } else {
      ghost.click();
      await settle();
      const detail = (container.textContent || "").toLowerCase();
      const aenReason =
        "only match memory_map region(s) in som e1m-aen801 that are ineligible for an ipc carve-out";
      if (!detail.includes(aenReason)) {
        problems.push("memory-aen: the blocked reason is not shown in full");
      }
      const before = g.__ALP_POSTED__.length;
      const buttons = Array.from(container.querySelectorAll("button"));
      const open = buttons.find((b) =>
        (b.textContent || "").startsWith("Open board config"),
      );
      const copy = buttons.find((b) => (b.textContent || "") === "Copy reason");
      if (!open || !copy) {
        problems.push(
          "memory-aen: a blocked ghost lacks its Open/Copy actions",
        );
      } else {
        open.click();
        copy.click();
        await settle();
        const posted = postedSince(before);
        if (!posted.some((m) => m.type === "openBoardYaml")) {
          problems.push(
            "memory-aen: Open board config posted no openBoardYaml",
          );
        }
        const copied = posted.find((m) => m.type === "copyText");
        if (
          !copied ||
          !String(copied.text).includes("ineligible for an IPC carve-out")
        ) {
          problems.push(
            "memory-aen: Copy reason did not post the verbatim reason",
          );
        }
      }
    }
    // The unresolved region's ghost: its reason, and NO board-config action
    // (it is declared in the SoM preset, not board.yaml).
    const mram = stripItem(container, "mram_main");
    if (!mram) {
      problems.push("memory-aen: the unresolved region has no ghost");
    } else {
      mram.click();
      await settle();
      const detail = (container.textContent || "").toLowerCase();
      if (!detail.includes("declares `base: tbd`")) {
        problems.push(
          "memory-aen: the unresolved region's reason is not shown",
        );
      }
      if (!detail.includes("5.50 mib")) {
        problems.push(
          "memory-aen: the unresolved region's resolved size is dropped",
        );
      }
      // `.detailActions` is the strip detail's own action row (the CSS stub
      // echoes class names); the Interconnect row's Open button is elsewhere.
      if (container.querySelector(".detailActions")) {
        problems.push(
          "memory-aen: a SoM region's ghost offers to open the board config",
        );
      }
    }
    // The interconnect row carries the same reason behind its disclosure.
    const show = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "") === "Show reason",
    );
    if (!show) {
      problems.push("memory-aen: the blocked link has no reason disclosure");
    } else {
      show.click();
      await settle();
      if (show.getAttribute("aria-expanded") !== "true") {
        problems.push("memory-aen: Show reason did not announce expanded");
      }
    }
    checkNoFractionalAddress(container, "memory-aen", problems);
    checkHeadingOutline(container, "memory-aen", problems);
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-aen: bands, tiers, ghosts and verbatim reasons`,
    );
  }

  // ── the memory strip over the real rpmsg-v2n golden (#484) ──
  // A 4 GiB ddr_main beside a 512 KiB ocram_low and a 128 KiB m33_tcm
  // nested inside ddr_main; the resolved carve-out fills ocram_low. The
  // SoM declares NO authority here, so no band is tinted and the page says
  // so once rather than calling the reader's rows "not yours".
  {
    const problemsBefore = problems.length;
    const container = await mountBuildPlan(parseSystemManifest(v2nFixtureText));
    const reach = reachableText(container);
    for (const needle of [
      "ddr_main",
      "ocram_low",
      "m33_tcm",
      "does not publish write authority",
      "0x147ffffff", // the window's INCLUSIVE last byte, as a tick label
      "0x00010000 – 0x0008ffff", // the carve-out, selected by default
      "512 kib",
      "0x80000",
      "extent from region ocram_low",
      "placed · 0x00010000 – 0x0008ffff in ocram_low", // the interconnect row
    ]) {
      if (!reach.includes(needle)) {
        problems.push(`memory-v2n: missing "${needle}"`);
      }
    }
    if (container.querySelector(".tierMark")) {
      problems.push(
        "memory-v2n: a band is tinted by a tier the SoM never declared",
      );
    }
    if (reach.includes("not yours")) {
      problems.push("memory-v2n: the reader's own rows are called 'not yours'");
    }
    // The 1.1 GiB run between ocram_low and ddr_main is compressed and says
    // so with its exact size.
    const gaps = Array.from(container.querySelectorAll('[data-segment="gap"]'));
    if (
      !gaps.some((gp) =>
        (gp.getAttribute("title") || "").includes("0x47f70000"),
      )
    ) {
      problems.push(
        "memory-v2n: the run between ocram_low and ddr_main is not marked with its exact size",
      );
    }
    // The nested region is drawn AFTER its container, so it wins the click.
    const bands = Array.from(
      container.querySelectorAll('[data-lane="regions"] button'),
    ).map((b) => (b.getAttribute("aria-label") || "").split(", ")[0]);
    if (bands.indexOf("m33_tcm") < bands.indexOf("ddr_main")) {
      problems.push("memory-v2n: m33_tcm is drawn under ddr_main, not over it");
    }
    checkNoFractionalAddress(container, "memory-v2n", problems);
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-v2n: a 4 GiB region beside KiB ones, untinted`,
    );
  }

  // ── an unrecognised kind, and outside_region's own wording (#484) ──
  // No real golden exercises a `kind` this build has never seen, nor an
  // outside_region violation; this plain object is fed straight to
  // `buildMemoryView`, the way test/systemManifest.memoryView.test.js does.
  {
    const problemsBefore = problems.length;
    const manifest = {
      schema_version: 1,
      generated_by: "scripts/alp_orchestrate.py",
      hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
      slices: [],
      ipc: [
        {
          name: "alp_rpmsg",
          kind: "rpmsg",
          endpoints: ["m55_hp", "m55_he"],
          carve_out_base: "0x80540000",
          carve_out_size: "0x00040000",
          carve_out_region: "odd_region",
          cacheable: false,
          rpmsg_endpoint_ids: { src: "0x000004e6", dst: "0x000004e7" },
          mailbox_channel: 0,
        },
      ],
      helper_mcus: [],
      boot_order: [],
      memory: [
        {
          name: "odd_region",
          source: "som_preset",
          kind: "sram_tcm", // never documented by the schema
          status: "ok",
          base: 0x80540000,
          size_bytes: 0x00020000, // half the carve-out's own size — overruns it
        },
      ],
    };
    const container = await mountBuildPlan(manifest);
    const odd = stripItem(container, "odd_region");
    if (!odd) {
      problems.push("memory-unrecognised: odd_region is not on the strip");
    } else {
      odd.click();
      await settle();
    }
    const reach = reachableText(container);
    for (const needle of [
      "class not proven", // an open `kind` is never read as RAM
      "lands outside the region it names", // the conflict, beside the picture
      "alp_rpmsg and odd_region",
    ]) {
      if (!reach.includes(needle)) {
        problems.push(`memory-unrecognised: missing "${needle}"`);
      }
    }
    if (reach.includes("sram_tcm")) {
      problems.push(
        "memory-unrecognised: an undocumented kind is rendered as if it were a class",
      );
    }
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-unrecognised: an open kind and an outside_region conflict`,
    );
  }

  // ── a resolved region with ZERO placed spans ──
  // The one combination where the strip's window comes from regions alone.
  {
    const problemsBefore = problems.length;
    const manifest = {
      schema_version: 1,
      generated_by: "scripts/alp_orchestrate.py",
      hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
      slices: [],
      ipc: [],
      helper_mcus: [],
      boot_order: [],
      memory: [
        {
          name: "mram_main",
          source: "som_preset",
          kind: "flash",
          status: "ok",
          base: 0x80000000,
          size_bytes: 0x00100000,
          write_authority: "vendor",
        },
      ],
    };
    const container = await mountBuildPlan(manifest);
    if (!container.querySelector("[data-strip-width]")) {
      problems.push("memory-region-only: no strip for a region-only manifest");
    }
    if (container.querySelector('[data-lane="placed"] button')) {
      problems.push("memory-region-only: a placed image was invented");
    }
    const reach = reachableText(container);
    for (const needle of ["mram_main", "0x80000000 – 0x800fffff", "1 mib"]) {
      if (!reach.includes(needle)) {
        problems.push(`memory-region-only: missing "${needle}"`);
      }
    }
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-region-only: a strip from regions alone`,
    );
  }

  // ── duplicate region names refuse the selection join, everywhere ──
  // Two rows sharing one name share one id; selecting either would light
  // both, so neither is selectable — the same refusal `findOutsideRegion`
  // applies in core and `duplicatedNames` applies in the webview.
  {
    const problemsBefore = problems.length;
    const manifest = {
      schema_version: 1,
      generated_by: "scripts/alp_orchestrate.py",
      hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
      slices: [],
      ipc: [],
      helper_mcus: [],
      boot_order: [],
      memory: [
        {
          name: "dup_region",
          source: "som_preset",
          kind: "flash",
          status: "ok",
          base: 0x80600000,
          size_bytes: 0x1000,
        },
        {
          name: "dup_region",
          source: "som_preset",
          kind: "flash",
          status: "ok",
          base: 0x80610000,
          size_bytes: 0x1000,
        },
      ],
    };
    const container = await mountBuildPlan(manifest);
    const bands = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-lane="regions"] button',
      ),
    );
    if (bands.length !== 2) {
      problems.push(`memory-duplicate: ${bands.length} bands drawn, want 2`);
    }
    for (const band of bands) {
      if (
        band.getAttribute("aria-disabled") !== "true" ||
        band.hasAttribute("aria-pressed")
      ) {
        problems.push("memory-duplicate: a duplicated-name band is selectable");
      }
      if (
        !(band.getAttribute("aria-label") || "").includes(
          "name shared by 2 rows, not joined",
        )
      ) {
        problems.push(
          "memory-duplicate: the band does not say why it is inert",
        );
      }
    }
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-duplicate: shared names are inert and say so`,
    );
  }

  // ── a region table AND genuine uncovered runs, together (#484) ──
  // Neither vendored fixture can prove this: rpmsg-aen's six regions tile
  // its window end to end, and the "build-plan" manifest has no region
  // table. `railBoundaries` builds `occupied` from THREE sources — a
  // region's extent, a span's own size, a slot's tan-size budget — and
  // deleting any one `occupied.push` alone used to produce 0 problems
  // across the whole harness. So this fixture carries three islands, one
  // per source, each the SOLE cover of its own run:
  //
  //   gap_region (region, resolved):        0x80000000 – 0x80010000  (64 KiB)
  //   core_anchor (marker span):             0x80000000
  //   [uncovered, always]                    0x80010000 – 0x80030000 (128 KiB)
  //   carve_c (carve-out span, own extent):  0x80030000 – 0x80048000  (96 KiB)
  //   [uncovered, always]                    0x80048000 – 0x80054000  (48 KiB)
  //   core_budget (slot image, tan-size):    0x80054000 – 0x80068000  (80 KiB)
  //   [uncovered, always]                    0x80068000 – 0x80072000  (40 KiB)
  //   core_far (marker span):                                          0x80072000
  //
  // The three ALWAYS-uncovered runs are the control; each per-source check
  // asserts one SPECIFIC byte size is absent from the gap set — the size
  // that run would carry if its own source were dropped. `core_far` pushes
  // the window's edge past core_budget's budget end so that address is
  // strictly interior and cannot survive a deleted `boundaries.push` by
  // coincidence; the invariant below holds that for EVERY declared address.
  {
    const problemsBefore = problems.length;
    const manifest = {
      schema_version: 1,
      generated_by: "scripts/alp_orchestrate.py",
      hw_info: { sku: "TEST-GAP-FIXTURE", silicon: "test:test:test" },
      slices: [
        {
          core_id: "core_anchor",
          os: "zephyr",
          status: "ok",
          flash_args: { slot0_load_address: "0x80000000" },
        },
        {
          core_id: "core_budget",
          os: "zephyr",
          status: "ok",
          flash_args: { slot0_load_address: "0x80054000" },
        },
        {
          core_id: "core_far",
          os: "zephyr",
          status: "ok",
          flash_args: { slot0_load_address: "0x80072000" },
        },
      ],
      ipc: [
        {
          name: "carve_c",
          kind: "raw_shmem",
          endpoints: ["core_anchor"],
          carve_out_base: "0x80030000",
          carve_out_size: "0x00018000",
          cacheable: false,
          mailbox_channel: 0,
        },
      ],
      helper_mcus: [],
      boot_order: [],
      memory: [
        {
          name: "gap_region",
          source: "som_preset",
          kind: "flash",
          status: "ok",
          base: 0x80000000,
          size_bytes: 0x00010000,
          write_authority: "customer_runtime",
          accessible_from: ["core_anchor"],
        },
      ],
    };
    const container = await mountBuildPlan(manifest, [
      {
        core_id: "core_budget",
        os: "zephyr",
        status: "ok",
        flash: { used: 40000, total: 0x00014000, pct: 48.8 },
        ram: { used: null, total: null, pct: null },
        source: "size-tool",
      },
    ]);
    const gapTitles = Array.from(
      container.querySelectorAll('[data-segment="gap"]'),
    ).map((gp) => (gp.getAttribute("title") || "").toLowerCase());
    if (gapTitles.length !== 3) {
      problems.push(`memory-gaps: ${gapTitles.length} gaps marked, want 3`);
    }
    for (const control of ["128 kib", "48 kib", "40 kib"]) {
      if (!gapTitles.some((t) => t.includes(control))) {
        problems.push(
          `memory-gaps: the always-uncovered ${control} run is not a gap`,
        );
      }
    }
    for (const [source, size] of [
      ["a region's extent", "64 kib"],
      ["a carve-out's own size", "96 kib"],
      ["a slot's tan-size budget", "80 kib"],
    ]) {
      if (gapTitles.some((t) => t.includes(size))) {
        problems.push(
          `memory-gaps: the ${size} run covered by ${source} is drawn as a gap`,
        );
      }
    }
    // The invariant: every declared address strictly inside the window is
    // some tick's own address.
    const ticked = new Set(
      Array.from(container.querySelectorAll("[data-address]")).map((t) =>
        Number(t.getAttribute("data-address")),
      ),
    );
    for (const declared of [
      0x80010000, 0x80030000, 0x80048000, 0x80054000, 0x80068000,
    ]) {
      if (!ticked.has(declared)) {
        problems.push(
          `memory-gaps: declared address 0x${declared.toString(16)} is not a segment edge`,
        );
      }
    }
    // The marker spans (a base with no extent) are drawn as hairlines and
    // are still selectable, with the base as their whole range.
    const far = stripItem(container, "core_far");
    if (!far || !far.hasAttribute("data-marker")) {
      problems.push(
        "memory-gaps: a base with no extent is not drawn as a marker",
      );
    } else {
      far.click();
      await settle();
      if (
        !(container.textContent || "").includes(
          "size not pinned by this manifest",
        )
      ) {
        problems.push(
          "memory-gaps: a marker's detail does not say its size is unknown",
        );
      }
    }
    checkNoFractionalAddress(container, "memory-gaps", problems);
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-gaps: three islands, three gaps, every edge ticked`,
    );
  }

  // ── the strip draws at a genuinely MEASURED, narrower width ──
  // jsdom computes no text metrics, so glyph overlap is not provable here.
  // What IS: the strip carries the MEASURED number (the measured code path
  // ran, not the fallback), and every string the wide pass expects is still
  // reachable — nothing was conditionally dropped.
  {
    const NARROW_WIDTH = 340;
    const problemsBefore = problems.length;
    g.__ALP_TEST_CHART_WIDTH__ = NARROW_WIDTH;
    const container = document.createElement("div");
    document.body.appendChild(container);
    createRoot(container).render(
      React.createElement(
        AppProvider,
        null,
        React.createElement(BuildPlanView),
      ),
    );
    await settle();
    feedState();
    await settle();
    feedState();
    await settle();
    const strip = container.querySelector("[data-strip-width]");
    if (strip?.getAttribute("data-strip-width") !== String(NARROW_WIDTH)) {
      problems.push(
        `memory-narrow-width: data-strip-width="${strip?.getAttribute("data-strip-width")}", want "${NARROW_WIDTH}" — the measured width did not reach the strip`,
      );
    }
    for (const toggle of Array.from(
      container.querySelectorAll('button[aria-expanded="false"]'),
    )) {
      (toggle as HTMLButtonElement).click();
    }
    await settle();
    const reach = reachableText(container);
    for (const needle of BUILD_PLAN_NEEDLES) {
      if (!reach.includes(needle)) {
        problems.push(
          `memory-narrow-width: missing "${needle}" at ${NARROW_WIDTH}px — present at the wide width, so the narrow width dropped it`,
        );
      }
    }
    checkNoFractionalAddress(container, "memory-narrow-width", problems);
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-narrow-width: ${NARROW_WIDTH}px, nothing dropped`,
    );
  }

  // ── a measured width of 0 must still draw a real strip ──
  // 0 is the production first paint (no ResizeObserver callback yet); the
  // strip keeps its fallback width rather than laying out into nothing.
  {
    const problemsBefore = problems.length;
    g.__ALP_TEST_CHART_WIDTH__ = 0;
    const container = await mountBuildPlan(parseSystemManifest(aenFixtureText));
    const strip = container.querySelector("[data-strip-width]");
    const width = Number(strip?.getAttribute("data-strip-width"));
    if (!(width > 0)) {
      problems.push(
        `memory-zero-width-fallback: data-strip-width="${strip?.getAttribute("data-strip-width")}" — a 0 measurement must fall back, never draw a 0-wide strip`,
      );
    }
    console.log(
      `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-zero-width-fallback: ${width}px`,
    );
  }

  // ── every IDREF target is unique across the whole document ──
  // Measurable only now, with several Build Plan panels mounted at once: a
  // hardcoded heading id or strip-item id looks correct inside any ONE
  // pass. Section headings (`aria-labelledby`) and strip items (the roving
  // focus target) both use `useId`, so this must hold.
  const idBearing = Array.from(
    document.querySelectorAll(
      "section[aria-labelledby] h2[id], button[aria-pressed][id]",
    ),
  )
    .map((el) => el.id)
    .filter((id) => id !== "");
  const duplicatedIds = Array.from(
    new Set(idBearing.filter((id, i) => idBearing.indexOf(id) !== i)),
  );
  if (idBearing.length === 0) {
    problems.push(
      "id-uniqueness: no heading or strip item carried an id — this check measured nothing",
    );
  }
  if (duplicatedIds.length > 0) {
    problems.push(
      `id-uniqueness: ${duplicatedIds.length} id(s) appear on more than one element — [${duplicatedIds.join(", ")}]`,
    );
  }
  console.log(
    `  ${duplicatedIds.length === 0 && idBearing.length > 0 ? "PASS" : "FAIL"}  id-uniqueness: ${idBearing.length} ids scanned, all distinct`,
  );
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
