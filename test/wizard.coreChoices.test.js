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

function loadTs(file) {
  const { code } = esbuild.transformSync(fs.readFileSync(file, "utf8"), {
    loader: "ts",
    format: "cjs",
  });
  const mod = new Module(file, null);
  mod.filename = file;
  mod._compile(code, file);
  return mod.exports;
}

const loadCoreChoices = () => loadTs(SRC);

const { defaultCoreChoices, reconcileCoreChoices } = loadCoreChoices();
const { coresSummary } = loadTs(
  path.join(__dirname, "..", "packages/alp-webview/src/shared/coreRuntime.ts"),
);
const VIEW = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "packages/alp-webview/src/features/new-project-flow/NewProjectFlowView.tsx",
  ),
  "utf8",
);

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
    { id: "a32_cluster", os: "off", app: "", recipe: "" },
    { id: "m55_hp", os: "zephyr", app: "./src", recipe: "" },
    { id: "m55_he", os: "baremetal", app: "", recipe: "" },
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
    { id: "a32_cluster", os: "off", app: "", recipe: "" },
    { id: "m55_hp", os: "zephyr", app: "./src", recipe: "" },
    { id: "m55_he", os: "zephyr", app: "./m55_he", recipe: "" },
  ];

  assert.deepEqual(reconcileCoreChoices(edited, V2N101), [
    { id: "a55_cluster", os: "yocto", app: "", recipe: "" },
    { id: "m33_sm", os: "zephyr", app: "./src", recipe: "" },
  ]);
});

test("a SoM with the same count but different ids still replaces", () => {
  // Length alone is not identity. Two SoMs with two cores each are still two
  // different parts.
  const edited = [
    { id: "a55_cluster", os: "off", app: "", recipe: "" },
    { id: "m33_sm", os: "zephyr", app: "./src", recipe: "" },
  ];

  assert.deepEqual(reconcileCoreChoices(edited, V2N101.slice()), edited);
  assert.deepEqual(
    reconcileCoreChoices(edited, [
      { id: "m55_hp", os: "zephyr" },
      { id: "m55_he", os: "zephyr" },
    ]),
    [
      { id: "m55_hp", os: "zephyr", app: "./src", recipe: "" },
      { id: "m55_he", os: "zephyr", app: "./m55_he", recipe: "" },
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
    { id: "a32_cluster", os: "off", app: "", recipe: "" },
    { id: "m55_hp", os: "baremetal", app: "", recipe: "" },
    { id: "m55_he", os: "off", app: "", recipe: "" },
  ];

  assert.equal(reconcileCoreChoices(edited, AEN801), edited);
});

// -- the CALL SITE, not just the helper -------------------------------------

test("the Cores effect reconciles rather than resetting", () => {
  // A helper nobody calls fixes nothing. Every behavioural assertion above
  // passes with `shared/coreChoices.ts` byte-identical and the EFFECT reverted
  // to `setCoreChoices(defaultCoreChoices(mod?.cores ?? []))` — measured: the
  // full suite and the webview render harness both return their baseline
  // numbers on that mutant. So the wiring is pinned here, at source level,
  // because the effect cannot be reached from node:test.
  assert.match(
    VIEW,
    /setCoreChoices\(\s*\(previous\)\s*=>\s*\n?\s*reconcileCoreChoices\(previous,/,
    "the Cores effect must pass the PREVIOUS choices through " +
      "reconcileCoreChoices — a plain setCoreChoices(...) discards them",
  );
  const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );
  assert.doesNotMatch(
    code,
    /setCoreChoices\(defaultCoreChoices\(/,
    "resetting the step straight from the defaults is the defect (#582): the " +
      "SDK step changes the catalog array and would wipe every answer",
  );
});

// -- the Confirm row --------------------------------------------------------

test("the Confirm summary reads back the customer's answers", () => {
  // The row is a pure function precisely so this can be asserted as data.
  // Rendering the wizard as far as Confirm is what no gate in this repo did,
  // which is how the row went unwatched: a mutant restoring `mod.cores` there
  // passed both the full suite and the render harness unchanged.
  assert.equal(
    coresSummary([
      { id: "a32_cluster", os: "off" },
      { id: "m55_hp", os: "zephyr" },
      { id: "m55_he", os: "baremetal" },
    ]),
    "a32_cluster (Off (skip core)), m55_hp (Zephyr (default)), m55_he (Bare-metal)",
  );
});

test("the Confirm summary names runtimes the way the Cores step offered them", () => {
  // Same labels, or the confirmation reads back a wire value the customer never
  // saw. Compared against `runtimeOptions` itself rather than a second copy of
  // the strings.
  const { runtimeOptions } = loadTs(
    path.join(
      __dirname,
      "..",
      "packages/alp-webview/src/shared/coreRuntime.ts",
    ),
  );
  for (const id of ["m55_hp", "a32_cluster", "dsp0"]) {
    for (const [value, label] of runtimeOptions(id)) {
      assert.equal(coresSummary([{ id, os: value }]), `${id} (${label})`);
    }
  }
});

test("an os with no label falls back to the raw value rather than blank", () => {
  // A future preset value the picker does not offer must still be legible.
  assert.equal(
    coresSummary([{ id: "a32_cluster", os: "hypervisor" }]),
    "a32_cluster (hypervisor)",
  );
});

test("the Confirm row is rendered from coresSummary, not rebuilt inline", () => {
  assert.match(
    VIEW,
    /label: "Cores", value: coresSummary\(coreChoices\)/,
    "ConfirmStep must render the shared summary — an inline map here is a " +
      "second implementation no test can see",
  );
  const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );
  assert.doesNotMatch(
    code,
    /value: mod\??\.\.?cores/,
    "the row must never be built from the SoM's declared topology (#582)",
  );
});
