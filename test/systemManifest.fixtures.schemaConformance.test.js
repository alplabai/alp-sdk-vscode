// SPDX-License-Identifier: Apache-2.0
//
// Every `system-manifest*` fixture must satisfy the REQUIRED keys of the
// vendored schema it claims to be an instance of.
//
// WHY THIS EXISTS. Nothing checked it before, and the gap was not theoretical:
// alp-sdk `v0.16.0` made `helper_mcus[].flash_policy` REQUIRED, and
// `system-manifest.aen801.yaml` had no such key. The whole suite — 2242 tests —
// stayed green through the re-vendor, because `system-manifest.schema.vendored`
// only hashes the SCHEMA and every fixture consumer only reads the fields it
// happens to care about. A fixture can therefore be an instance of nothing at
// all and no gate notices. `flash_policy` is the key that says WHO may write a
// helper MCU, so "no gate notices" was the wrong answer for that key in
// particular.
//
// WHAT THIS DOES NOT COVER, stated so nobody reads a pass as full validation:
// no types, no `enum` membership, no `additionalProperties`, no `$defs`, no
// `oneOf`/`anyOf`, no `pattern`, no `minimum`. It is a REQUIRED-key presence
// check at the root and one level into each array of objects — deliberately the
// cheapest thing that catches the failure that actually happened, with no new
// dependency. If this repo ever takes a real JSON-Schema validator, replace the
// walk below with it rather than growing it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "schemas",
  "system-manifest-v1.schema.json",
);

const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));

/** Every `system-manifest*.y{a,}ml` under test/fixtures, by filename. */
function manifestFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => /^system-manifest.*\.ya?ml$/.test(f))
    .sort();
}

/**
 * Missing REQUIRED keys in `doc` against `schema`, as dotted paths.
 *
 * Recurses only where the schema is explicit: an object's own `required`, and
 * `items.required` for an array of objects. An absent OPTIONAL array is not a
 * finding — the schema marks `storage` optional and most projects declare none.
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * True only for a schema describing an OBJECT with something to require.
 *
 * `ipc[].endpoints` is an array of plain strings, so its `items` is
 * `{type: "string"}` — a plain object, but not an object SCHEMA. Recursing
 * into it reported every endpoint id as "string, not an object", which is the
 * gate inventing a violation rather than finding one.
 */
function isObjectSchema(s) {
  return (
    isPlainObject(s) &&
    (s.type === "object" ||
      Array.isArray(s.required) ||
      isPlainObject(s.properties))
  );
}

function missingRequired(doc, schema, where = "") {
  const at = where || "<root>";
  // NOT a silent skip. An earlier version returned `[]` here, which made the
  // gate pass on an empty file, a comment-only file, `~`, a bare scalar, and
  // on `helper_mcus: TBD` / `[~]` / `[cc3501e_otp]` — i.e. on exactly the
  // shapes it exists to catch, since `flash_policy` is never reached in any
  // of them. A thing that should be an object and is not IS the finding.
  if (!isPlainObject(doc)) {
    return [`${at} is ${doc === null ? "null" : typeof doc}, not an object`];
  }

  const missing = [];
  for (const key of schema.required ?? []) {
    if (!(key in doc)) missing.push(where ? `${where}.${key}` : key);
  }

  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const value = doc[key];
    if (value === undefined) continue;
    const path = where ? `${where}.${key}` : key;
    if (sub.type === "array" && isObjectSchema(sub.items)) {
      if (!Array.isArray(value)) {
        missing.push(`${path} is not an array, so its items are unchecked`);
        continue;
      }
      value.forEach((item, i) => {
        missing.push(...missingRequired(item, sub.items, `${path}[${i}]`));
      });
    } else if (sub.type === "object") {
      missing.push(...missingRequired(value, sub, path));
    }
  }
  return missing;
}

test("every system-manifest fixture satisfies the vendored schema's required keys", () => {
  const fixtures = manifestFixtures();
  assert.ok(
    fixtures.length > 0,
    "no system-manifest fixture found — this gate would pass vacuously",
  );

  for (const name of fixtures) {
    const doc = yaml.load(
      fs.readFileSync(path.join(FIXTURE_DIR, name), "utf-8"),
    );
    const missing = missingRequired(doc, SCHEMA);
    assert.deepEqual(
      missing,
      [],
      `${name} is missing required key(s) the vendored schema declares: ` +
        `${missing.join(", ")}. Either the fixture predates a re-vendor and ` +
        "must be regenerated from the SDK tag (see the fixture's consumer " +
        "header for the exact command), or the schema moved and this fixture " +
        "was never refreshed with it.",
    );
  }
});

// The check above is only as strong as the schema actually requiring something.
// If a future re-vendor relaxes `required` to nothing, the walk would pass on
// an empty document and say nothing — so pin the one requirement this gate was
// built for, and the root set alongside it.
test("the vendored schema still requires the keys this gate was built to enforce", () => {
  assert.deepEqual(SCHEMA.required, [
    "schema_version",
    "generated_by",
    "hw_info",
    "slices",
    "ipc",
    "helper_mcus",
    "boot_order",
  ]);
  assert.deepEqual(SCHEMA.properties.helper_mcus.items.required, [
    "name",
    "chip",
    "flash_policy",
  ]);
});
