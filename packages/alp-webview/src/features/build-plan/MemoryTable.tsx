// SPDX-License-Identifier: Apache-2.0
//
// The unified, address-ordered memory map (#484 phase 3).
//
// WHY ONE TABLE. A customer extent (`m55_he`) used to sit in one list and
// the SoM region carrying its size (`he_slot0`) sat ~400px below it in a
// second list, with nothing on the surface saying the two describe the same
// address range. The join stays refused by NAME here too — `row.producer`
// is the only thing distinguishing two adjacent rows that could otherwise
// read as one fact — but the refusal is no longer silent: both rows now
// sit next to each other, address-ordered, each labelled with the producer
// that emitted it.
//
// READ-ONLY, same gate as the rest of this feature:
// `test/memoryRegions.readOnly.test.js`'s VIEW_FILES covers this file too.
//
// This file renders; `memoryTableRows.ts` decides which rows exist, which
// tier each belongs in, and the order they render in — moved there in
// review round 1 so that logic is unit-testable on its own, not only
// through a jsdom render.

import { useState } from "react";
import type { MemoryRegion, MemorySpan, SliceSize } from "../../types";
import { type AuthorityTier, TIER_LABEL } from "./authorityTier";
import { AuthorityLegend, AuthoritySwatch } from "./AuthoritySwatch";
import {
  buildRows,
  devicesWithNoRegion,
  groupRowsByTier,
  TIERS,
  type Row,
} from "./memoryTableRows";
import type { Window } from "./regionWindow";
import styles from "./MemoryTable.module.css";

function RowDetail({ row }: { row: Row }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailKind} data-kind={row.rawKind ?? undefined}>
        {row.kindText}
      </span>
      {row.authorityText && (
        <span
          className={styles.detailAuthority}
          data-class={row.authorityClassAttr ?? undefined}
        >
          {row.authorityText}
        </span>
      )}
      {row.cores.length > 0 && (
        <span className={styles.detailCores}>{row.cores.join(" ↔ ")}</span>
      )}
      {row.note && <span className={styles.detailNote}>{row.note}</span>}
      {row.reason && <span className={styles.detailReason}>{row.reason}</span>}
    </div>
  );
}

export function MemoryTable({
  regions,
  spans,
  budgets,
  window,
  selected,
  onSelect,
}: {
  regions: MemoryRegion[];
  spans: MemorySpan[];
  budgets: Map<string, SliceSize>;
  /** The chart's own (possibly grown) window, or null when no chart drew
   *  one — with no window there is no "outside it" to report. */
  window: Window | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<AuthorityTier, boolean>>({
    yours: true,
    locked: true,
    unproven: true,
  });
  const toggleGroup = (tier: AuthorityTier) =>
    setOpen((cur) => ({ ...cur, [tier]: !cur[tier] }));

  const regionNames = new Set(regions.map((r) => r.name));
  const orphanDevices = devicesWithNoRegion(spans, regionNames);

  const rows = buildRows(regions, spans, budgets, window, selected);
  const byTier = groupRowsByTier(rows);

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Memory map ({rows.length})</h3>
      <AuthorityLegend />
      {/* The per-tier toggle buttons live OUTSIDE the listbox below — a
       *  button is not a valid `listbox`/`group`/`option` participant, and
       *  nesting one inside `role="group"` broke that ownership chain
       *  (review round 1). `aria-controls` still ties each button to the
       *  group it shows or hides. */}
      <div className={styles.groupToggles}>
        {TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            className={styles.groupHead}
            aria-expanded={open[tier]}
            aria-controls={`memory-table-group-${tier}`}
            onClick={() => toggleGroup(tier)}
          >
            {TIER_LABEL[tier]} ({byTier[tier].length})
          </button>
        ))}
      </div>
      <ul className={styles.rows} role="listbox" aria-label="Memory map rows">
        {TIERS.map((tier) => (
          // The group stays MOUNTED regardless of `open[tier]` — only its
          // rows are conditional. A toggle button's `aria-controls` names
          // this element's `id`; unmounting the group along with its rows
          // left that id resolving to nothing the instant a tier collapsed.
          // Collapsing removes rows from the option set, never the group.
          <li
            key={tier}
            id={`memory-table-group-${tier}`}
            role="group"
            data-tier-group={tier}
            aria-label={`${TIER_LABEL[tier]} (${byTier[tier].length})`}
          >
            {open[tier] && (
              <ul className={styles.groupRows} role="presentation">
                {byTier[tier].map((row) => {
                  // A duplicated region can never select (`row.inert`), so
                  // it can never expand through the click below either —
                  // its detail (the "name shared by N rows" note is the
                  // only thing explaining WHY it is inert) stays visible
                  // unconditionally instead. Every other row's detail is
                  // one interaction away: `aria-expanded` and the DOM both
                  // agree with `showDetail` (not merely `row.selected`), so
                  // a screen reader is never told "collapsed" while the
                  // content sits in the tree anyway.
                  const showDetail = row.selected || row.inert;
                  return (
                    <li
                      key={row.key}
                      className={styles.row}
                      role="option"
                      aria-selected={row.selected}
                      aria-expanded={showDetail}
                      aria-disabled={row.inert || undefined}
                      aria-label={row.accessibleName}
                      data-selected={row.selected || undefined}
                      // Task 9 owns the real roving-tabindex model
                      // (ArrowUp/ArrowDown/Home/End). Until it lands, every
                      // row stays reachable by Tab — the same tabIndex={0}
                      // both deleted lists used — rather than leaving eight
                      // of nine rows unreachable.
                      tabIndex={0}
                      onClick={() => {
                        if (!row.inert) onSelect(row.id);
                      }}
                      onKeyDown={(e) => {
                        if (row.inert) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(row.id);
                        }
                      }}
                    >
                      <span data-col="swatch">
                        <AuthoritySwatch tier={row.tier} />
                      </span>
                      <span data-col="name" className={styles.name}>
                        {row.name}
                        <span className={styles.producer}>{row.producer}</span>
                      </span>
                      <code data-col="range" className={styles.range}>
                        {row.range}
                      </code>
                      <span data-col="size" className={styles.size}>
                        {row.size}
                      </span>
                      {row.outside && (
                        <span className={styles.outsideFlag}>
                          outside this map&rsquo;s window
                        </span>
                      )}
                      {showDetail && <RowDetail row={row} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {orphanDevices.map((name) => (
        <p key={name} className={styles.footerNote}>
          <code>{name}</code> is a controller instance, not a region (no base)
        </p>
      ))}
    </div>
  );
}
