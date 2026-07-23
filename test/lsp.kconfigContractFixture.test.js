// SPDX-License-Identifier: Apache-2.0
//
// Gates the vscode side of the cross-repo `--emit kconfig` contract: alp-sdk
// `--emit kconfig` (#894) -> tan `tan kconfig` (Envelope<KconfigData>) -> this
// extension's LSP (kconfigSymbolsFromEnvelope, #299). alp-sdk#897 landed a
// CANONICAL fixture (tests/fixtures/kconfig-contract/emit-kconfig.golden.json)
// so all three repos test against the SAME upstream bytes instead of each
// hand-writing its own literal, which is exactly what let a field rename
// drift silently before. This file vendors that fixture and:
//   1. proves the shipped consumer (kconfigSymbolsFromEnvelope) maps every
//      field of the REAL upstream shape correctly (not a hand-rolled stand-in);
//   2. gates that the vendored copy hasn't drifted from the alp-sdk-upstream
//      submodule, once that submodule's pin reaches alp-sdk#897.

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { kconfigSymbolsFromEnvelope } = require("../out/lsp/sdkCatalog.js");

const REPO_ROOT = path.join(__dirname, "..");
const VENDORED_PATH = path.join(
  __dirname,
  "fixtures",
  "kconfig",
  "emit-kconfig.golden.json",
);
// Path of the same fixture inside the alp-sdk-upstream submodule, once its
// pin advances past alp-sdk#897 (the PR that adds it).
const UPSTREAM_GIT_PATH =
  "tests/fixtures/kconfig-contract/emit-kconfig.golden.json";

function readVendored() {
  // Normalize CRLF -> LF: on Windows checkouts (core.autocrlf=true) this file
  // can smudge to CRLF on disk while the git blob (and the submodule copy) is
  // LF — see test/board.schema.vendored.test.js for the same normalization.
  return fs.readFileSync(VENDORED_PATH, "utf-8").replace(/\r\n/g, "\n");
}

/** The fixture's bytes as pinned in the alp-sdk-upstream submodule's checked
 *  out commit, or `null` if unavailable — an uninitialized submodule (empty
 *  working tree) or a pin that predates alp-sdk#897 (file doesn't exist yet
 *  upstream). Mirrors scripts/vendor-kconfig-symbols.mjs's showFile(): read
 *  via `git show HEAD:<path>` (reproducible even with a dirty submodule
 *  tree), swallow any failure rather than throw. */
function readUpstream() {
  try {
    return execFileSync(
      "git",
      ["-C", "alp-sdk-upstream", "show", `HEAD:${UPSTREAM_GIT_PATH}`],
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

test("vendored emit-kconfig.golden.json matches the alp-sdk-upstream submodule (drift gate)", (t) => {
  const upstream = readUpstream();
  if (upstream === null) {
    // Expected today: alp-sdk-upstream isn't checked out in every environment
    // this runs in (CI checks it out unreliably for the deep history — see
    // test/lsp.kconfig.test.js), AND the fixture's own alp-sdk PR (#897) may
    // not have landed on the submodule's pinned commit yet. This gate goes
    // live the moment the submodule pin advances past alp-sdk#897; until then
    // it skips cleanly rather than hard-failing CI, same as the vendoring
    // scripts (scripts/vendor-kconfig-metadata.mjs, scripts/vendor-kconfig-symbols.mjs).
    t.skip(
      "alp-sdk-upstream submodule not checked out, or its pin predates alp-sdk#897 " +
        `(no ${UPSTREAM_GIT_PATH} at HEAD) — re-run once the submodule pin advances`,
    );
    return;
  }
  assert.equal(
    readVendored(),
    upstream,
    `${VENDORED_PATH} differs from alp-sdk-upstream's ${UPSTREAM_GIT_PATH} — ` +
      "re-vendor the fixture byte-for-byte from the submodule.",
  );
});

test("kconfigSymbolsFromEnvelope maps every field of the canonical alp-sdk contract fixture (alp-sdk#893/#894/#897)", () => {
  const fixture = JSON.parse(readVendored());

  // A realistic Envelope<KconfigData>, exactly as tan kconfig --core <id>
  // wraps it and client.ts unwraps it (`outcome.envelope?.data`, see
  // src/lsp/client.ts:fetchEnvelopeData) — the fixture is the RAW `--emit
  // kconfig` payload, i.e. the envelope's `data` field.
  const envelope = {
    command: "kconfig",
    ok: true,
    exitCode: 0,
    project: { root: "/workspace/app", boardYaml: "/workspace/app/board.yaml" },
    data: fixture,
    issues: [],
  };

  const symbols = kconfigSymbolsFromEnvelope(envelope.data);

  assert.deepEqual(symbols, [
    {
      name: "LOG",
      type: "bool",
      doc: "Enable the logging subsystem.",
      valueHint: "n",
      source: "sdk-live",
    },
    {
      name: "MAIN_STACK_SIZE",
      type: "int",
      // help is "" -> falls back to prompt.
      doc: "Size of stack for main thread",
      valueHint: "1024",
      source: "sdk-live",
    },
    {
      name: "FLASH_BASE_ADDRESS",
      type: "hex",
      doc: "Flash base address",
      valueHint: "0x0",
      source: "sdk-live",
    },
    {
      name: "BT_DEVICE_NAME",
      type: "string",
      doc: "Bluetooth device name",
      valueHint: '"Zephyr"',
      source: "sdk-live",
    },
    {
      name: "SOME_TRISTATE",
      // tristate must survive: it's real Zephyr (y/n/m), not a guess (see
      // KCONFIG_TYPES in src/lsp/sdkCatalog.ts).
      type: "tristate",
      doc: "A tristate symbol",
      // default: null -> no literal to insert, so valueHint is ABSENT, not
      // `null`/`undefined` as an explicit key.
      source: "sdk-live",
    },
  ]);

  const tristate = symbols.find((s) => s.name === "SOME_TRISTATE");
  assert.equal(tristate.type, "tristate", "tristate type must be preserved");
  assert.ok(
    !("valueHint" in tristate),
    "a null default must not produce a valueHint key at all",
  );
});
