// SPDX-License-Identifier: Apache-2.0
//
// Does the resolved tan actually implement the model surface the panel drives?
// (packages/alp-webview/src/features/models/cliSurface.ts) under the CI gate.
//
// Why this module exists (#522): the panel is a thin `runAlpCommand(["model",
// ...])` shell over NINE subcommands, and the pinned tan (0.6.0, RE-MEASURED
// at GA — #609) implements exactly one of them — `build`. Every other call
// came back refused, and each
// refusal was rendered independently, so ONE fact ("this CLI cannot do it yet")
// reached the customer as FOUR red `Models unavailable` alarms carrying tan's
// own command-line text.
//
// Classified on the CODE, never on the prose. Measured from the real binary:
//
//   $ tan model list --format json
//   {"command":"model","ok":false,"exitCode":1, ...
//    "issues":[{"code":"model.unknown-subcommand","severity":"error",
//               "message":"Unknown model subcommand: list. Available: build."}]}
//
// Matching the message instead would repeat the #511 mistake — a classifier
// pinned to one spelling of a condition that has several.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const SRC = path.join(
  __dirname,
  "../packages/alp-webview/src/features/models/cliSurface.ts",
);
const out = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "alp-clisurface-")),
  "cliSurface.cjs",
);
esbuild.buildSync({
  entryPoints: [SRC],
  outfile: out,
  format: "cjs",
  platform: "node",
  target: "node18",
  logLevel: "error",
});
const {
  UNKNOWN_SUBCOMMAND_CODE,
  findUnsupportedSubcommand,
  withoutUnsupportedSubcommand,
} = require(out);

/** The refusal tan really sends, verbatim from the pinned 0.6.0 envelope
 *  (re-measured at GA; byte-for-byte unchanged from the rc1 capture). */
function refusal(sub) {
  return {
    code: "model.unknown-subcommand",
    severity: "error",
    message: `Unknown model subcommand: ${sub}. Available: build.`,
  };
}

const OTHER = {
  code: "model.check-failed",
  severity: "error",
  message: "something else went wrong",
};

test("the code is the contract, spelled exactly as tan sends it", () => {
  assert.equal(UNKNOWN_SUBCOMMAND_CODE, "model.unknown-subcommand");
});

test("findUnsupportedSubcommand returns null when the CLI implements the surface", () => {
  assert.equal(findUnsupportedSubcommand([]), null);
  assert.equal(findUnsupportedSubcommand([OTHER]), null);
});

test("findUnsupportedSubcommand recognises the refusal by code", () => {
  const found = findUnsupportedSubcommand([OTHER, refusal("list")]);
  assert.ok(found, "the refusal must be recognised among unrelated issues");
  assert.equal(
    found.message,
    "Unknown model subcommand: list. Available: build.",
  );
});

test("findUnsupportedSubcommand does not classify on the prose", () => {
  // Same words, different (or missing) code — not our condition. A message
  // match would fire here and mislabel an unrelated failure as "CLI too old".
  const impostor = {
    code: "model.check-failed",
    severity: "error",
    message: "Unknown model subcommand: list. Available: build.",
  };
  assert.equal(findUnsupportedSubcommand([impostor]), null);
});

test("findUnsupportedSubcommand survives a malformed issue list", () => {
  // The issues array crosses the same wire as everything else; a panel that
  // blanks on a null issue is the #517 failure in a different place.
  for (const bad of [undefined, null, "nope", 42, {}]) {
    assert.equal(findUnsupportedSubcommand(bad), null, String(bad));
  }
  assert.equal(
    findUnsupportedSubcommand([null, refusal("zoo")])?.code,
    UNKNOWN_SUBCOMMAND_CODE,
  );
});

test("withoutUnsupportedSubcommand strips only the refusals", () => {
  const got = withoutUnsupportedSubcommand([
    refusal("list"),
    OTHER,
    refusal("doctor"),
  ]);
  assert.deepEqual(
    got,
    [OTHER],
    "unrelated issues must still reach the banner",
  );
});

test("withoutUnsupportedSubcommand leaves an unaffected list untouched", () => {
  // The gate must not be satisfiable by returning [] for everything.
  const issues = [OTHER];
  assert.deepEqual(withoutUnsupportedSubcommand(issues), issues);
  assert.deepEqual(withoutUnsupportedSubcommand([]), []);
});

test("withoutUnsupportedSubcommand returns a list for a malformed input", () => {
  for (const bad of [undefined, null, "nope", 42, {}]) {
    assert.deepEqual(withoutUnsupportedSubcommand(bad), [], String(bad));
  }
});
