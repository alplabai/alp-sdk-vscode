// SPDX-License-Identifier: Apache-2.0
//
// Six authority classes, three visible tiers. The six are NOT collapsed
// away: every row still carries its exact class name in its accessible name
// and in its expanded detail, so a declared `reserved` and a fail-closed
// `unstated` never claim to be the same thing. What the tier collapses is
// the FIRST GLANCE, where a six-item key is past the four-item limit a
// reader can hold, and where the one question being asked is "may I write
// here" — for which `reserved`, `composite` and `unstated` all answer the
// same way, because that is exactly what the fail-closed rule already does.

import type { MemoryAuthorityClass } from "../../types";

export type AuthorityTier = "yours" | "locked" | "unproven";

const TIER_OF: Record<MemoryAuthorityClass, AuthorityTier> = {
  customer_runtime: "yours",
  customer_image: "yours",
  locked: "locked",
  reserved: "unproven",
  composite: "unproven",
  unstated: "unproven",
};

export function tierOf(cls: MemoryAuthorityClass): AuthorityTier {
  return TIER_OF[cls];
}

/** Group headings. "Not yours or not proven" states both halves rather than
 *  picking one: `reserved` IS declared, `unstated` is not, and a heading
 *  claiming either for both would assert something the manifest did not. */
export const TIER_LABEL: Record<AuthorityTier, string> = {
  yours: "Yours to write",
  locked: "Locked",
  unproven: "Not yours or not proven",
};

/** Writable first. The old GROUP_ORDER led with `locked` — the rows a
 *  customer can do nothing about — on a tab whose purpose is the opposite. */
export const TIER_ORDER: Record<AuthorityTier, number> = {
  yours: 0,
  locked: 1,
  unproven: 2,
};

interface Sortable {
  authorityClass: MemoryAuthorityClass;
  base: number | null;
  name: string;
}

export function compareByTierThenAddress(a: Sortable, b: Sortable): number {
  const t =
    TIER_ORDER[tierOf(a.authorityClass)] - TIER_ORDER[tierOf(b.authorityClass)];
  if (t !== 0) return t;
  if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  return a.name.localeCompare(b.name);
}
