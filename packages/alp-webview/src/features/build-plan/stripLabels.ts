// SPDX-License-Identifier: Apache-2.0
//
// How a region cell names itself. A cell is as wide as its extent on the log
// scale allows — as little as 18px for a 32 KiB region beside a 2.6 MiB one —
// so the name does not always fit. Three outcomes, never a blank cell:
//
//   full     the whole name, inside the cell
//   ellipsis the name cut to what fits, with an ellipsis, inside the cell
//   callout  too narrow for even a stub: the whole name printed UNDER the
//            cell, on the first callout row where it clears its neighbours
//
// Widths are the monospace glyph metric the axis labels already use
// (`TICK_GLYPH_PX`), not a DOM measurement, so the same arithmetic runs in a
// test and a browser. Pure; READ-ONLY like the rest of the feature.

/** Width of one monospace glyph at the panel's reading size. */
export const GLYPH_PX = 7.8;

/** Border (1px) + padding (`--space-3`, 6px) on each side, both sides summed. */
export const CELL_PAD_PX = 14;

/** The lock mark: 10px icon + its 4px trailing margin, rounded up. */
export const LOCK_PX = 16;

/** The fewest characters (ellipsis included) worth printing inside a cell;
 *  below this a stub like `m…` says less than the full name under the cell. */
export const ELLIPSIS_MIN_CHARS = 4;

/** Clearance two callouts on the same row keep. */
export const CALLOUT_GAP_PX = 8;

export type LabelMode = "full" | "ellipsis" | "callout";

export interface CellLabel {
  mode: LabelMode;
  /** What is printed: the name, its cut form, or the name again (callout). */
  text: string;
  /** Horizontal extent of the printed text (lock mark included), in strip
   *  pixels. For a callout, set by `placeCallouts`; 0 until then. */
  x0: number;
  x1: number;
  /** Callout row (0 = nearest the cells); always 0 for an in-cell label. */
  row: number;
}

const textPx = (chars: number, locked: boolean): number =>
  chars * GLYPH_PX + (locked ? LOCK_PX : 0);

/** The label for a cell at `left` of `width` px. */
export function cellLabelOf(
  name: string,
  left: number,
  width: number,
  locked: boolean,
): CellLabel {
  const room = width - CELL_PAD_PX - (locked ? LOCK_PX : 0);
  const fits = Math.floor(room / GLYPH_PX);
  const x0 = left + CELL_PAD_PX / 2;
  if (name.length <= fits) {
    return {
      mode: "full",
      text: name,
      x0,
      x1: x0 + textPx(name.length, locked),
      row: 0,
    };
  }
  if (fits >= ELLIPSIS_MIN_CHARS) {
    return {
      mode: "ellipsis",
      text: `${name.slice(0, fits - 1)}…`,
      x0,
      x1: x0 + textPx(fits, locked),
      row: 0,
    };
  }
  return { mode: "callout", text: name, x0: 0, x1: 0, row: 0 };
}

/**
 * Fill in `x0`/`x1`/`row` of every callout label: centred under its cell,
 * clamped inside the strip, on the first row where it clears every callout
 * already there. Rows are unbounded — a callout is never dropped, because a
 * dropped one is a blank cell again. Mutates nothing; returns new labels.
 */
export function placeCallouts(
  cells: ReadonlyArray<{
    label: CellLabel;
    left: number;
    width: number;
    locked: boolean;
  }>,
  stripWidth: number,
): CellLabel[] {
  const rows: Array<Array<[number, number]>> = [];
  const ordered = cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.label.mode === "callout")
    .sort((a, b) => a.c.left - b.c.left);
  const placed = new Map<number, CellLabel>();
  for (const { c, i } of ordered) {
    const w = textPx(c.label.text.length, c.locked);
    const centre = c.left + c.width / 2;
    const x0 = Math.min(
      Math.max(centre - w / 2, 0),
      Math.max(stripWidth - w, 0),
    );
    const x1 = x0 + w;
    let row = rows.findIndex((taken) =>
      taken.every(
        ([a, b]) => x1 + CALLOUT_GAP_PX <= a || x0 >= b + CALLOUT_GAP_PX,
      ),
    );
    if (row < 0) {
      row = rows.length;
      rows.push([]);
    }
    rows[row].push([x0, x1]);
    placed.set(i, { ...c.label, x0, x1, row });
  }
  return cells.map((c, i) => placed.get(i) ?? c.label);
}
