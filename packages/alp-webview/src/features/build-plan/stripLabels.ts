// SPDX-License-Identifier: Apache-2.0
//
// How a region cell names itself. A cell is as wide as its extent on the log
// scale allows — as little as 18px for a 32 KiB region beside a 2.6 MiB one —
// so the name does not always fit. Three outcomes, never a blank cell:
//
//   full     the whole name, inside the cell
//   ellipsis the name cut to what fits, inside the cell — only when the cut
//            keeps most of it (see ELLIPSIS_MIN_*); "stora…" says less than
//            the whole word under the cell
//   callout  the whole name printed UNDER the cell, on the first callout row
//            where it clears its neighbours
//
// Callout rows are capped (CALLOUT_MAX_ROWS). Past the cap a cell is
// `overflow`: it prints nothing of its own, and one "+N more" marker row
// stands for all of them (the cells stay selectable buttons).
//
// Widths come from the font size, not a DOM measurement of each label, so the
// same arithmetic runs in a test and a browser at any `--vscode-font-size`.
// Pure; READ-ONLY like the rest of the feature.

/** What the panel's base font is, absent a measurement. */
export const DEFAULT_FONT_PX = 13;

/** Monospace glyph width as a fraction of the font size (7.8px at 13px). */
const GLYPH_EM = 0.6;

export interface StripMetrics {
  fontPx: number;
  /** Width of one monospace glyph. */
  glyph: number;
  /** Pitch of one axis-label row (the tick label line box plus air). */
  axisRow: number;
  /** Pitch of one callout row. */
  calloutRow: number;
}

/** Every font-dependent length the strip lays labels out with. */
export function metricsOf(fontPx: number = DEFAULT_FONT_PX): StripMetrics {
  const px = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : DEFAULT_FONT_PX;
  return {
    fontPx: px,
    glyph: px * GLYPH_EM,
    axisRow: Math.round(px * 1.2),
    calloutRow: Math.round(px * 1.4),
  };
}

/** Border (1px) + padding (`--space-3`, 6px) on each side, both sides summed. */
export const CELL_PAD_PX = 14;

/** The lock mark: 10px icon + its 4px trailing margin, rounded up. */
export const LOCK_PX = 16;

/** An ellipsized name must keep at least this many characters (the ellipsis
 *  not counted) and at least this share of the name. */
export const ELLIPSIS_MIN_KEPT = 5;
export const ELLIPSIS_MIN_SHARE = 0.7;

/** Clearance two callouts on the same row keep. */
export const CALLOUT_GAP_PX = 8;

/** Callout rows before the "+N more" marker takes over. */
export const CALLOUT_MAX_ROWS = 3;

export type LabelMode = "full" | "ellipsis" | "callout" | "overflow";

export interface CellLabel {
  mode: LabelMode;
  /** What is printed: the name, its cut form, or the name again (callout). */
  text: string;
  /** Horizontal extent of the printed text (lock mark included), in strip
   *  pixels. Zero for `overflow`, which prints nothing of its own. */
  x0: number;
  x1: number;
  /** Callout row (0 = nearest the cells); always 0 for an in-cell label. */
  row: number;
}

const textPx = (chars: number, locked: boolean, glyph: number): number =>
  chars * glyph + (locked ? LOCK_PX : 0);

/** The label a cell would print inside itself, or a callout if it cannot. */
export function cellLabelOf(
  name: string,
  left: number,
  width: number,
  locked: boolean,
  glyph: number,
): CellLabel {
  const room = width - CELL_PAD_PX - (locked ? LOCK_PX : 0);
  const fits = Math.floor(room / glyph);
  const x0 = left + CELL_PAD_PX / 2;
  if (name.length <= fits) {
    return {
      mode: "full",
      text: name,
      x0,
      x1: x0 + textPx(name.length, locked, glyph),
      row: 0,
    };
  }
  const kept = fits - 1;
  if (kept >= ELLIPSIS_MIN_KEPT && kept >= ELLIPSIS_MIN_SHARE * name.length) {
    return {
      mode: "ellipsis",
      text: `${name.slice(0, kept)}…`,
      x0,
      x1: x0 + textPx(fits, locked, glyph),
      row: 0,
    };
  }
  return { mode: "callout", text: name, x0: 0, x1: 0, row: 0 };
}

export interface CellDraft {
  name: string;
  left: number;
  width: number;
  locked: boolean;
}

/**
 * Every cell's label. In-cell labels are checked against each other left to
 * right: cells that overlap (equal extents, or a partial overlap) would print
 * through one another, so the later one becomes a callout. Callouts are then
 * centred under their cell, clamped inside the strip, on the first row where
 * they clear the callouts already there; one that fits no row within the cap
 * is `overflow`. Mutates nothing; returns one label per draft, in order.
 */
export function layoutCellLabels(
  cells: readonly CellDraft[],
  stripWidth: number,
  glyph: number,
): CellLabel[] {
  const labels = cells.map((c) =>
    cellLabelOf(c.name, c.left, c.width, c.locked, glyph),
  );
  const byLeft = cells
    .map((_, i) => i)
    .sort((a, b) => cells[a].left - cells[b].left);
  const kept: CellLabel[] = [];
  for (const i of byLeft) {
    const l = labels[i];
    if (l.mode === "callout") continue;
    if (kept.some((k) => l.x0 < k.x1 && k.x0 < l.x1)) {
      labels[i] = {
        mode: "callout",
        text: cells[i].name,
        x0: 0,
        x1: 0,
        row: 0,
      };
    } else {
      kept.push(l);
    }
  }
  const rows: Array<Array<[number, number]>> = [];
  for (const i of byLeft) {
    if (labels[i].mode !== "callout") continue;
    const c = cells[i];
    const w = textPx(c.name.length, c.locked, glyph);
    const centre = c.left + c.width / 2;
    const x0 = Math.min(
      Math.max(centre - w / 2, 0),
      Math.max(stripWidth - w, 0),
    );
    const x1 = x0 + w;
    const row = rows.findIndex((taken) =>
      taken.every(
        ([a, b]) => x1 + CALLOUT_GAP_PX <= a || x0 >= b + CALLOUT_GAP_PX,
      ),
    );
    const at = row >= 0 ? row : rows.length;
    if (at >= CALLOUT_MAX_ROWS) {
      labels[i] = {
        mode: "overflow",
        text: c.name,
        x0: 0,
        x1: 0,
        row: CALLOUT_MAX_ROWS,
      };
      continue;
    }
    if (row < 0) rows.push([]);
    rows[at].push([x0, x1]);
    labels[i] = { mode: "callout", text: c.name, x0, x1, row: at };
  }
  return labels;
}

/** The "+N more" marker standing for every `overflow` cell. */
export interface OverflowMarker {
  /** `+4 more: part_26, part_27, …` — cut to the strip by CSS ellipsis. */
  label: string;
  ids: string[];
  names: string[];
}

export function overflowMarker(
  cells: ReadonlyArray<{ id: string; name: string; label: CellLabel }>,
): OverflowMarker | null {
  const over = cells.filter((c) => c.label.mode === "overflow");
  if (over.length === 0) return null;
  const names = over.map((c) => c.name);
  return {
    label: `+${over.length} more: ${names.join(", ")}`,
    ids: over.map((c) => c.id),
    names,
  };
}
