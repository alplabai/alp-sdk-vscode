// SPDX-License-Identifier: Apache-2.0
//
// The Configurator's per-core "Toolchain" field (#314).
//
// Three properties, each the reason the picker was shaped the way it was:
//
//   1. It writes `cores.<id>.toolchain` into board.yaml through the same
//      comment-preserving serializer every other field uses, and a blank field
//      REMOVES the key instead of writing `toolchain: ""` (an empty id would be
//      passed through to the plan verbatim).
//   2. The vendored schema accepts the key — `core_entry` is
//      `additionalProperties: false`, so before alp-sdk#964 (v0.17.0-rc2) the
//      same write failed validation on the next build.
//   3. It writes no environment variable. `ZEPHYR_TOOLCHAIN_VARIANT` is
//      plan-owned (`test/alpCli.planOwnedEnv.test.js`); the field's only
//      output is the board.yaml key.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const {
  serializeBoardConfig,
} = require("../packages/alp-core/dist/board/serialize.js");
const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  buildConfiguratorViewModel,
} = require("../packages/alp-core/dist/configurator/viewModel.js");

const load = () =>
  import("./webview/esbuildImport.mjs").then((m) =>
    m.importWebviewModule("features/configurator/toolchainOverride.ts"),
  );

const PRIOR = [
  "# my board",
  "som:",
  "  sku: E1M-AEN801",
  "cores:",
  "  m55_hp:",
  "    app: ./src # keep this comment",
  "",
].join("\n");

/** Apply the field's text the way the view does: parse, edit, serialize. */
async function editToolchain(prior, coreId, text) {
  const { applyToolchainOverride } = await load();
  const cfg = parseBoardConfig(prior);
  applyToolchainOverride(cfg.cores[coreId], text);
  return serializeBoardConfig(cfg, prior);
}

test("a typed toolchain is written to cores.<id>.toolchain, comments kept", async () => {
  const out = await editToolchain(PRIOR, "m55_hp", "  llvm ");

  assert.equal(yaml.load(out).cores.m55_hp.toolchain, "llvm");
  assert.match(out, /# my board/);
  assert.match(out, /app: \.\/src # keep this comment/);
});

test("clearing the field removes the key, never writes an empty string", async () => {
  const withKey = await editToolchain(PRIOR, "m55_hp", "llvm");

  for (const blank of ["", "   "]) {
    const out = await editToolchain(withKey, "m55_hp", blank);
    const core = yaml.load(out).cores.m55_hp;
    assert.equal(
      Object.hasOwn(core, "toolchain"),
      false,
      `blank ${JSON.stringify(blank)} left a toolchain key: ${out}`,
    );
    assert.doesNotMatch(out, /toolchain/);
    assert.equal(core.app, "./src");
  }
});

test("the vendored board schema accepts cores.<id>.toolchain as an optional string", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(ROOT, "schemas", "board.schema.json"), "utf-8"),
  );
  const coreEntry = schema.$defs.core_entry;

  // additionalProperties:false is what made the key unwritable before #964.
  assert.equal(coreEntry.additionalProperties, false);
  assert.equal(coreEntry.properties.toolchain?.type, "string");
  assert.equal((coreEntry.required ?? []).includes("toolchain"), false);
});

test("the view model carries the override, the SoM default and catalogue suggestions", () => {
  const catalogue = {
    soms: [
      {
        sku: "E1M-AEN801",
        displayName: "AEN801",
        family: "alif-ensemble",
        silicon: "alif:ensemble:e8",
        capabilities: {},
        topologyCoreIds: ["a32_cluster", "m55_hp"],
        topology: [
          { id: "a32_cluster", toolchain: "poky-glibc" },
          { id: "m55_hp", toolchain: "arm-zephyr-eabi" },
        ],
        onModule: [],
        preliminary: false,
      },
      {
        sku: "E1M-OTHER",
        displayName: "Other",
        family: "x",
        silicon: "x",
        capabilities: {},
        topologyCoreIds: ["m33"],
        topology: [{ id: "m33", toolchain: "arm-zephyr-eabi" }],
        onModule: [],
        preliminary: false,
      },
    ],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
  };
  const board = {
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { toolchain: "llvm" } },
  };

  const vm = buildConfiguratorViewModel(board, catalogue);
  const byId = Object.fromEntries(vm.cores.map((c) => [c.id, c]));

  assert.equal(byId.m55_hp.toolchain, "llvm");
  assert.equal(byId.m55_hp.defaultToolchain, "arm-zephyr-eabi");
  assert.equal(byId.a32_cluster.toolchain, undefined);
  assert.equal(byId.a32_cluster.defaultToolchain, "poky-glibc");
  // Suggestions come from the catalogue only: deduplicated, sorted.
  assert.deepEqual(vm.toolchains, ["arm-zephyr-eabi", "poky-glibc"]);
});

test("the placeholder names the SoM default, or says there is one", async () => {
  const { toolchainPlaceholder } = await load();
  assert.equal(
    toolchainPlaceholder("arm-zephyr-eabi"),
    "arm-zephyr-eabi (SoM default)",
  );
  assert.equal(toolchainPlaceholder(undefined), "SoM default");
});

test("the toolchain field writes no environment variable", async () => {
  // Load first: the esbuild test loader itself may touch the environment,
  // and that is not the field writing anything.
  const { applyToolchainOverride } = await load();
  const before = { ...process.env };
  const cfg = parseBoardConfig(PRIOR);
  applyToolchainOverride(cfg.cores.m55_hp, "llvm");
  const out = serializeBoardConfig(cfg, PRIOR);

  assert.deepEqual({ ...process.env }, before);
  assert.doesNotMatch(out, /ZEPHYR_TOOLCHAIN_VARIANT/);

  // And no source on the field's path names the plan-owned variable or the
  // environment at all — its only output is the board.yaml key.
  for (const rel of [
    "packages/alp-webview/src/features/configurator/toolchainOverride.ts",
    "packages/alp-core/src/configurator/viewModel.ts",
    "packages/alp-core/src/board/serialize.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf-8");
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    assert.doesNotMatch(code, /ZEPHYR_TOOLCHAIN_VARIANT/, rel);
    assert.doesNotMatch(code, /process\.env/, rel);
  }
});
