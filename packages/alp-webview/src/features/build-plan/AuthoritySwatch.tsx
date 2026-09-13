// SPDX-License-Identifier: Apache-2.0
//
// READ-ONLY, same gate as the other view files.
import { type AuthorityTier, TIER_LABEL, TIER_ORDER } from "./authorityTier";
import styles from "./AuthoritySwatch.module.css";

/** Decorative: every row states its tier in text as well, so the swatch is
 *  `aria-hidden` rather than carrying a second, competing announcement. */
export function AuthoritySwatch({ tier }: { tier: AuthorityTier }) {
  return <span className={styles.swatch} data-tier={tier} aria-hidden="true" />;
}

// Derived from TIER_LABEL, not a third hand-typed ["yours","locked",...]
// copy: a `Record<AuthorityTier, ...>` forces every tier to have a label, so
// a new tier is included here automatically instead of needing a matching
// literal-array edit (and a stale `as AuthorityTier[]` cast silently letting
// it be missed).
const LEGEND_TIERS = (Object.keys(TIER_LABEL) as AuthorityTier[]).sort(
  (a, b) => TIER_ORDER[a] - TIER_ORDER[b],
);

export function AuthorityLegend() {
  return (
    <p className={styles.legend}>
      {LEGEND_TIERS.map((tier) => (
        <span key={tier} className={styles.legendItem}>
          <AuthoritySwatch tier={tier} />
          {TIER_LABEL[tier]}
        </span>
      ))}
    </p>
  );
}
