// SPDX-License-Identifier: Apache-2.0
//
// Fail-closed mapping from a region's raw `write_authority` to its class (#484).

import type { MemoryAuthorityClass, MemoryRegionSource } from "./types";

// A Map, not a plain object literal: a plain object indexed by bracket
// notation returns an inherited Object.prototype member for a key like
// "constructor" or "__proto__" — a real, non-null value that a `?? "unstated"`
// fallback would never catch. A Map's `.get` has no prototype chain to leak
// through, so an unrecognised key (however it spells itself) always misses
// cleanly.
const AUTHORITY_CLASS_BY_WRITE_AUTHORITY = new Map<
  string,
  MemoryAuthorityClass
>([
  ["customer_runtime", "customer_runtime"],
  ["customer_image", "customer_image"],
  ["vendor_image", "locked"],
  ["secure_enclave", "locked"],
  ["none", "reserved"],
  ["composite", "composite"],
]);

/**
 * Fail-closed derivation of a region's `authorityClass` from its raw
 * `write_authority` string. Exhaustively unit-tested; defaults to
 * `"unstated"` for `null` and for any string this table does not
 * recognise — including an inherited `Object.prototype` member name, which
 * a plain-object lookup would not have refused.
 *
 * `source` never changes the CLASS this returns today — a `som_preset` row
 * and a `soc_derived` row with the same (or absent) `write_authority`
 * always land in the same class. It is still a parameter: the LABEL a UI
 * puts beside that class (never computed here — see the webview) differs
 * by source for the absent case ("authority not declared" vs "not
 * authored · SoC-derived table"), and keeping both functions keyed on the
 * same two arguments is what keeps them from drifting apart on what a
 * region even is.
 */
export function authorityClassOf(
  writeAuthority: string | null,
  source: MemoryRegionSource,
): MemoryAuthorityClass {
  void source;
  if (writeAuthority === null) return "unstated";
  return AUTHORITY_CLASS_BY_WRITE_AUTHORITY.get(writeAuthority) ?? "unstated";
}
