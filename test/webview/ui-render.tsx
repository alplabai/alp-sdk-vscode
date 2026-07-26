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
import { OverviewView } from "../../packages/alp-webview/src/features/overview";
import { SidebarHubView } from "../../packages/alp-webview/src/features/sidebar-hub";
import { SetupFlowView } from "../../packages/alp-webview/src/features/setup-flow";
import { NewProjectFlowView } from "../../packages/alp-webview/src/features/new-project-flow";
import { ExistingProjectFlowView } from "../../packages/alp-webview/src/features/existing-project-flow";
import { SdkView } from "../../packages/alp-webview/src/features/sdk";
import { ToolchainDoctorView } from "../../packages/alp-webview/src/features/toolchain-doctor";
import { HardwareExplorerView } from "../../packages/alp-webview/src/features/hardware-explorer";
import { BuildPlanView } from "../../packages/alp-webview/src/features/build-plan";

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

// Messages that populate the data-driven views (New Project, SDK Manager).
function feedState() {
  g.__ALP_POST_TO_WEBVIEW__({ type: "stateUpdate", _v: 2, state: readyState });
  g.__ALP_POST_TO_WEBVIEW__({
    type: "projectTemplatesData",
    templates: [
      {
        id: "minimal-app",
        title: "Minimal app",
        description: "A minimal app",
        category: "starter",
        icon: "rocket",
      },
      {
        id: "gpio-button-led",
        title: "gpio-button-led",
        description: "GPIO demo",
        category: "example",
        icon: "circuit-board",
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
  // A real post-build manifest, not `null` — the System manifest section was
  // never rendered by this harness at all, so nothing here covered it. The
  // shape is the one #331 is about: one slice that succeeded and one that did
  // not, the latter carrying the `reason` the UI used to drop.
  g.__ALP_POST_TO_WEBVIEW__({
    type: "systemManifestData",
    postBuild: true,
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
        },
        {
          core_id: "a32_cluster",
          os: "yocto",
          status: "skipped",
          reason: "bitbake not found",
          log_path: "build/a32_cluster/bitbake.log",
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
  ["toolchain-doctor", ToolchainDoctorView],
  ["hardware-explorer", HardwareExplorerView],
  ["build-plan", BuildPlanView],
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
      // hook that subscribes below it (useBuildPlan, …) does not exist until
      // this first feed has been processed and committed. Feed again once it
      // does — see `settle` for why two ticks were never enough.
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
      ]) {
        if (!text.includes(needle)) {
          problems.push(
            `build-plan: system manifest detail missing "${needle}"`,
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
