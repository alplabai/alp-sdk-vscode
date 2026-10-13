// SPDX-License-Identifier: Apache-2.0
//
// The arming rule (#540): when may the extension add `--confirm` to a
// `tan flash`, and when must it refuse outright?
//
// Every envelope below is a REAL `tan flash --dry-run --format json` capture
// from tan 0.7.0 (see test/fixtures/tan-flash/PROVENANCE.md). The rule reads
// the backend tan RESOLVED (`entries[].method`), never the manifest's
// `flash_method`: on AEN the manifest says `zephyr_west_flash` for a slice tan
// then routes to Flow D (`alif_mram_jlink`), and arming off the manifest would
// be arming the wrong thing.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseFlashEnvelope,
  classifyBackend,
} = require("../packages/alp-core/dist/flash/envelope.js");
const {
  decideFlashArming,
} = require("../packages/alp-core/dist/flash/arming.js");
const {
  armFlashArgv,
  previewFlashArgv,
  withoutCore,
  readFlashArgv,
} = require("../packages/alp-core/dist/flash/argv.js");

const FIXTURES = path.join(__dirname, "fixtures", "tan-flash");
const raw = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(FIXTURES, `tan-flash.v0.7.0.${name}.json`),
      "utf8",
    ),
  );
const load = (name) => parseFlashEnvelope(JSON.stringify(raw(name)));

const UNSCOPED = { scoped: false, wholeBoard: null };

test("the envelope parser rejects what is not a flash envelope", () => {
  assert.equal(parseFlashEnvelope(""), null);
  assert.equal(parseFlashEnvelope("not json"), null);
  assert.equal(parseFlashEnvelope(JSON.stringify({ command: "build" })), null);
  assert.equal(
    parseFlashEnvelope(JSON.stringify({ command: "flash", data: {} })),
    null,
  );
});

test("backends are classified by the method tan resolved", () => {
  assert.equal(classifyBackend("alif_mram_jlink"), "flow-d");
  assert.equal(classifyBackend("yocto_wic"), "never-arm");
  assert.equal(classifyBackend("yocto_wic_to_sd_or_emmc"), "never-arm");
  assert.equal(classifyBackend("xspi_flashwriter"), "never-arm");
  assert.equal(classifyBackend("zephyr_west_flash"), "writes");
  assert.equal(classifyBackend("baremetal_cmake_flash"), "writes");
  assert.equal(classifyBackend(null), "unknown");
});

test("an all-Flow-D AEN scope arms, and the manifest's own flash_method is not what decided it", () => {
  const preview = load("dry-run.flow-d");
  const slice = preview.entries.find((e) => e.id === "m55_he");
  assert.equal(slice.methodDeclared, "zephyr_west_flash");
  assert.equal(slice.method, "alif_mram_jlink");

  const decision = decideFlashArming(preview, UNSCOPED);
  assert.equal(decision.kind, "arm-flow-d");
  assert.deepEqual(decision.atocNames, ["m55_he", "m55_hp"]);
  assert.equal(decision.setoolsDir, "/home/dev/setools");
  assert.equal(decision.setoolsSource, "the --setools-dir flag");
  // tan's own replacement text, verbatim, from the preview.
  assert.match(
    decision.replacementNote,
    /^NOTE: a real write REPLACES the ENTIRE ATOC/,
  );
  assert.match(
    decision.replacementNote,
    /This ATOC names: DEVICE, m55_he, m55_hp\./,
  );
  assert.match(decision.replacementNote, /\[SES\] ATOC ok/);
  assert.match(
    decision.replacementNote,
    /every entry not named above will be delisted/,
  );
  // …and not the probe-selection tail that follows it in the message.
  assert.doesNotMatch(decision.replacementNote, /probe selection/);
});

test("a scope of only zephyr_west_flash is never armed", () => {
  const decision = decideFlashArming(
    load("dry-run.zephyr-west-flash"),
    UNSCOPED,
  );
  assert.deepEqual(decision, { kind: "unarmed" });
});

test("a yocto slice beside a Flow D slice REFUSES: arming one would be a host dd, not arming it a half-write", () => {
  const decision = decideFlashArming(
    load("dry-run.mixed-yocto-flow-d"),
    UNSCOPED,
  );
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "mixed-backends");
  assert.match(decision.message, /a32_cluster/);
  assert.match(decision.message, /nothing was written/i);
});

test("a scope that only previews (yocto / xspi) is refused, never armed", () => {
  const xspi = decideFlashArming(load("dry-run.xspi-flashwriter"), UNSCOPED);
  assert.equal(xspi.kind, "refuse");
  assert.equal(xspi.reason, "preview-only-backend");

  const yoctoOnly = raw("dry-run.mixed-yocto-flow-d");
  yoctoOnly.data.entries = yoctoOnly.data.entries.filter(
    (e) => e.method !== "alif_mram_jlink",
  );
  const decision = decideFlashArming(
    parseFlashEnvelope(JSON.stringify(yoctoOnly)),
    UNSCOPED,
  );
  assert.equal(decision.reason, "preview-only-backend");
});

test("yocto beside a backend that writes unasked proceeds UNARMED", () => {
  const env = raw("dry-run.mixed-yocto-flow-d");
  const west = raw("dry-run.zephyr-west-flash").data.entries[0];
  env.data.entries = [
    ...env.data.entries.filter((e) => e.method !== "alif_mram_jlink"),
    west,
  ];
  const decision = decideFlashArming(
    parseFlashEnvelope(JSON.stringify(env)),
    UNSCOPED,
  );
  assert.deepEqual(decision, { kind: "unarmed" });
});

test("Flow D beside a backend that writes unasked still arms (the flag changes nothing for it)", () => {
  const env = raw("dry-run.flow-d");
  env.data.entries.push(raw("dry-run.zephyr-west-flash").data.entries[0]);
  const decision = decideFlashArming(
    parseFlashEnvelope(JSON.stringify(env)),
    UNSCOPED,
  );
  assert.equal(decision.kind, "arm-flow-d");
});

test("a preview tan itself could not complete refuses with tan's own words", () => {
  const decision = decideFlashArming(
    load("dry-run.flow-d.no-setools"),
    UNSCOPED,
  );
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "preview-failed");
  assert.match(decision.message, /nothing was written/);
  // tan's own words, which name the way out, ride along for the log.
  assert.match(decision.detail, /SETOOLS_DIR=<path>/);
});

test("a SETOOLS only the manifest names is refused: tan would not run it for the write", () => {
  const preview = load("dry-run.flow-d.manifest-only-setools");
  const entry = preview.entries.find((e) => e.id === "m55_hp");
  assert.equal(entry.setools.signSkipped, true);
  const decision = decideFlashArming(preview, UNSCOPED);
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "setools-not-operator-named");
  assert.match(decision.message, /SETOOLS_DIR/);
});

test("--core with a Flow D sibling left out REFUSES, naming the sibling", () => {
  const scoped = load("dry-run.flow-d.core-left-out");
  const whole = load("dry-run.flow-d");
  const decision = decideFlashArming(scoped, {
    scoped: true,
    wholeBoard: whole,
  });
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "left-out-sibling");
  assert.match(decision.message, /m55_he/);
  assert.match(decision.message, /whole-board Flash/i);
});

test("--core is fail-closed when the whole-board preview is unavailable", () => {
  const decision = decideFlashArming(load("dry-run.flow-d.core-left-out"), {
    scoped: true,
    wholeBoard: null,
  });
  assert.equal(decision.reason, "left-out-sibling");
});

test("tan's own 'will be delisted' sentence is a second, independent guard", () => {
  // Even if the caller claims the scope is unscoped, the preview text that says
  // another Flow D slice will be delisted is enough to refuse.
  const decision = decideFlashArming(
    load("dry-run.flow-d.core-left-out"),
    UNSCOPED,
  );
  assert.equal(decision.reason, "left-out-sibling");
});

test("--core is allowed when the scoped ATOC names every Flow D slice", () => {
  const one = raw("dry-run.flow-d.core-left-out");
  const whole = raw("dry-run.flow-d");
  // Whole board that ALSO only has m55_hp as a Flow D slice.
  whole.data.entries = whole.data.entries.filter((e) => e.id === "m55_hp");
  one.data.entries[0].message = one.data.entries[0].message.replace(
    / The manifest's other alif_mram_jlink slice\(s\) \(m55_he\) are NOT named[^.]*\./,
    "",
  );
  const decision = decideFlashArming(parseFlashEnvelope(JSON.stringify(one)), {
    scoped: true,
    wholeBoard: parseFlashEnvelope(JSON.stringify(whole)),
  });
  assert.equal(decision.kind, "arm-flow-d");
});

test("the committed tan captures are scrubbed (this repo is PUBLIC)", () => {
  for (const name of fs.readdirSync(FIXTURES)) {
    const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    assert.doesNotMatch(
      text,
      /\/Users\/|\/private\/|\/home\/(?!dev\/)|hakan|claude-/i,
      name,
    );
  }
});

test("argv helpers: preview adds --dry-run --format json, drops nothing else, and never --confirm", () => {
  assert.deepEqual(
    previewFlashArgv(["--sdk-root", "/sdk", "flash", "--core", "m55_hp", "."]),
    [
      "--sdk-root",
      "/sdk",
      "flash",
      "--dry-run",
      "--format",
      "json",
      "--core",
      "m55_hp",
      ".",
    ],
  );
  assert.deepEqual(withoutCore(["flash", "--core", "m55_hp", "."]), [
    "flash",
    ".",
  ]);
  assert.deepEqual(withoutCore(["flash", "--core=m55_hp"]), ["flash"]);
  assert.deepEqual(armFlashArgv(["flash"]), ["flash", "--confirm"]);
  assert.equal(
    readFlashArgv(["flash", "--atoc-unqueryable"]).hasAtocUnqueryable,
    true,
  );
  assert.equal(
    readFlashArgv(["flash", "--setools-dir", "/x"]).setoolsDir,
    "/x",
  );
});
