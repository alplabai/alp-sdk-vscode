// SPDX-License-Identifier: Apache-2.0
//
// The Cores step's answers must survive everything except a different set of
// cores (#582).
//
// The step was reset from `defaultCoreChoices` by an effect depending on the
// CATALOG ARRAY, and the SDK step — which comes AFTER Cores in `STEPS` — makes
// that array change: picking any SDK posts `reloadProjectTemplates`, the host
// answers with a fresh list, its identity differs, and every answer the
// customer had just given was silently replaced by the defaults on the way to
// the screen that asks them to confirm those answers.
//
// That is #582's own failure one surface earlier — the customer answers, the
// answer is quietly overwritten, and nobody says so — and it defeats any fix
// made on the host side: a perfect pipeline faithfully transmits the wrong
// answers. So it is gated with the rest of #582 rather than filed as a nearby
// webview bug.
//
// Loaded through esbuild's own transform rather than by stripping types with
// regexes: `shared/coreChoices.ts` exists precisely so this logic can be
// exercised as data, and a loader that silently mis-parses it would take the
// gate with it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const REL = "packages/alp-webview/src/shared/coreChoices.ts";
const SRC = path.join(__dirname, "..", REL);

function loadCoreChoices() {
  const { code } = esbuild.transformSync(fs.readFileSync(SRC, "utf8"), {
    loader: "ts",
    format: "cjs",
  });
  const mod = new Module(SRC, null);
  mod.filename = SRC;
  mod._compile(code, SRC);
  return mod.exports;
}

const { defaultCoreChoices, reconcileCoreChoices } = loadCoreChoices();

/** E1M-AEN801, verbatim from `tan presets`. */
const AEN801 = [
  { id: "a32_cluster", os: "yocto" },
  { id: "m55_hp", os: "zephyr" },
  { id: "m55_he", os: "zephyr" },
];
/** E1M-V2N101 — a different SoM with different core ids. */
const V2N101 = [
  { id: "a55_cluster", os: "yocto" },
  { id: "m33_sm", os: "zephyr" },
];

test("the loader really loaded the module — anti-vacuity", () => {
  assert.equal(typeof reconcileCoreChoices, "function");
  assert.equal(typeof defaultCoreChoices, "function");
});

test("a fresh catalog with the same cores keeps the customer's answers", () => {
  // THE DEFECT. `edited` is what the customer typed; the second argument is a
  // brand-new array carrying identical content, exactly as the SDK-step reload
  // delivers it.
  const edited = [
    { id: "a32_cluster", os: "off", app: "" },
    { id: "m55_hp", os: "zephyr", app: "./src" },
    { id: "m55_he", os: "baremetal", app: "" },
  ];

  const next = reconcileCoreChoices(edited, [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ]);

  assert.deepEqual(
    next,
    edited,
    "a catalog reload must not answer the Cores step on the customer's behalf",
  );
});

test("nothing changed means the SAME array, so React can bail out", () => {
  // Identity, not deep equality. Returning a fresh copy of the same data would
  // re-render on every catalog message the host sends.
  const edited = defaultCoreChoices(AEN801);
  assert.equal(reconcileCoreChoices(edited, AEN801), edited);
});

test("a different SoM does replace the layout", () => {
  // The reason the reset existed, and it still has to work: a layout carried
  // over from another SoM names cores this one does not have.
  const edited = [
    { id: "a32_cluster", os: "off", app: "" },
    { id: "m55_hp", os: "zephyr", app: "./src" },
    { id: "m55_he", os: "zephyr", app: "./m55_he" },
  ];

  assert.deepEqual(reconcileCoreChoices(edited, V2N101), [
    { id: "a55_cluster", os: "yocto", app: "" },
    { id: "m33_sm", os: "zephyr", app: "./src" },
  ]);
});

test("a SoM with the same count but different ids still replaces", () => {
  // Length alone is not identity. Two SoMs with two cores each are still two
  // different parts.
  const edited = [
    { id: "a55_cluster", os: "off", app: "" },
    { id: "m33_sm", os: "zephyr", app: "./src" },
  ];

  assert.deepEqual(reconcileCoreChoices(edited, V2N101.slice()), edited);
  assert.deepEqual(
    reconcileCoreChoices(edited, [
      { id: "m55_hp", os: "zephyr" },
      { id: "m55_he", os: "zephyr" },
    ]),
    [
      { id: "m55_hp", os: "zephyr", app: "./src" },
      { id: "m55_he", os: "zephyr", app: "./m55_he" },
    ],
  );
});

test("clearing the module clears the step", () => {
  const edited = defaultCoreChoices(AEN801);
  assert.deepEqual(reconcileCoreChoices(edited, []), []);
});

test("the os values are NOT compared, and that is on purpose", () => {
  // After the first edit the held os IS the customer's answer rather than the
  // topology's, so comparing os would see a change every single time and reset
  // the step on every catalog message — the defect, restored by a stricter-
  // looking rule.
  const edited = [
    { id: "a32_cluster", os: "off", app: "" },
    { id: "m55_hp", os: "baremetal", app: "" },
    { id: "m55_he", os: "off", app: "" },
  ];

  assert.equal(reconcileCoreChoices(edited, AEN801), edited);
});
