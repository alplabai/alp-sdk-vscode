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
        topology: [
          { id: "m33", toolchain: "arm-zephyr-eabi" },
          { id: "a53", toolchain: "aarch64-other" },
        ],
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
  // Suggestions come from the catalogue only, deduplicated: the selected
  // SoM's own ids first (sorted), then every other SoM's (sorted) — so
  // `aarch64-other` comes last although it sorts first.
  assert.deepEqual(vm.toolchains, [
    "arm-zephyr-eabi",
    "poky-glibc",
    "aarch64-other",
  ]);
});

test("the placeholder names the SoM default, or says there is one", async () => {
  const { toolchainPlaceholder } = await load();
  assert.equal(
    toolchainPlaceholder("arm-zephyr-eabi"),
    "arm-zephyr-eabi (SoM default)",
  );
  assert.equal(toolchainPlaceholder(undefined), "SoM default");
});

/**
 * Source text with every comment removed — line, trailing and block — while
 * string and template literals are kept verbatim, so a `//` inside a URL
 * string is not mistaken for a comment.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

test("the comment stripper drops trailing comments and keeps strings", () => {
  assert.doesNotMatch(
    stripComments("const x = 1; // ZEPHYR_TOOLCHAIN_VARIANT"),
    /ZEPHYR_TOOLCHAIN_VARIANT/,
  );
  assert.doesNotMatch(
    stripComments("a(); /* ZEPHYR_TOOLCHAIN_VARIANT */ b();"),
    /ZEPHYR_TOOLCHAIN_VARIANT/,
  );
  assert.match(
    stripComments('env["ZEPHYR_TOOLCHAIN_VARIANT"] = v; // set'),
    /ZEPHYR_TOOLCHAIN_VARIANT/,
  );
  assert.match(stripComments('u = "https://x"; y();'), /https:\/\/x/);
});

test("the toolchain field writes no environment variable", async () => {
  const { applyToolchainOverride } = await load();
  const cfg = parseBoardConfig(PRIOR);
  applyToolchainOverride(cfg.cores.m55_hp, "llvm");
  const out = serializeBoardConfig(cfg, PRIOR);
  assert.doesNotMatch(out, /ZEPHYR_TOOLCHAIN_VARIANT/);

  // No source this change touched names the plan-owned variable or reaches
  // for the environment outside a comment — the field's only output is the
  // board.yaml key. (`board/models.ts` names it in a comment, on purpose.)
  for (const rel of [
    "packages/alp-webview/src/features/configurator/toolchainOverride.ts",
    "packages/alp-webview/src/features/configurator/ConfiguratorView.tsx",
    "packages/alp-webview/src/types.ts",
    "packages/alp-core/src/configurator/viewModel.ts",
    "packages/alp-core/src/board/models.ts",
    "packages/alp-core/src/board/serialize.ts",
  ]) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
    assert.doesNotMatch(code, /ZEPHYR_TOOLCHAIN_VARIANT/, rel);
    assert.doesNotMatch(code, /process\.env/, rel);
  }
});
