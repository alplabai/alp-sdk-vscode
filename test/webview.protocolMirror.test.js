// SPDX-License-Identifier: Apache-2.0
//
// The WHOLE extension↔webview message contract, gated.
//
// `src/ideHub/messages.ts` and `packages/alp-webview/src/types.ts` are two
// separate builds describing ONE wire format, kept in step BY HAND — the
// mirror's own header says so. `test/deps.protocol.test.js` already pins the
// pieces that had bitten us (PROTOCOL_VERSION, the three dependency messages,
// `ToolchainFixId`, the retired Toolchain Doctor names), and
// `test/ideHub.messages.test.js` asserts the host side's runtime shapes.
// Neither compares the two unions, so this file does.
//
// WHY A GATE AT ALL — the failure is quiet in both directions:
//
//   * a message the host sends and the mirror does not declare reaches the
//     webview as an unhandled `type`, so the view sits in its skeleton state
//     forever with nothing on any surface saying why;
//   * a message the webview posts and the host does not declare is dropped on
//     the floor by the panel's `switch` default — the button simply does
//     nothing;
//   * a FIELD that moves is worse than either. The view reads `undefined` and,
//     depending only on how the access happens to be spelled, either throws
//     mid-render and blanks the panel or renders a confident wrong answer.
//     `packages/alp-core/src/tanPayloadShape.ts` exists because exactly that
//     class of skew already cost us across the tan boundary; this boundary has
//     the same shape and, until now, less cover.
//
// Read as TEXT, for the reason `deps.protocol.test.js` gives: `types.ts` is
// never compiled into `out/`, so a structural check would only ever see the
// host half.
//
// WHAT IS COMPARED, AND WHAT DELIBERATELY IS NOT:
//
//   compared — the two union member lists, each member's `type:` discriminant,
//   and each member interface's field NAMES with their optional markers.
//
//   NOT compared — field TYPE text. The two sides legitimately spell the same
//   contract differently: `StateUpdateMessage._v` is `typeof PROTOCOL_VERSION`
//   on the host and `number` in the mirror, and `SdkStatus.readiness` is
//   `SdkReadinessState | "unknown"` against a mirror `SdkReadinessState` that
//   already includes `"unknown"`. Asserting the text would red on differences
//   that are not drift, and a gate that cries wolf gets deleted.
//
//   NOT compared — the deep payload MODELS (`SystemManifest`, `Ota`,
//   `BoardConfig`, …). Those mirror `@alp-sdk/core`, not the host protocol, and
//   the relationship is deliberately loose: the mirror carries only what the
//   webview renders. Three additive gaps exist today and are harmless for that
//   reason (`ManifestHwInfo.eeprom`, `Ota.rollback`/`Ota.storage`,
//   `ManifestSlice.recipe`). Gating them here would red on landing and teach
//   the next reader to skip the file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HOST_REL = "src/ideHub/messages.ts";
const MIRROR_REL = "packages/alp-webview/src/types.ts";

const UNIONS = ["ExtToWebviewMessage", "WebviewToExtMessage"];

/** Both message unions, in the direction they travel — for the failure text. */
const DIRECTION = {
  ExtToWebviewMessage: "extension → webview",
  WebviewToExtMessage: "webview → extension",
};

// ---------------------------------------------------------------------------
// Source reading — the parsers below are text-level on purpose (see header)
// ---------------------------------------------------------------------------

/**
 * Drop comments so a `{`, a `;` or the word `type:` inside prose cannot be
 * read as source. Block comments go first; a line comment is only stripped
 * when the `//` is not inside a string literal (an even number of quotes
 * precedes it), which keeps a URL in a string intact.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      const quotes = (line.slice(0, at).match(/"/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, at) : line;
    })
    .join("\n");
}

/** The member type names of `export type <name> = A | B | C;`. */
function unionMembers(source, typeName, file) {
  const match = new RegExp(
    `export type ${typeName}\\s*=([\\s\\S]*?);`,
    "m",
  ).exec(source);
  assert.ok(match, `${file}: no \`export type ${typeName}\``);
  return match[1]
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The brace-balanced body of `export interface <name> … { … }`, or null.
 * Balanced rather than a lazy `\{([\s\S]*?)\}` because message payloads nest —
 * `E1mModule.cores?: { id: string; os: string }[]` would otherwise be cut at
 * the first inner `}` and the rest of the interface silently lost.
 */
function interfaceBody(source, name) {
  const header = new RegExp(`export interface ${name}\\b[^{]*\\{`, "m").exec(
    source,
  );
  if (!header) return null;

  let depth = 1;
  const start = header.index + header[0].length;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

/**
 * Top-level field names of an interface body, each carrying its `?` when the
 * field is optional — so a field going from required to optional (or back) is
 * drift too, not a silent widening.
 *
 * Nested brace groups are blanked first so a `;` inside an inline object type
 * cannot split a field in two.
 */
function fieldNames(body) {
  let flat = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") {
      depth += 1;
      flat += " ";
    } else if (ch === "}") {
      depth -= 1;
      flat += " ";
    } else {
      flat += depth > 0 ? " " : ch;
    }
  }
  return new Set(
    flat
      .split(";")
      .map((entry) => /^\s*(\w+)(\?)?\s*:/.exec(entry))
      .filter(Boolean)
      .map((m) => `${m[1]}${m[2] ?? ""}`),
  );
}

/** The `type: "…"` discriminant of an interface body, or null. */
function discriminant(body) {
  const match = /\btype:\s*"([^"]+)"/.exec(body);
  return match ? match[1] : null;
}

function load(relative) {
  return stripComments(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

const host = load(HOST_REL);
const mirror = load(MIRROR_REL);

// ---------------------------------------------------------------------------
// The unions
// ---------------------------------------------------------------------------

for (const union of UNIONS) {
  test(`${union}: the host and the webview mirror declare the same members`, () => {
    const hostMembers = new Set(unionMembers(host, union, HOST_REL));
    const mirrorMembers = new Set(unionMembers(mirror, union, MIRROR_REL));

    for (const member of hostMembers) {
      assert.ok(
        mirrorMembers.has(member),
        `${union} member \`${member}\` is declared in ${HOST_REL} but missing ` +
          `from ${MIRROR_REL}. This message travels ${DIRECTION[union]}, and ` +
          `the webview has no type for it: add it to the mirror.`,
      );
    }
    for (const member of mirrorMembers) {
      assert.ok(
        hostMembers.has(member),
        `${union} member \`${member}\` is declared in ${MIRROR_REL} but no ` +
          `longer in ${HOST_REL}. Either the mirror is stale, or removing it ` +
          `host-side was a breaking protocol change that needs a ` +
          `PROTOCOL_VERSION bump (see test/deps.protocol.test.js).`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Each member's discriminant and field set
// ---------------------------------------------------------------------------

test("every message interface exists on both sides", () => {
  for (const union of UNIONS) {
    for (const member of unionMembers(host, union, HOST_REL)) {
      assert.ok(
        interfaceBody(host, member),
        `${HOST_REL}: \`${union}\` names \`${member}\`, which is not declared there`,
      );
      assert.ok(
        interfaceBody(mirror, member),
        `${MIRROR_REL}: \`${union}\` names \`${member}\`, which is not declared there`,
      );
    }
  }
});

test("every message carries the same `type` discriminant on both sides", () => {
  for (const union of UNIONS) {
    for (const member of unionMembers(host, union, HOST_REL)) {
      const hostBody = interfaceBody(host, member);
      const mirrorBody = interfaceBody(mirror, member);
      if (!hostBody || !mirrorBody) continue; // reported by the test above

      const hostType = discriminant(hostBody);
      assert.ok(
        hostType,
        `${HOST_REL}: \`${member}\` has no \`type: "…"\` discriminant`,
      );
      assert.equal(
        discriminant(mirrorBody),
        hostType,
        `\`${member}\` is discriminated as "${hostType}" in ${HOST_REL} but ` +
          `differently in ${MIRROR_REL}. The two sides switch on this string, ` +
          `so a mismatch means the message is silently unhandled.`,
      );
    }
  }
});

test("every message interface has the same fields on both sides", () => {
  for (const union of UNIONS) {
    for (const member of unionMembers(host, union, HOST_REL)) {
      const hostBody = interfaceBody(host, member);
      const mirrorBody = interfaceBody(mirror, member);
      if (!hostBody || !mirrorBody) continue; // reported above

      const hostFields = fieldNames(hostBody);
      const mirrorFields = fieldNames(mirrorBody);

      for (const field of hostFields) {
        assert.ok(
          mirrorFields.has(field),
          `\`${member}.${field}\` exists in ${HOST_REL} but not in ` +
            `${MIRROR_REL}. The webview would read it as \`undefined\` — which ` +
            `either throws mid-render or renders a confident wrong answer, ` +
            `depending only on how the access is spelled.`,
        );
      }
      for (const field of mirrorFields) {
        assert.ok(
          hostFields.has(field),
          `\`${member}.${field}\` exists in ${MIRROR_REL} but not in ` +
            `${HOST_REL}. The webview reads a field the host never sends.`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The parsers themselves
// ---------------------------------------------------------------------------

// A gate that silently parses nothing passes forever. These pin the two
// failure modes that would do it: a union regex that matches no members, and
// an interface reader that stops at the first nested `}`.
test("the union and interface parsers actually read something", () => {
  for (const union of UNIONS) {
    assert.ok(
      unionMembers(host, union, HOST_REL).length >= 5,
      `${union} parsed to fewer than 5 members — the union parser is broken, ` +
        `not the protocol`,
    );
  }

  const nested = interfaceBody(
    "export interface Probe {\n  a?: { b: string; c: string }[];\n  d: number;\n}",
    "Probe",
  );
  assert.ok(nested, "the interface reader found no body for a nested fixture");
  assert.deepEqual(
    [...fieldNames(nested)].sort(),
    ["a?", "d"],
    "the field reader lost a field after an inline object type",
  );
});
