// SPDX-License-Identifier: Apache-2.0
//
// Shape guards for the manifest's untyped fields (#484). The rule is DROP what
// does not match, never coerce it, and never invent a replacement.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-empty string, or null. Never a coerced number or a trimmed blank. */
export function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A byte count: a safe, non-negative integer, or null.
 *
 * `Number.isSafeInteger` and not `isFinite`: a 64-bit address past 2^53 cannot
 * round-trip through a JS number, and a base that is off by a few bytes is
 * worse on this screen than one that is absent.
 */
export function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * A hex-or-integer quantity, from either spelling the emitter uses.
 *
 * `carve_out_base` / `carve_out_size` and `flash_args.slot0_load_address` all
 * arrive QUOTED (`'0x00010000'`); `offset_kib` / `size_kib` arrive as YAML
 * integers. Both are accepted, nothing else is: a bare decimal string is
 * refused rather than parsed, since an unprefixed number in a field of hex is
 * more likely a mistake than a base-10 address.
 */
export function asHexOrCount(value: unknown): number | null {
  if (typeof value === "number") return asCount(value);
  if (typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]{1,16}$/.test(value)) return null;
  return asCount(Number(value));
}

/** The core ids a link names. Non-string members are dropped, not stringified. */
export function asCores(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

/** A status that is present and not `ok` — the same rule `unhealthyIpcLinks`
 *  applies, so the two surfaces cannot disagree about what "resolved" means.
 *  A resolved entry carries no `status` at all, so absence is not degraded. */
export function isDegraded(status: string | null): boolean {
  return status !== null && status !== "ok";
}

/** Only the members that are objects. The cast in `parseSystemManifest` admits
 *  anything a YAML list can hold, including the `null` a half-written file
 *  yields at a `- ` boundary. */
export function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/** A string field that is always readable even when it names nothing this
 *  contract recognises — `source`, `kind` and `status` are open unions on
 *  purpose (see their type docs), so an unrecognised value must still be a
 *  string a UI can render, never null. */
export function asOpenString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
