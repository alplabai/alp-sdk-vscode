// SPDX-License-Identifier: Apache-2.0
//
// Six authority classes, three visible tiers. The six are NOT collapsed
// away: every strip item still carries its exact class name in its
// accessible name, and the selected detail carries the prose
// `authorityLabel()` derives from that class ("no writer · reserved"
// against "authority not declared"), so a declared `reserved` and a
// fail-closed `unstated` never claim to be the same thing. What the tier
// collapses is the FIRST GLANCE, where a six-item key is past the four-item
// limit a reader can hold, and where the one question being asked is "may I
// write here" — for which `reserved`, `composite` and `unstated` all answer
// the same way, because that is exactly what the fail-closed rule already
// does.

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

/** Legend wording. "Not yours or not proven" states both halves rather than
 *  picking one: `reserved` IS declared, `unstated` is not, and a label
 *  claiming either for both would assert something the manifest did not. */
export const TIER_LABEL: Record<AuthorityTier, string> = {
  yours: "Yours to write",
  locked: "Locked",
  unproven: "Not yours or not proven",
};
