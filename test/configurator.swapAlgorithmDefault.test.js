const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The swap-algorithm UI-default gate (#658).
//
// alp-sdk v0.16.0 removed `"default": "scratch"` from board.schema.json's
// `boot.swap_algorithm`, because the correct default is a property of the
// TARGET, not of the schema: scripts/alp_orchestrate/secure.py derives `none`
// (SB_CONFIG_MCUBOOT_MODE_SINGLE_APP=y) on a single-slot target and `scratch`
// (SB_CONFIG_MCUBOOT_MODE_SWAP_SCRATCH=y) on every other one, and it REFUSES
// an explicit value on a single-slot target with an OrchestratorError.
//
// The Configurator carried a UI default of its own -- `boot.swap_algorithm ||
// "scratch"` -- which survived that schema change. All six E1M-AEN301 / 401 /
// 501 / 601 / 701 / 801 declare the same disjoint-slot0 `memory_map:`
// (he_slot0 at 0x80010000, hp_slot0 at 0x802b0000, no slot1, no scratch), so on
// any of them carrying an m55_he/m55_hp core -- the condition
// `_boot_target_is_single_slot` actually tests, alp-sdk#1069 -- that default
// displayed a mode the build was not in.
//
// The extension cannot tell single-slot from two-slot: it has the SKU and the
// cores, but the other half of the derivation is the SoM's `memory_map:`, and
// neither `alp presets` nor metadata/catalog.json carries it. So the fix is to
// render the unset state AS unset and let the SDK own the derivation -- the
// same rule the flash consent screen follows for helper flash_policy
// (packages/alp-core/src/flash/consent.ts, #659): state what is declared,
// never predict what the SDK will decide.
//
// This gate holds that line from both sides: it fails if a re-vendor restores
// a schema default, and it fails if the control reintroduces a local one.
//
// The control is read out of the .tsx source rather than imported: the webview
// bundle is IIFE-formatted for the webview's non-module script tag, so there is
// no requireable artefact to import it from (same reason as
// configurator.peripheralChoices.test.js, which anchors on a module-scope const
// for the same reason this one does -- an inline JSX literal moves).

const TSX = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "configurator",
  "ConfiguratorView.tsx",
);
const SCHEMA = path.join(__dirname, "..", "schemas", "board.schema.json");

const src = () => fs.readFileSync(TSX, "utf-8");

/** Collapse runs of whitespace so prettier's line breaks cannot fail a match. */
const flat = (s) => s.replace(/\s+/g, " ").trim();

/** The `<Select label="Swap algorithm" ... />` element, whitespace-normalised. */
function readSwapSelect() {
  const block = /<Select\s+label="Swap algorithm"([\s\S]*?)\/>/.exec(src());
  assert.ok(
    block,
    'ConfiguratorView.tsx must render a `<Select label="Swap algorithm" ... />` — ' +
      "if the control was renamed or restructured, update this gate to match",
  );
  return flat(block[1]);
}

/** The string pairs in `const SWAP_ALGORITHM_CHOICES = [...]`. */
function readSwapChoices() {
  const block = /const SWAP_ALGORITHM_CHOICES[^=]*=\s*\[([\s\S]*?)\];/.exec(
    src(),
  );
  assert.ok(
    block,
    "ConfiguratorView.tsx must declare `const SWAP_ALGORITHM_CHOICES = [...]` — " +
      "if it was renamed or moved, update this gate to match",
  );
  return [...block[1].matchAll(/\[\s*"([^"]*)"\s*,/g)].map((m) => m[1]);
}

test("the vendored schema declares no default for boot.swap_algorithm", () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf-8"));
  const node = schema.properties?.boot?.properties?.swap_algorithm;
  assert.ok(
    node && typeof node === "object",
    "vendored schema must define properties.boot.properties.swap_algorithm",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(node, "default"),
    false,
    "properties.boot.properties.swap_algorithm carries a `default` again — " +
      "the SDK derives this from the target's slot layout " +
      "(scripts/alp_orchestrate/secure.py, alp-sdk#1413), so a fixed schema " +
      "default would be wrong on every single-slot target. If upstream really " +
      "restored one, re-read #658 before relaxing this gate.",
  );
});

test("the Swap algorithm control substitutes no default of its own", () => {
  const select = readSwapSelect();
  const value = /value=\{([^}]*)\}/.exec(select);
  assert.ok(value, "the Swap algorithm Select must pass a `value=` expression");
  assert.match(
    value[1],
    /^boot\.swap_algorithm\s*(\|\||\?\?)\s*(""|'')$/,
    `the Swap algorithm Select falls back to \`${value[1].trim()}\` — it must ` +
      "render the absent key as absent. Naming a mode here reports a value " +
      "that is not in force on a single-slot target, which is the whole of " +
      "#658.",
  );
});

test("the Swap algorithm control offers the unset state plus the schema enum", () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf-8"));
  const enumValues = schema.properties?.boot?.properties?.swap_algorithm?.enum;
  assert.ok(
    Array.isArray(enumValues) && enumValues.length > 0,
    "vendored schema must define an enum for boot.swap_algorithm",
  );

  assert.match(
    readSwapSelect(),
    /options=\{SWAP_ALGORITHM_CHOICES\}/,
    "the Swap algorithm Select must render SWAP_ALGORITHM_CHOICES — an inline " +
      "option list puts the hand-synced-to-schema literal somewhere this gate " +
      "does not watch",
  );

  const values = readSwapChoices();
  assert.equal(
    values[0],
    "",
    "SWAP_ALGORITHM_CHOICES must offer the unset state FIRST, as the sibling " +
      'Bootloader select does (`["", "(SDK default)"]`) — otherwise there is ' +
      "no way back to letting the SDK derive the mode once a value has been " +
      "picked",
  );
  assert.deepEqual(
    values.slice(1),
    enumValues,
    `SWAP_ALGORITHM_CHOICES offers [${values.slice(1).join(", ")}] but the ` +
      `vendored schema enumerates [${enumValues.join(", ")}] — the two are ` +
      "hand-synced (the webview cannot import the vendored schema), so a " +
      "re-vendor that moves the enum has to move this literal too",
  );
});

test("the Swap algorithm control deletes the key on the unset option", () => {
  const select = readSwapSelect();
  assert.match(
    select,
    /if \(\s*!v\s*\) delete d\.boot\.swap_algorithm;/,
    "picking the unset option must DELETE boot.swap_algorithm, not write a " +
      "value: an explicit value on a single-slot target is a build-time " +
      "OrchestratorError, and absence is the only state the SDK derives from",
  );
  assert.doesNotMatch(
    select,
    /if \(\s*v === "(scratch|move|overwrite)"\s*\) delete d\.boot\.swap_algorithm;/,
    "the delete branch keys off a named mode again — that treats one real " +
      "MCUboot mode as if it meant 'no opinion', so the user cannot pin that " +
      "mode explicitly and cannot tell it apart from the derived default",
  );
});

test("the Swap algorithm control discloses that an explicit value can be refused", () => {
  const field = /<Field\s+label="Swap algorithm"([\s\S]*?)>/.exec(src());
  assert.ok(
    field,
    'ConfiguratorView.tsx must render a `<Field label="Swap algorithm" ...>`',
  );
  const hint = /hint="([^"]*)"/.exec(flat(field[1]));
  assert.ok(
    hint,
    "the Swap algorithm Field must carry a `hint` — the control offers three " +
      "values the build refuses on a single-slot target, and it cannot tell " +
      "which target it is on, so the refusal has to be DISCLOSED rather than " +
      "left for the user to discover at build time (#658)",
  );
  assert.match(
    hint[1],
    /single-slot/,
    "the Swap algorithm hint must name the single-slot case — that is the " +
      "condition under which an explicit value is refused",
  );
});
