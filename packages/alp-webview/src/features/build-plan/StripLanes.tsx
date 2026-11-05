// SPDX-License-Identifier: Apache-2.0
//
// The memory strip's smaller lanes, split out of MemoryStrip.tsx: the parent
// bars of container regions, the callouts that name cells too narrow to name
// themselves, and the address axis. Each is a pure function of the layout
// model (stripLayout.ts) — no state, no writes, READ-ONLY like the rest of
// the feature (`test/memoryRegions.readOnly.test.js` covers this file too).

import { Icon } from "../../shared/ui";
import { CALLOUT_MAX_ROWS } from "./stripLabels";
import type { StripModel } from "./stripLayout";
import styles from "./MemoryStrip.module.css";

/** What the padlock means. It is the host's target-lock verdict, NOT the
 *  write-authority tier the legend's other entries describe. */
export const LOCK_TITLE =
  "Not an edit target: no IPC carve-out or storage partition can be placed here (separate from write authority)";

/** The padlock with a real tooltip: `Icon` is `aria-hidden` and takes no
 *  `<title>`, so the hover text lives on a wrapping span. */
export function LockMark() {
  return (
    <span className={styles.lockMark} title={LOCK_TITLE}>
      <Icon name="lock" size={10} className={styles.lockIcon} />
    </span>
  );
}

type ItemProps = (id: string, label: string) => Record<string, unknown>;

/** One lane per bar row, outermost first. */
export function ParentLanes({
  parents,
  nameOf,
  itemProps,
}: {
  parents: StripModel["parents"];
  nameOf: (id: string) => string | undefined;
  itemProps: ItemProps;
}) {
  const rows = [...new Set(parents.map((p) => p.row))].sort((a, b) => a - b);
  return (
    <>
      {rows.map((row) => {
        const inRow = parents.filter((p) => p.row === row);
        return (
          <div
            key={row}
            className={styles.parentLane}
            data-lane="containers"
            data-row={row}
            role="group"
            aria-label={`Containing regions: ${inRow.map((p) => p.name).join(", ")}`}
          >
            {inRow.map((p, i) => (
              <button
                key={`${p.id}:${i}`}
                className={styles.parent}
                data-tier={p.tier ?? undefined}
                title={p.title}
                style={{ left: p.left, width: p.width }}
                {...(p.selectable
                  ? itemProps(p.id, nameOf(p.id) ?? p.title)
                  : {
                      type: "button" as const,
                      "aria-label": nameOf(p.id) ?? p.title,
                      "aria-disabled": true,
                      tabIndex: -1,
                    })}
              >
                {p.label}
                {p.locked && <LockMark />}
                {p.tier && (
                  <span className={styles.tierMark} data-tier={p.tier} />
                )}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Rows of callouts a model needs, the "+N more" row included. */
export function calloutRowCount(model: StripModel): number {
  const rows = model.regions
    .filter((r) => r.label.mode === "callout")
    .map((r) => r.label.row + 1);
  const used = Math.max(0, ...rows);
  return model.overflow ? Math.min(used, CALLOUT_MAX_ROWS) + 1 : used;
}

/** Names of the cells that cannot name themselves. Decorative for assistive
 *  tech — each cell button above carries its own accessible name — but a
 *  click on one selects its cell instead of clearing the selection. */
export function CalloutLane({
  model,
  onPick,
}: {
  model: StripModel;
  onPick: (id: string) => void;
}) {
  const rowCount = calloutRowCount(model);
  if (rowCount === 0) return null;
  const pitch = model.metrics.calloutRow;
  const overflowRow = rowCount - 1;
  return (
    <div
      className={styles.callouts}
      aria-hidden="true"
      style={{ height: rowCount * pitch }}
    >
      {model.regions
        .filter((r) => r.label.mode === "callout")
        .map((r, i) => (
          <span
            key={`${r.id}:${i}`}
            className={styles.callout}
            data-callout={r.name}
            data-keep-selection=""
            data-pickable={r.selectable || undefined}
            title={r.title}
            style={{ left: r.label.x0, top: r.label.row * pitch }}
            onClick={r.selectable ? () => onPick(r.id) : undefined}
          >
            {r.locked && <LockMark />}
            {r.label.text}
          </span>
        ))}
      {model.overflow && (
        <span
          className={styles.callout}
          data-callout-overflow=""
          data-keep-selection=""
          data-pickable=""
          title={model.overflow.names.join(", ")}
          style={{ left: 0, right: 0, top: overflowRow * pitch }}
          onClick={() => onPick(model.overflow!.ids[0])}
        >
          {model.overflow.label}
        </span>
      )}
    </div>
  );
}

/** Pixel height of the axis lane: the tick line, then one row per label row. */
export function axisHeight(model: StripModel): number {
  const rows = Math.max(1, ...model.ticks.map((t) => (t.row ?? 0) + 1));
  return 8 + rows * model.metrics.axisRow + 2;
}

export function AxisTicks({ model }: { model: StripModel }) {
  return (
    <div
      className={styles.ticks}
      aria-hidden="true"
      style={{ height: axisHeight(model) }}
    >
      {model.ticks.map((t) => (
        // `data-address` names the declared edge each tick stands on, so a
        // test can prove every declared address reached the strip without
        // reading pixel positions back.
        <span key={t.address} data-address={t.address}>
          <span className={styles.tick} style={{ left: t.lineX }} />
          {t.labelled && (
            <span
              className={styles.tickLabel}
              data-edge={t.isEnd ? "end" : undefined}
              title={
                t.isEnd
                  ? "Last byte of the window (inclusive); every other label is the first byte of the segment starting there"
                  : undefined
              }
              style={{
                left: t.x0,
                top: 8 + (t.row ?? 0) * model.metrics.axisRow,
              }}
            >
              {t.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
