// SPDX-License-Identifier: Apache-2.0
//
// How much of a firmware slot an image actually occupies — pure arithmetic, no
// React and no CSS, shared by the memory strip (which draws the used bytes as
// lit cells across the slot) and the selected-item detail (which prints the
// same figure), so the two can never report different footprints for one
// image.
//
// WHERE THE NUMBERS COME FROM. The slot's extent is the manifest's own pinned
// size when it has one, else the `tan size` budget (`flash.total`) — the same
// precedence the strip's slot box is drawn with (`budgetEnd`). The used bytes
// are `tan size`'s `flash.used`, matched to the span by core id (a slot
// image's label IS its core id). `null` means "not measured" and is never
// rendered as 0: a 0-byte image and an unbuilt one are different facts.

import type { MemorySpan, SliceSize } from "../../types";
import { budgetEnd, endOf } from "./regionWindow";

/** The thinnest a non-empty used fill is ever drawn, in CSS pixels, so a
 *  tiny image is still visible along a large slot. */
export const MIN_USED_PX = 3;

export interface SlotUsage {
  /** Exclusive end of the slot, or null when neither the manifest nor
   *  `tan size` says how much room it has. */
  slotEnd: number | null;
  /** Slot size in bytes (`slotEnd - base`), or null with `slotEnd`. */
  total: number | null;
  /** Bytes the built image occupies, exactly as `tan size` measured them —
   *  MAY exceed `total` when the manifest pins a slot smaller than the image.
   *  Never clamped here: the printed figure is a firmware fact, and an image
   *  that does not fit must read as not fitting. Only the drawing clamps
   *  (`usedFillLength`, `cellFill`). Null when `tan size` reported nothing. */
  used: number | null;
}

/** Usage of a placed slot image, or null for any other span kind or a span
 *  with no base — carve-outs and partitions have no `tan size` footprint. */
export function slotUsageOf(
  span: MemorySpan,
  budget: SliceSize | undefined,
): SlotUsage | null {
  if (span.kind !== "slot_image" || span.base === null) return null;
  const slotEnd = endOf(span) ?? budgetEnd(span, budget);
  const total = slotEnd !== null ? slotEnd - span.base : null;
  const reported = budget?.flash.used;
  const measured =
    typeof reported === "number" && reported >= 0 ? reported : null;
  return { slotEnd, total, used: measured };
}

/** `used / total` as a percentage with one decimal (`3.6`), or null when
 *  either side is unknown or the slot is empty. Above 100 when the image
 *  overflows its slot. */
export function usedPercent(usage: SlotUsage): number | null {
  if (usage.used === null || usage.total === null || usage.total <= 0) {
    return null;
  }
  return Math.round((usage.used / usage.total) * 1000) / 10;
}

/** True when the measured image is larger than the slot it is placed in. */
export function overflowsSlot(usage: SlotUsage): boolean {
  return (
    usage.used !== null && usage.total !== null && usage.used > usage.total
  );
}

/**
 * The used fill's length in CSS pixels: proportional to the slot's drawn
 * length, never below `MIN_USED_PX` for a non-empty image and never beyond
 * the slot itself. The caller passes the slot's drawn length, so this
 * inherits whatever scale the strip applied to it.
 */
export function usedFillLength(
  used: number,
  total: number,
  slotLength: number,
): number {
  if (used <= 0 || total <= 0 || slotLength <= 0) return 0;
  const proportional = (used / total) * slotLength;
  return Math.min(slotLength, Math.max(MIN_USED_PX, proportional));
}

/** One cell's pitch on the strip: a 7px square plus the 1px gap after it.
 *  The CSS mask that cuts the gaps (`.cells` in MemoryStrip.module.css)
 *  repeats at this same pitch; change one, change both. */
export const CELL_PITCH_PX = 8;

/** Cells stacked in one column of a slot's field. */
export const CELL_ROWS = 4;

/**
 * A slot drawn as a field of small cells, filled the way blocks settle in
 * Tetris: column by column from the slot's base (left), each column from the
 * bottom up. The quantisation is the point — "how full" reads at a glance
 * from the count of lit cells, where a 3.6% sliver of bar was invisible —
 * so the exact bytes stay in the text beside it, never in the cells.
 */
export interface CellFill {
  /** Columns the field holds at the slot's drawn width. */
  cols: number;
  /** Cells in the whole field (`cols * CELL_ROWS`). */
  total: number;
  /** Lit cells. Never 0 for a non-empty image, never more than `total`. */
  filled: number;
  /** Columns lit top to bottom. */
  fullCols: number;
  /** Cells lit in the next column, from the bottom. */
  partial: number;
  /** Bytes one cell stands for, rounded to a whole byte. */
  bytesPerCell: number;
}

/** The cell field for `used` of `total` bytes across `fieldWidth` pixels,
 *  or null when nothing was measured or the field cannot hold one column. */
export function cellFill(
  used: number | null,
  total: number | null,
  fieldWidth: number,
): CellFill | null {
  if (used === null || total === null || total <= 0) return null;
  const cols = Math.floor(fieldWidth / CELL_PITCH_PX);
  if (cols < 1) return null;
  const cells = cols * CELL_ROWS;
  const proportional = Math.round((used / total) * cells);
  const filled = used <= 0 ? 0 : Math.min(cells, Math.max(1, proportional));
  return {
    cols,
    total: cells,
    filled,
    fullCols: Math.floor(filled / CELL_ROWS),
    partial: filled % CELL_ROWS,
    bytesPerCell: Math.round(total / cells),
  };
}
