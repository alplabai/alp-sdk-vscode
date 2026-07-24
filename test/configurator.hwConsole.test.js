const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  buildConfiguratorViewModel,
  headlessConsoleAdvice,
  isHeadlessCore,
} = require("../packages/alp-core/dist/configurator/viewModel.js");
const {
  parseSomPreset,
} = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

// hw_console guidance (alp-sdk#920 / #322).
//
// `hw_console: false` on a SoM topology core means that core has NO hardware
// UART console — the RZ/V2N `m33_sm` system-manager is the real case, its debug
// UART belongs to the A55. The whole feature hinges on one rule: ABSENT means
// the core HAS a console. Only an explicit `false` is a headless marker. Get
// that backwards and every AEN and NX9 core — none of which set the key — reads
// as serial-less and the IDE warns on every project.

const V2M_YAML = `
sku: E1M-V2M101
display_name: E1M-V2M101 (RZ/V2N + DEEPX)
family: renesas-rzv2n
silicon: renesas:rzv2n:n44
topology:
  a55_cluster:
    image: alp-image-edge
    machine: e1m-v2m101-a55
  m33_sm:
    app: ./src
    board: alp_e1m_v2m101_m33
    hw_console: false
`;

const AEN_YAML = `
sku: E1M-AEN801
display_name: E1M-AEN801 (Alif Ensemble E8)
family: alif-ensemble
silicon: alif:ensemble:e8
topology:
  m55_hp:
    app: ./src
    board: alp_e1m_aen801_m55_hp
  m55_he:
    app: ./src
    board: alp_e1m_aen801_m55_he
`;

test("parseSomPreset carries hw_console: false onto the topology core", () => {
  const som = parseSomPreset(V2M_YAML);
  const byId = Object.fromEntries(som.topology.map((t) => [t.id, t]));
  assert.equal(byId.m33_sm.hwConsole, false);
});

test("a topology core without hw_console leaves hwConsole undefined, not false", () => {
  // The load-bearing assertion: `Boolean(tc.hw_console)` here would produce
  // false and mark every AEN core headless.
  const som = parseSomPreset(AEN_YAML);
  for (const core of som.topology) {
    assert.equal(
      core.hwConsole,
      undefined,
      `${core.id} must be undefined (has a console), not an explicit false`,
    );
    assert.equal(isHeadlessCore(core), false);
  }
});

test("isHeadlessCore is true only for an explicit false", () => {
  assert.equal(isHeadlessCore({ hwConsole: false }), true);
  assert.equal(isHeadlessCore({ hwConsole: true }), false);
  assert.equal(isHeadlessCore({}), false);
});

test("CorePanel.hwConsole comes from the SoM topology, not board.yaml", () => {
  const som = parseSomPreset(V2M_YAML);
  const catalogue = {
    soms: [som],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
    sdkVersion: "0.13.0",
  };
  // board.yaml mentions only a55_cluster; m33_sm is inherited from topology and
  // must still carry the flag.
  const board = parseBoardConfig(
    "som:\n  sku: E1M-V2M101\ncores:\n  a55_cluster:\n    os: yocto\n",
  );
  const vm = buildConfiguratorViewModel(board, catalogue);
  const byId = Object.fromEntries(vm.cores.map((c) => [c.id, c]));
  assert.equal(byId.m33_sm.hwConsole, false);
  assert.equal(byId.m33_sm.inheritedFromTopology, true);
  assert.equal(byId.a55_cluster.hwConsole, undefined);
});

test("buildConfiguratorViewModel survives a SomPreset with no topology array", () => {
  // Hand-built catalogues (every other test file in this repo) omit `topology`.
  // An unguarded .find() here throws before the panel renders.
  const catalogue = {
    soms: [
      {
        sku: "E1M-AEN801",
        displayName: "AEN801",
        family: "alif-ensemble",
        silicon: "alif:ensemble:e8",
        capabilities: {},
        topologyCoreIds: ["m55_hp"],
        onModule: [],
        preliminary: false,
      },
    ],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
    sdkVersion: "0.13.0",
  };
  const board = parseBoardConfig("som:\n  sku: E1M-AEN801\n");
  const vm = buildConfiguratorViewModel(board, catalogue);
  assert.equal(vm.cores[0].hwConsole, undefined);
  assert.equal(vm.consoleAdvice, null);
});

test("no headless core means no advice, whatever the backend", () => {
  for (const backend of [undefined, "auto", "uart", "alp", "ram", "none"]) {
    assert.equal(headlessConsoleAdvice([], backend), null);
  }
});

test("a serial backend on a headless core is a warning naming the core", () => {
  for (const backend of ["uart", "alp"]) {
    const advice = headlessConsoleAdvice(["m33_sm"], backend);
    assert.ok(advice, `${backend} must produce advice`);
    assert.equal(advice.severity, "warning");
    assert.match(advice.message, /m33_sm/);
    assert.match(advice.message, /ram/);
  }
});

test("auto on a headless core is an info-level recommendation, not a warning", () => {
  // `auto` is the default, so warning on it would fire on every fresh V2M
  // project before the user has chosen anything.
  const advice = headlessConsoleAdvice(["m33_sm"], "auto");
  assert.equal(advice.severity, "info");
  assert.match(advice.message, /ram/);
  assert.deepEqual(advice, headlessConsoleAdvice(["m33_sm"], undefined));
});

test("ram, linux and none are already-correct choices — no advice", () => {
  for (const backend of ["ram", "linux", "none"]) {
    assert.equal(headlessConsoleAdvice(["m33_sm"], backend), null);
  }
});

test("advice names every headless core and agrees in number", () => {
  const advice = headlessConsoleAdvice(["m33_sm", "m33_aux"], "uart");
  assert.match(advice.message, /m33_sm, m33_aux/);
  assert.match(advice.message, /Cores .* have no hardware UART console/);
});

test("the view model computes the advice from board.diagnostics.console", () => {
  const som = parseSomPreset(V2M_YAML);
  const catalogue = {
    soms: [som],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
    sdkVersion: "0.13.0",
  };
  const withUart = buildConfiguratorViewModel(
    parseBoardConfig(
      "som:\n  sku: E1M-V2M101\ndiagnostics:\n  console: uart\n",
    ),
    catalogue,
  );
  assert.equal(withUart.consoleAdvice.severity, "warning");

  const withRam = buildConfiguratorViewModel(
    parseBoardConfig("som:\n  sku: E1M-V2M101\ndiagnostics:\n  console: ram\n"),
    catalogue,
  );
  assert.equal(withRam.consoleAdvice, null);
});
