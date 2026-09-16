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

/** `set` with `key` present or absent — a NEW set either way, so the state
 *  this feeds is replaced rather than edited under React. */
function withKey(
  set: ReadonlySet<string>,
  key: string,
  present: boolean,
): ReadonlySet<string> {
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

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
  // Expansion is its OWN state, not a reading of `selected`. A `treeitem`
  // carries `aria-selected` and `aria-expanded` as two independent facts, and
  // before this they were one: the only way to collapse a row was to
  // deselect it, and the only way to expand one was to select it — which
  // also moved the rail's highlight. ArrowRight/ArrowLeft move this set and
  // nothing else. Selection still expands, because a row picked on the rail
  // must show its detail in the table without a second interaction.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Which row holds the tree's single tab stop. Null until something moves
  // it, and stale whenever the row it names collapses out of the tree —
  // `activeKey` below resolves both cases rather than this state carrying a
  // reference it cannot honour.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const toggleGroup = (tier: AuthorityTier) =>
    setOpen((cur) => ({ ...cur, [tier]: !cur[tier] }));

  const regionNames = new Set(regions.map((r) => r.name));
  const orphanDevices = devicesWithNoRegion(spans, regionNames);

  const rows = buildRows(regions, spans, budgets, window, selected);
  const byTier = groupRowsByTier(rows);

  // Every row the arrows can reach, in rendered order. A collapsed tier's
  // rows are not rendered at all, so they are not here either — which is the
  // whole of "a collapsed group's rows leave the set": there is no second
  // list to keep in step.
  const reachable = TIERS.flatMap((tier) => (open[tier] ? byTier[tier] : []));
  // `findIndex` answers -1 for a `focusKey` whose row has since collapsed
  // away (or for the null it starts at), and the first row is where the tab
  // stop belongs in both cases. An empty table has no stop at all.
  const activeIndex = Math.max(
    0,
    reachable.findIndex((r) => r.key === focusKey),
  );
  const activeKey = reachable[activeIndex]?.key ?? null;

  /**
   * Move the tree's single tab stop, and the focus with it.
   *
   * The rendered `[role="treeitem"]` order IS `reachable`'s order — the JSX
   * below walks `TIERS` and then `byTier[tier]`, exactly as `reachable` does
   * — so the index maps straight onto the DOM. That is what lets this work
   * without a ref map or a per-row id: both would be a second copy of an
   * ordering the render already fixes, and a second copy is a thing that can
   * disagree.
   */
  const focusRowAt = (from: HTMLElement, index: number) => {
    const next = reachable[index];
    if (!next) return;
    setFocusKey(next.key);
    from
      .closest('[role="tree"]')
      ?.querySelectorAll<HTMLElement>('[role="treeitem"]')
      .item(index)
      ?.focus();
  };

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Memory map ({rows.length})</h3>
      <AuthorityLegend />
      {/* The per-tier toggle buttons live OUTSIDE the tree below — a button
       *  is not a valid `tree`/`group`/`treeitem` participant (it was not a
       *  valid `listbox`/`option` one either), and nesting one inside
       *  `role="group"` broke that ownership chain. `aria-controls` still
       *  ties each button to the group it shows or hides. */}
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
      {/* A TREE, not a listbox. `role="option"` supports `aria-selected` and
       *  not `aria-expanded`, and these rows do both: each one reveals a
       *  detail it owns. The ownership chain is the same shape it was —
       *  `tree` accepts `group → treeitem` exactly as `listbox` accepted
       *  `group → option`, and the `role="presentation"` wrapper below is
       *  still what re-parents the rows onto their group instead of onto an
       *  intervening `<ul>`. What the role change buys is the pattern's
       *  keyboard model, which this table now actually implements. */}
      <ul className={styles.rows} role="tree" aria-label="Memory map rows">
        {TIERS.map((tier) => (
          // The group stays MOUNTED regardless of `open[tier]` — only its
          // rows are conditional. A toggle button's `aria-controls` names
          // this element's `id`; unmounting the group along with its rows
          // left that id resolving to nothing the instant a tier collapsed.
          // Collapsing removes rows from the tree, never the group.
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
                  const showDetail =
                    row.selected || row.inert || expanded.has(row.key);
                  const index = reachable.indexOf(row);
                  return (
                    <li
                      key={row.key}
                      className={styles.row}
                      role="treeitem"
                      aria-selected={row.selected}
                      aria-expanded={showDetail}
                      aria-disabled={row.inert || undefined}
                      aria-label={row.accessibleName}
                      data-selected={row.selected || undefined}
                      // ONE tab stop for the whole table. Every other row is
                      // an explicit -1, never a missing attribute: an <li>
                      // with no tabindex is not focusable at all, so the
                      // arrows below would have nowhere to put the focus.
                      tabIndex={row.key === activeKey ? 0 : -1}
                      onClick={(e) => {
                        // A click focuses the row it lands on, so the tab
                        // stop follows it; leaving the stop behind means Tab
                        // and Shift+Tab return to a row nobody chose.
                        setFocusKey(row.key);
                        e.currentTarget.focus();
                        if (!row.inert) onSelect(row.id);
                      }}
                      onKeyDown={(e) => {
                        // Every key this table acts on is also a key the
                        // browser would otherwise act on — the arrows and
                        // Home/End scroll the panel, Space scrolls a page.
                        // Everything else falls through untouched: a handler
                        // that swallows keys it does not use takes type-ahead
                        // and every workbench shortcut with it.
                        switch (e.key) {
                          case "ArrowDown":
                            e.preventDefault();
                            // Clamped, not wrapped: a tree's arrows stop at
                            // the ends. The tab strip above DOES wrap, which
                            // is that pattern's own rule, not an oversight
                            // here.
                            focusRowAt(
                              e.currentTarget,
                              Math.min(index + 1, reachable.length - 1),
                            );
                            return;
                          case "ArrowUp":
                            e.preventDefault();
                            focusRowAt(e.currentTarget, Math.max(index - 1, 0));
                            return;
                          case "Home":
                            e.preventDefault();
                            focusRowAt(e.currentTarget, 0);
                            return;
                          case "End":
                            e.preventDefault();
                            focusRowAt(e.currentTarget, reachable.length - 1);
                            return;
                          case "ArrowRight":
                            e.preventDefault();
                            setExpanded((cur) => withKey(cur, row.key, true));
                            return;
                          case "ArrowLeft":
                            e.preventDefault();
                            // Collapse means BOTH sources of `showDetail`:
                            // dropping the key alone leaves a selected row
                            // announcing expanded with no way to close it,
                            // which is the state this task exists to end.
                            setExpanded((cur) => withKey(cur, row.key, false));
                            if (row.selected) onSelect(row.id);
                            return;
                          case "Enter":
                          case " ":
                            e.preventDefault();
                            if (!row.inert) onSelect(row.id);
                            return;
                          default:
                            return;
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
