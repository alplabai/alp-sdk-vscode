// SPDX-License-Identifier: Apache-2.0
//
// Region cards: every resolved, non-container region drawn as a waffle card
// like a slot image's, in the placed lane under its own cell. What a card
// FILLS is a fact about what the manifest knows, never a guess:
//
//   locked   tier `locked` (vendor image, Secure Enclave): every square is
//            filled, in amber, with a padlock — nothing to fill, nothing
//            free. Colour is never the only cue: padlock + "locked" label.
//   empty    a customer region (or any region when the SoM declares no
//            authority): zero filled squares and "no usage data". Usage
//            exists only for image slots (`tan size`); a fake fill would be
//            a made-up number.
//   hatched  reserved / composite / unstated: the strip's "not yours or not
//            proven" hatch, squares and all.
//
// A region a slot image fills exactly is carded by that slot image (its own
// used/free cells) and gets no second card. A narrow region's card is widened
// to MIN_CARD_PX around its cell's centre; cards that would then touch share
// the lane by moving to the next row, packed like callouts — never overlapped,
// never dropped. Pure; READ-ONLY like the rest of the feature.

import type { MemoryRegion } from "../../types";
import { formatBytes } from "./format";
import type { AuthorityTier } from "./authorityTier";
import { CELL_PITCH_PX, CELL_ROWS } from "./slotUsage";

/** The cell field's inset from the card's edge on each side (`--space-4`). */
const CARD_INSET_PX = 8;

/** The narrowest card: wide enough for the padlock and the word "locked"
 *  (so even the narrowest locked region names itself on its card) and for 8
 *  columns of cells. */
export const MIN_CARD_PX = 80;

/** The same floor at a larger font: padlock + padding + the kept characters
 *  of a name and its ellipsis, in glyphs. */
function minCardPx(glyph: number): number {
  return Math.max(MIN_CARD_PX, Math.ceil(30 + (MIN_NAME_KEPT + 1) * glyph));
}

/** An ellipsized card name keeps at least this many characters. */
export const MIN_NAME_KEPT = 5;

/** Card padding + border, both sides, and the padlock's width. */
const CARD_PAD_PX = 14;
const CARD_LOCK_PX = 16;

/** A card's height, the slot cards' 84px (`.lane[data-lane="placed"]`), and
 *  the air between two card rows. */
export const CARD_HEIGHT_PX = 84;

/** The card height at `fontPx`: the 84px of the 13px panel, grown so two
 *  text lines (name, status) still clear the 4-row waffle beneath them. */
export function cardHeightPx(fontPx: number): number {
  const line = Math.round(fontPx * 1.25);
  return Math.max(CARD_HEIGHT_PX, 4 + 2 * line + 8 + 4 * 8 + 8);
}
export const CARD_ROW_GAP_PX = 8;

/** Clearance two cards in one row keep: none, like the slot cards. */
const CARD_GAP_PX = 0;

export type CardKind = "locked" | "empty" | "hatched";

export interface RegionCard {
  id: string;
  name: string;
  left: number;
  width: number;
  /** 0 is the slot cards' row; a card that cannot sit there moves down. */
  row: number;
  kind: CardKind;
  tier: AuthorityTier | null;
  /** Squares across and in all (`cols * CELL_ROWS`), and how many are lit:
   *  every one for `locked`, none for the others. */
  cols: number;
  total: number;
  filled: number;
  /** The padlock on the card: tier `locked` only. */
  padlock: boolean;
  /** `locked · 64 KiB · vendor image`, `no usage data · 96 KiB`, `reserved · 64 KiB`. */
  label: string;
  /** The first line: the region's name (as `.spanName` is a slot card's),
   *  whole, or ellipsized keeping at least MIN_NAME_KEPT characters, or ""
   *  at the floor — the padlock and squares stay then. */
  heading: string;
  /** The second line: `label` when it fits, else `short`, else "". */
  subtitle: string;
  title: string;
  selectable: boolean;
}

const OWNER: Record<string, string> = {
  vendor_image: "vendor image",
  secure_enclave: "Secure Enclave",
};

const UNPROVEN_WORD: Record<string, string> = {
  reserved: "reserved",
  composite: "composite",
  unstated: "authority not declared",
};

export interface CardInput {
  region: MemoryRegion;
  lo: number;
  hi: number;
  left: number;
  width: number;
  tier: AuthorityTier | null;
  selectable: boolean;
  title: string;
}

/** What a card for `region` wears, and its label. */
function fillOf(
  region: MemoryRegion,
  tier: AuthorityTier | null,
  size: string,
): { kind: CardKind; label: string; short: string; padlock: boolean } {
  if (tier === "locked") {
    const owner = OWNER[region.writeAuthority ?? ""];
    return {
      kind: "locked",
      label: `locked · ${size}${owner ? ` · ${owner}` : ""}`,
      short: "locked",
      padlock: true,
    };
  }
  if (tier === "unproven") {
    const word = UNPROVEN_WORD[region.authorityClass] ?? "not proven";
    return {
      kind: "hatched",
      label: `${word} · ${size}`,
      short: region.authorityClass === "unstated" ? "not proven" : word,
      padlock: false,
    };
  }
  return {
    kind: "empty",
    label: `no usage data · ${size}`,
    short: "no data",
    padlock: false,
  };
}

/**
 * The cards for `regions` (cells, containers already removed), in address
 * order. `occupied` are the slot cards' [x0, x1] extents in row 0, which a
 * card must not overlap; `slotExtents` are the regions' address extents that
 * a slot image fills exactly, and which therefore get no card of their own.
 */
export function layoutRegionCards(
  regions: readonly CardInput[],
  occupied: ReadonlyArray<[number, number]>,
  slotExtents: ReadonlyArray<[number, number]>,
  stripWidth: number,
  glyph: number,
): RegionCard[] {
  const carded = regions
    .filter((r) => !slotExtents.some(([lo, hi]) => lo === r.lo && hi === r.hi))
    .sort((a, b) => a.left - b.left);
  const rows: Array<Array<[number, number]>> = [[...occupied]];
  const out: RegionCard[] = [];
  for (const r of carded) {
    const width = Math.min(Math.max(r.width, minCardPx(glyph)), stripWidth);
    const centre = r.left + r.width / 2;
    const left = Math.min(
      Math.max(centre - width / 2, 0),
      Math.max(stripWidth - width, 0),
    );
    const right = left + width;
    let row = rows.findIndex((taken) =>
      taken.every(
        ([a, b]) => right + CARD_GAP_PX <= a || left >= b + CARD_GAP_PX,
      ),
    );
    if (row < 0) {
      row = rows.length;
      rows.push([]);
    }
    rows[row].push([left, right]);
    const size = formatBytes(r.hi - r.lo);
    const fill = fillOf(r.region, r.tier, size);
    const room = Math.floor(
      (width - CARD_PAD_PX - (fill.padlock ? CARD_LOCK_PX : 0)) / glyph,
    );
    const name = r.region.name;
    const heading =
      name.length <= room
        ? name
        : room - 1 >= MIN_NAME_KEPT
          ? `${name.slice(0, room - 1)}…`
          : "";
    const subtitle =
      heading !== name
        ? ""
        : fill.label.length <= room
          ? fill.label
          : fill.short.length <= room
            ? fill.short
            : "";
    const cols = Math.floor((width - 2 * CARD_INSET_PX) / CELL_PITCH_PX);
    const total = cols * CELL_ROWS;
    out.push({
      id: r.region.id,
      name: r.region.name,
      left,
      width,
      row,
      kind: fill.kind,
      tier: r.tier,
      cols,
      total,
      filled: fill.kind === "locked" ? total : 0,
      padlock: fill.padlock,
      label: fill.label,
      heading,
      subtitle,
      title: `${r.title} · ${fill.label}`,
      selectable: r.selectable,
    });
  }
  return out;
}
