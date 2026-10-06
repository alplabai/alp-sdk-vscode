// SPDX-License-Identifier: Apache-2.0
//
// The "Helper MCUs" section: the module's own companion controllers (a
// Wi-Fi/BLE bridge, an IO MCU), one row each. `TBD` is said only when the
// firmware path itself is unresolved: a `recovery_only` helper has no flash
// method by design, and used to read as having no firmware at all.

import { useId } from "react";
import { Icon } from "../../shared/ui";
import type { ManifestHelperMcu } from "../../types";
import { isReady } from "./coreRowModel";
import styles from "./rows.module.css";

const POLICY_LABEL: Record<string, string> = {
  customer: "customer-flashable",
  factory: "factory-flashed",
  recovery_only: "recovery only",
};

export function HelperMcuRows({ mcus }: { mcus: ManifestHelperMcu[] }) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          Helper MCUs
        </h2>
      </div>
      <ul className={styles.list}>
        {mcus.map((mcu) => {
          const policy = mcu.flash_policy
            ? (POLICY_LABEL[mcu.flash_policy] ?? mcu.flash_policy)
            : null;
          return (
            <li key={mcu.name} className={styles.item}>
              <div className={styles.row}>
                <div className={styles.lead}>
                  <Icon name="cpu" size={16} className={styles.meterLabel} />
                  <div className={styles.ident}>
                    <span className={styles.name}>{mcu.name}</span>
                    <span className={styles.sub}>
                      {mcu.chip}
                      {policy && ` · ${policy}`}
                      {mcu.flash_method && ` · ${mcu.flash_method}`}
                    </span>
                  </div>
                </div>
                <div className={styles.body}>
                  {isReady(mcu.firmware_path) ? (
                    <span className={styles.name}>{mcu.firmware_path}</span>
                  ) : (
                    <span className={styles.status}>firmware TBD</span>
                  )}
                </div>
                {mcu.update_channel && (
                  <span className={styles.status}>
                    via{" "}
                    <span className={styles.name}>{mcu.update_channel}</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
