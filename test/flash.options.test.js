// SPDX-License-Identifier: Apache-2.0
//
// The option allow-list (#540). The gate must read a `tan flash` argv exactly
// the way tan's parser (Typer/Click) does, or the consent screen describes a run
// other than the one that happens. Click has no long-option abbreviation, a
// value-taking option consumes the NEXT token unconditionally (even `--confirm`),
// `--opt=value` is one token, and `--` ends options. So the gate refuses any
// option that is not on a short explicit list, and refuses a value that looks
// like a flag.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  readFlashArgv,
  FLASH_ALLOWED_OPTIONS,
} = require("../packages/alp-core/dist/flash/argv.js");
const {
  parseFlashEnvelope,
} = require("../packages/alp-core/dist/flash/envelope.js");
const {
  decideFlashArming,
} = require("../packages/alp-core/dist/flash/arming.js");

const surface = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "golden", "tan-surface", "surface.json"),
    "utf8",
  ),
);

test("every allowed option exists in the recorded 0.7.0 surface, with the arity the reader assumes", () => {
  const flash = surface.commands.flash.options;
  for (const [name, takesValue] of Object.entries(FLASH_ALLOWED_OPTIONS)) {
    const option = flash[name];
    assert.ok(
      option,
      `${name} is allow-listed but \`tan flash\` has no such option at ${surface.version} — a rename went red here`,
    );
    assert.equal(
      option.metavar !== null,
      takesValue,
      `${name}: the reader's arity disagrees with the surface`,
    );
  }
  // The set is deliberately small; growing it is a decision, not a drift.
  assert.deepEqual(
    Object.keys(FLASH_ALLOWED_OPTIONS).sort(),
    [
      "--atoc-unqueryable",
      "--confirm",
      "--core",
      "--dry-run",
      "--format",
      "--jlink",
      "--probe-serial",
      "--probe-usb-path",
      "--project",
      "--recover",
      "--sdk-root",
      "--setools-dir",
    ].sort(),
  );
});

test("options outside the allow-list are reported, whatever their arity", () => {
  for (const args of [
    ["flash", "--board-yaml", "x.yaml"],
    ["flash", "--skip-missing-tools"],
    ["flash", "--frobnicate"],
    ["flash", "--cor", "m55_he"], // Click has no abbreviation
    ["flash", "-h"],
    ["--board-yaml", "x.yaml", "flash"],
  ]) {
    assert.ok(readFlashArgv(args).unmodelledFlags.length > 0, args.join(" "));
  }
});

test("`--core --confirm` is `--core` with the VALUE `--confirm`, as Click reads it — and the value is suspect", () => {
  const argv = readFlashArgv(["flash", "--core", "--confirm"]);
  assert.equal(argv.coreId, "--confirm");
  assert.equal(argv.isArmed, false, "--confirm was consumed as a value");
  assert.deepEqual(argv.suspectValues, ["--core"]);
});

test("`--core=m55_he` is one token; a plain value is not suspect", () => {
  const argv = readFlashArgv(["flash", "--core=m55_he"]);
  assert.equal(argv.coreId, "m55_he");
  assert.deepEqual(argv.suspectValues, []);
  assert.deepEqual(argv.unmodelledFlags, []);
});

test("after `--` nothing is an option: `-- --confirm` is the APP_PATH", () => {
  const argv = readFlashArgv(["flash", "--", "--confirm"]);
  assert.equal(argv.isArmed, false);
  assert.equal(argv.appPath, "--confirm");
  assert.deepEqual(argv.unmodelledFlags, []);
});

test("a global option after the subcommand is read the same as before it: its value is consumed", () => {
  const after = readFlashArgv(["flash", "--sdk-root", "/opt/sdk"]);
  assert.equal(after.appPath, null, "/opt/sdk is the option's value");
  assert.deepEqual(after.unmodelledFlags, []);
  const swallowed = readFlashArgv(["flash", "--sdk-root", "--confirm"]);
  assert.equal(swallowed.isArmed, false);
  assert.deepEqual(swallowed.suspectValues, ["--sdk-root"]);
});

test("a root-position `--` does not carry past the command: `-- flash --confirm` is armed, and refused", () => {
  const argv = readFlashArgv(["--", "flash", "--confirm"]);
  assert.equal(argv.isArmed, true, "Click reads --confirm as the flag");
  assert.equal(argv.hasRootEndOfOptions, true);
  assert.equal(
    readFlashArgv(["flash", "--", "--confirm"]).hasRootEndOfOptions,
    false,
  );
});

// ── an unarmed scope that holds a preview-only entry (review #1) ───────────

const raw = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "fixtures",
        "tan-flash",
        `tan-flash.v0.7.0.${name}.json`,
      ),
      "utf8",
    ),
  );

test("an unarmed decision names the preview-only entries it leaves unwritten", () => {
  const env = raw("dry-run.mixed-yocto-flow-d");
  env.data.entries = [
    ...env.data.entries.filter((e) => e.method !== "alif_mram_jlink"),
    raw("dry-run.zephyr-west-flash").data.entries[0],
  ];
  const decision = decideFlashArming(parseFlashEnvelope(JSON.stringify(env)), {
    scoped: false,
    wholeBoard: null,
  });
  assert.deepEqual(decision, { kind: "unarmed", previewOnly: ["a32_cluster"] });

  const purely = decideFlashArming(
    parseFlashEnvelope(JSON.stringify(raw("dry-run.zephyr-west-flash"))),
    { scoped: false, wholeBoard: null },
  );
  assert.deepEqual(purely, { kind: "unarmed", previewOnly: [] });
});
