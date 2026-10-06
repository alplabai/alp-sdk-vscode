// SPDX-License-Identifier: Apache-2.0
//
// How much of a firmware slot an image actually occupies — pure arithmetic, no
// React and no CSS, shared by the memory strip (which draws the used bytes as
// a slim fill along the slot) and the selected-item detail (which prints the
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
  /** Bytes the built image occupies, clamped to `total` when that is known;
   *  null when `tan size` reported nothing for this core. */
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
  const used =
    measured !== null && total !== null ? Math.min(measured, total) : measured;
  return { slotEnd, total, used };
}

/** `used / total` as a percentage with one decimal (`3.6`), or null when
 *  either side is unknown or the slot is empty. */
export function usedPercent(usage: SlotUsage): number | null {
  if (usage.used === null || usage.total === null || usage.total <= 0) {
    return null;
  }
  return Math.round((usage.used / usage.total) * 1000) / 10;
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
