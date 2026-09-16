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

import { useId, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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

/**
 * One node of the rendered tree: a row, or the detail a row owns.
 *
 * Both are `treeitem`s, so both take part in the arrow walk and either can
 * hold the table's single tab stop. The list of these IS the rendered order,
 * which is what lets the arrows address the DOM by index.
 */
type TreeNode = { key: string; row: Row; isDetail: boolean };

/** A detail node's key, derived from its row's so the two can never drift. */
const detailKeyOf = (row: Row): string => `${row.key}:detail`;

type NodeKeyHandler = (e: ReactKeyboardEvent<HTMLLIElement>) => void;

/**
 * The facts a row reveals, as a real child node of that row.
 *
 * `aria-expanded` is only permitted on a node that OWNS an expandable
 * grouping element — an end node carrying it is described to assistive
 * technology as a parent that is not there, which is what this markup used
 * to do to all nine rows. So the detail is a `role="group"` holding one
 * `treeitem`: the row's `aria-expanded` is now true of something, and the
 * content the row announces as revealed is reachable by the same ArrowDown
 * that announced it.
 *
 * ONE node, not one per fact. The detail is a single bundle about a single
 * row — kind, authority, cores, note, reason — and splitting it into five
 * nodes would make the reader take five steps to collect what belongs
 * together. It carries no `aria-expanded` of its own: it owns nothing, and
 * that is exactly the rule the rows above were breaking.
 */
function RowDetail({
  row,
  tabIndex,
  onKeyDown,
}: {
  row: Row;
  tabIndex: number;
  onKeyDown: NodeKeyHandler;
}) {
  return (
    <ul className={styles.detailGroup} role="group">
      <li
        className={styles.detail}
        role="treeitem"
        aria-level={2}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
      >
        <span
          className={styles.detailKind}
          data-kind={row.rawKind ?? undefined}
        >
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
        {row.reason && (
          <span className={styles.detailReason}>{row.reason}</span>
        )}
      </li>
    </ul>
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
  // Expansion is its OWN state, read by nothing else. It used to be a
  // reading of `selected`, which made the two inseparable: the only way to
  // open a row was to select it — moving the rail's highlight — and the only
  // way to close one was to deselect it. ArrowRight and ArrowLeft move this
  // set and NOTHING else, so neither can disturb the rail.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Which node holds the tree's single tab stop. Null until something moves
  // it, and stale whenever the node it names collapses out of the tree —
  // `activeKey` below resolves both cases rather than this state carrying a
  // reference it cannot honour.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Per-INSTANCE group ids. An IDREF resolves against the whole document, so
  // a hardcoded `memory-table-group-yours` is the wrong element the moment
  // two Build Plan panels are mounted at once.
  const uid = useId();
  const groupDomId = (tier: AuthorityTier) => `${uid}-group-${tier}`;
  const toggleGroup = (tier: AuthorityTier) =>
    setOpen((cur) => ({ ...cur, [tier]: !cur[tier] }));

  const regionNames = new Set(regions.map((r) => r.name));
  const orphanDevices = devicesWithNoRegion(spans, regionNames);

  const rows = buildRows(regions, spans, budgets, window, selected);
  const byTier = groupRowsByTier(rows);

  // A duplicated region can never select (`row.inert`), so it can never be
  // opened by the interaction below either — its detail carries the "name
  // shared by N rows" note that is the only thing explaining WHY it is
  // inert, so it stays open unconditionally instead.
  const showDetailOf = (row: Row) => row.inert || expanded.has(row.key);

  // Every node the arrows can reach, in rendered order: each visible row,
  // each followed by its detail when that row is open. A collapsed tier's
  // rows are not rendered at all, so they are not here either — which is the
  // whole of "a collapsed group's rows leave the set": there is no second
  // list to keep in step.
  const reachable: TreeNode[] = TIERS.filter((tier) => open[tier]).flatMap(
    (tier) =>
      byTier[tier].flatMap((row) =>
        showDetailOf(row)
          ? [
              { key: row.key, row, isDetail: false },
              { key: detailKeyOf(row), row, isDetail: true },
            ]
          : [{ key: row.key, row, isDetail: false }],
      ),
  );
  // `findIndex` answers -1 for a `focusKey` whose node has since collapsed
  // away (or for the null it starts at), and the first node is where the tab
  // stop belongs in both cases. An empty table has no stop at all.
  const activeIndex = Math.max(
    0,
    reachable.findIndex((n) => n.key === focusKey),
  );
  const activeKey = reachable[activeIndex]?.key ?? null;

  /**
   * Move the tree's single tab stop, and the focus with it.
   *
   * The rendered `[role="treeitem"]` order IS `reachable`'s order — a row is
   * emitted, then the detail nested inside it, which is document order — so
   * the index maps straight onto the DOM. That is what lets this work
   * without a ref map or a per-node id: both would be a second copy of an
   * ordering the render already fixes, and a second copy is a thing that can
   * disagree.
   */
  const focusNodeAt = (from: HTMLElement, index: number) => {
    const next = reachable[index];
    if (!next) return;
    setFocusKey(next.key);
    from
      .closest('[role="tree"]')
      ?.querySelectorAll<HTMLElement>('[role="treeitem"]')
      .item(index)
      ?.focus();
  };

  /** The primary interaction: click, Enter, Space. Selection and the detail
   *  move together here — that is what a click has always done on this table
   *  — and the arrows are what pull them apart. */
  const activate = (row: Row) => {
    setFocusKey(row.key);
    if (row.inert) return;
    onSelect(row.id);
    setExpanded((cur) => withKey(cur, row.key, !row.selected));
  };

  const onNodeKeyDown = (
    node: TreeNode,
    e: ReactKeyboardEvent<HTMLLIElement>,
  ) => {
    // ONLY the node that actually has the focus acts. A detail node is
    // rendered INSIDE its row, so its keydown bubbles into the row's handler
    // as well — and the two then both move the focus, which lands it back
    // where it started (ArrowDown standing still) or collapses the row the
    // reader had just stepped into (ArrowLeft).
    if (e.target !== e.currentTarget) return;
    // Every key acted on here is also a key the browser would otherwise act
    // on — the arrows and Home/End scroll the panel, Space scrolls a page.
    // Everything else falls through untouched: a handler that swallows keys
    // it does not use takes type-ahead and every workbench shortcut with it.
    const index = reachable.findIndex((n) => n.key === node.key);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        // Clamped, not wrapped: a tree's arrows stop at the ends. The tab
        // strip above DOES wrap, which is that pattern's own rule, not an
        // oversight here.
        focusNodeAt(e.currentTarget, Math.min(index + 1, reachable.length - 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        focusNodeAt(e.currentTarget, Math.max(index - 1, 0));
        return;
      case "Home":
        e.preventDefault();
        focusNodeAt(e.currentTarget, 0);
        return;
      case "End":
        e.preventDefault();
        focusNodeAt(e.currentTarget, reachable.length - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        // On the detail there is nothing to open: it owns nothing, which is
        // why it carries no `aria-expanded` either.
        if (!node.isDetail) {
          setExpanded((cur) => withKey(cur, node.row.key, true));
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (node.isDetail) {
          // A child node collapses by returning to its parent, which is the
          // node immediately before it in rendered order.
          focusNodeAt(e.currentTarget, Math.max(index - 1, 0));
          return;
        }
        // COLLAPSE ONLY. Selection belongs to Enter, and the rail reads that
        // same `selected` state — an arrow key that deselected here would
        // clear the highlight on the picture as a side effect of closing a
        // row.
        setExpanded((cur) => withKey(cur, node.row.key, false));
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!node.isDetail) activate(node.row);
        return;
      default:
        return;
    }
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
            aria-controls={groupDomId(tier)}
            onClick={() => toggleGroup(tier)}
          >
            {TIER_LABEL[tier]} ({byTier[tier].length})
          </button>
        ))}
      </div>
      {/* A TREE, and now a well-formed one. `role="option"` supports
       *  `aria-selected` and not `aria-expanded`, and these rows do both —
       *  but `treeitem` only permits `aria-expanded` on a node that OWNS an
       *  expandable group, so each row owns one and the detail is what is
       *  inside it. The tier groups sit directly under the tree as SIBLING
       *  groupings, not as parent nodes, so every row is explicitly
       *  `aria-level={1}` rather than inheriting the level-2 a group
       *  ancestor would otherwise imply, with no level 1 anywhere above it.
       *  The `role="presentation"` wrapper is still what re-parents the rows
       *  onto their tier group instead of onto an intervening `<ul>`. */}
      <ul className={styles.rows} role="tree" aria-label="Memory map rows">
        {TIERS.map((tier) => (
          // The group stays MOUNTED regardless of `open[tier]` — only its
          // rows are conditional. A toggle button's `aria-controls` names
          // this element's `id`; unmounting the group along with its rows
          // left that id resolving to nothing the instant a tier collapsed.
          // Collapsing removes rows from the tree, never the group.
          <li
            key={tier}
            id={groupDomId(tier)}
            role="group"
            data-tier-group={tier}
            aria-label={`${TIER_LABEL[tier]} (${byTier[tier].length})`}
          >
            {open[tier] && (
              <ul className={styles.groupRows} role="presentation">
                {byTier[tier].map((row) => {
                  const showDetail = showDetailOf(row);
                  const rowNode: TreeNode = {
                    key: row.key,
                    row,
                    isDetail: false,
                  };
                  const detailNode: TreeNode = {
                    key: detailKeyOf(row),
                    row,
                    isDetail: true,
                  };
                  return (
                    <li
                      key={row.key}
                      className={styles.row}
                      role="treeitem"
                      data-row=""
                      aria-level={1}
                      aria-selected={row.selected}
                      aria-expanded={showDetail}
                      aria-disabled={row.inert || undefined}
                      aria-label={row.accessibleName}
                      data-selected={row.selected || undefined}
                      // ONE tab stop for the whole table. Every other node is
                      // an explicit -1, never a missing attribute: an <li>
                      // with no tabindex is not focusable at all, so the
                      // arrows would have nowhere to put the focus.
                      tabIndex={row.key === activeKey ? 0 : -1}
                      onClick={(e) => {
                        // A click focuses the row it lands on, so the tab
                        // stop follows it; leaving the stop behind means Tab
                        // and Shift+Tab return to a row nobody chose.
                        e.currentTarget.focus();
                        activate(row);
                      }}
                      onKeyDown={(e) => onNodeKeyDown(rowNode, e)}
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
                      {showDetail && (
                        <RowDetail
                          row={row}
                          tabIndex={detailNode.key === activeKey ? 0 : -1}
                          onKeyDown={(e) => onNodeKeyDown(detailNode, e)}
                        />
                      )}
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
