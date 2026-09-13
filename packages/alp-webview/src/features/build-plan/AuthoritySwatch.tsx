// SPDX-License-Identifier: Apache-2.0
//
// READ-ONLY, same gate as the other view files.
import { type AuthorityTier, TIER_LABEL } from "./authorityTier";
import styles from "./AuthoritySwatch.module.css";

/** Decorative: every row states its tier in text as well, so the swatch is
 *  `aria-hidden` rather than carrying a second, competing announcement. */
export function AuthoritySwatch({ tier }: { tier: AuthorityTier }) {
  return <span className={styles.swatch} data-tier={tier} aria-hidden="true" />;
}

export function AuthorityLegend() {
  return (
    <p className={styles.legend}>
      {(["yours", "locked", "unproven"] as AuthorityTier[]).map((tier) => (
        <span key={tier} className={styles.legendItem}>
          <AuthoritySwatch tier={tier} />
          {TIER_LABEL[tier]}
        </span>
      ))}
    </p>
  );
}
