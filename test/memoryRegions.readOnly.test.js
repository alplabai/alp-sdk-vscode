// SPDX-License-Identifier: Apache-2.0
//
// The memory view stays READ-ONLY until the contract can tell a
// customer-sizeable band from a Secure-Enclave one (#484, D5).
//
// WHY THIS IS A GATE AND NOT A CONVENTION. Nothing in the emitted data
// distinguishes `storage` at 0x80560000 (96 KiB, customer-sized) from `atoc` at
// 0x80578000 (32 KiB, Secure-Enclave-owned). Writing the ATOC can leave the
// part unbootable — measured on E1M-AEN801, 2026-08-08: a Zephyr app erased
// 0x80560000 inside what was then the same `storage` partition while the live
// ATOC sat intact at 0x8057EA50, magic `ckBS` (0x53426B63); nothing failed at
// build time and nothing failed at run time.
//
// alp-sdk#1289 split that band out. alp-sdk#1365 is what would let a UI tell
// the two apart: a derived `kind` and a schema-required `owner`, emitted into
// `system-manifest-v1`. Until then an edit affordance over this map is a live
// hazard, and "we remembered not to add one" is exactly the class of guarantee
// #484 exists to replace with something you cannot express.
//
// The third test is the tripwire: it fails the day the contract grows the
// missing half, so the read-only decision is re-taken deliberately by whoever
// lands it, rather than quietly outliving its reason.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const VIEW = path.join(
  REPO,
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
  "MemoryRegions.tsx",
);

const read = (p) => fs.readFileSync(p, "utf8");

test("the memory view has no path back to the host", () => {
  // Arrange
  const source = read(VIEW);

  // Act / Assert — every way this webview can ask the extension to do
  // anything. `postMessage` is the transport; `runCommand` is the allow-listed
  // command channel; importing the `vscode` shim is how a component reaches
  // either one.
  for (const forbidden of [
    "postMessage",
    "runCommand",
    'from "../../vscode"',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `MemoryRegions.tsx must not use ${forbidden} — the view is read-only ` +
        "until alp-sdk#1365 lands `kind` + `owner`",
    );
  }
});

test("the memory view offers no editing affordance", () => {
  const source = read(VIEW);

  // A control that takes a value is the shape of an edit. Buttons are allowed
  // and present (scale mode, row selection); they change what is DRAWN, never
  // what is stored.
  for (const forbidden of [
    "<input",
    "<textarea",
    "<select",
    "contentEditable",
    "onChange",
    "onSubmit",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `MemoryRegions.tsx must not render ${forbidden}`,
    );
  }

  // And the two board.yaml fields an editor would target are not named here at
  // all, so a half-built editor cannot begin by "just showing" them.
  for (const field of ["carve_out_kb", "size_kib", "offset_kib"]) {
    assert.equal(
      source.includes(field),
      false,
      `MemoryRegions.tsx names the editable board.yaml field ${field}`,
    );
  }
});

test("the contract still cannot tell a customer band from a secure one", () => {
  // The tripwire. `system-manifest-v1` carries no region view today; when it
  // grows one, this fails and the read-only decision above must be re-taken
  // with the new data in hand — including whether `owner` is schema-REQUIRED,
  // because an omitted owner that renders as unlocked is the same fail-open
  // the whole design exists to avoid.
  const schema = JSON.parse(
    read(path.join(REPO, "schemas", "system-manifest-v1.schema.json")),
  );
  const roots = Object.keys(schema.properties);

  assert.deepEqual(
    roots,
    [
      "schema_version",
      "generated_by",
      "hw_info",
      "slices",
      "ipc",
      "helper_mcus",
      "boot_order",
      "storage",
    ],
    "system-manifest-v1 grew or lost a root key. If a region/memory view " +
      "landed, re-read #484 D5: the map may become editable only over " +
      "board.yaml (ipc[].carve_out_kb, storage[].size_kib / offset_kib), " +
      "never over the SoM preset, and only once `owner` arrives " +
      "schema-required with no default.",
  );
  assert.equal(schema.additionalProperties, false);
});
