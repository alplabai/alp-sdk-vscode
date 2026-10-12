// SPDX-License-Identifier: Apache-2.0
//
// Artifact provenance for one install step (#467). Pure: no vscode, no fs.
//
// WHERE IT COMES FROM. alp-sdk v0.16.0 (alp-sdk#1574) added an
// `artifactProvenance` map to `metadata/bootstrap.json`, and tan 0.7.0-rc1
// (tan-cli#1066) flattens it onto every `data.missingPrerequisites[]` entry of
// `tan doctor` as four keys beside `tool` and `command`: `tier`, `licence`,
// `sourceUrl`, `sizeBytes`. tan always emits all four, `null` where alp-sdk
// declares nothing. This module reads those keys and nothing else — never
// `bootstrap.json`, never a table keyed on tool name. tan owns the facts.
//
// MEASURED, alp-sdk v0.16.0 through v0.17.0-rc2: 8 entries (`7zip`, `cmake`,
// `git`, `ninja`, `python`, `python3`, `wget`, `xz`), every one tier `"A"`,
// `sizeBytes` null on all 8, `licence` null for `xz` and `7zip`. Rows whose
// tool has no entry (`west`, `zephyrSdk`, `setools`, `jlink`) carry no step
// and so no provenance, and the consent screen still says "not reported".
//
// `sourceUrl` IS THE UPSTREAM PROJECT PAGE (`https://cmake.org/`), not what
// runs. The consent screen's `Runs:` stays the producer's command line; a brew
// bottle or an apt package is what installs, not the tarball behind that page.
// tan renamed alp-sdk's `source` to `sourceUrl` at the seam for exactly this
// reason, and nothing here may fold the two back together.

/** One step's provenance, normalised. Every field `null` means "not
 *  reported" — an old tan, an SDK before alp-sdk#1574, a tool with no entry,
 *  or a value that failed normalisation. */
export interface PrerequisiteProvenance {
  /** ADR 0021 §3's tier word, trimmed and upper-cased (`"A"`, `"B"`, `"C"`
   *  today) — see `canonicalTier`. */
  tier: string | null;
  licence: string | null;
  /** The upstream project page. Never the install source. */
  sourceUrl: string | null;
  /** A non-negative whole byte count. */
  sizeBytes: number | null;
}

/** The "nothing reported" provenance. */
export const NO_PROVENANCE: PrerequisiteProvenance = Object.freeze({
  tier: null,
  licence: null,
  sourceUrl: null,
  sizeBytes: null,
});

/** A non-empty string, or `null`. No coercion: a number or an object rendered
 *  as a licence would be a fact this extension invented. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * A tier word in its one comparable spelling — trimmed and upper-cased, or
 * `null`. `" c"` and `"C"` are the same tier, and a gate comparing the raw
 * value would let the first one through unchecked. These are TIER words, not
 * tool names: canonicalising them decides nothing about any artifact.
 */
export function canonicalTier(value: unknown): string | null {
  const word = text(value);
  return word === null ? null : word.trim().toUpperCase();
}

/** A non-negative safe integer, or `null`. A float, a negative, a numeric
 *  string and a boolean are all refused — the same rules tan applies on its
 *  side, held again here because the envelope is untrusted input. */
function byteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * The four provenance keys off one `missingPrerequisites[]` entry. Anything
 * that is not an object, and every field of the wrong type, degrades to
 * `null` per FIELD: a malformed `sizeBytes` does not cost a real `licence`.
 * An entry from a tan older than 0.7.0-rc1 carries none of the keys and
 * normalises to `NO_PROVENANCE`.
 */
export function normaliseProvenance(entry: unknown): PrerequisiteProvenance {
  if (typeof entry !== "object" || entry === null) return NO_PROVENANCE;
  const record = entry as Record<string, unknown>;
  return {
    tier: canonicalTier(record.tier),
    licence: text(record.licence),
    sourceUrl: text(record.sourceUrl),
    sizeBytes: byteCount(record.sizeBytes),
  };
}

const KIB = 1024;
const UNITS: ReadonlyArray<{ size: number; name: string }> = [
  { size: KIB * KIB * KIB, name: "GiB" },
  { size: KIB * KIB, name: "MiB" },
  { size: KIB, name: "KiB" },
];

/**
 * A byte count for the consent screen: the largest binary unit it reaches,
 * with the exact count beside any figure that rounding changed —
 * `4 KiB`, `2.63 MiB (2758656 bytes)`, `512 bytes`.
 *
 * The webview's `formatBytes` (`features/build-plan/format.ts`) follows the
 * same rule, but `alp-webview` does not depend on `@alp-sdk/core` and core may
 * not import the webview, so it cannot be shared from either side.
 */
export function formatByteCount(bytes: number): string {
  for (const unit of UNITS) {
    if (bytes < unit.size) continue;
    const value = bytes / unit.size;
    const shown = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return Number(shown) * unit.size === bytes
      ? `${shown} ${unit.name}`
      : `${shown} ${unit.name} (${bytes} bytes)`;
  }
  return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
}
