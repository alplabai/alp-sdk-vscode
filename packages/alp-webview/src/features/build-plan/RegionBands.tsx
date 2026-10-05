// SPDX-License-Identifier: Apache-2.0
//
// The SoM's own region table drawn ON the rail (#484): one labelled
// background band per resolved region, behind the placed spans.
//
// Until this file the regions reached the picture only as a 6-unit,
// unlabelled, click-through tier swatch in the gutter left of the rail, and
// a fixture whose spans were few (rpmsg-aen) rendered as an empty grey box
// with two hairlines. Now each region is a band inside the rail, tinted by
// its authority tier (yours / locked / not proven — the same three-tier
// vocabulary as `AuthoritySwatch`: solid tint / half tint / hatch), named
// when the band is tall enough, and clickable: a click selects the region's
// own table row through the same `onSelect` path a row click uses.
//
// READ-ONLY, same as the rest of the feature: a click selects, nothing
// here writes.

import type { MemoryRegion } from "../../types";
import { tierOf } from "./authorityTier";
import { formatBytes, formatRange } from "./format";
import styles from "./MemoryChart.module.css";
import type { ResolvedRegion } from "./regionWindow";

/** Each band is inset this many units on every side, so two adjacent
 *  same-tier regions read as two bands, never one merged block. */
const BAND_INSET = 1;

/** A label's vertical room at the panel's reading size (13px) — the same
 *  fitted figure as MemoryChart.tsx's TICK_LABEL_H, for the same reason. */
const LABEL_H = 14;

/** A band shorter than this carries no label: the name would overflow the
 *  band it belongs to. The table names every region regardless. */
const MIN_LABELLED_BAND = LABEL_H + 4;

/** Baseline offset above a band's bottom edge: clears a descender. */
const LABEL_BOTTOM_DY = -4;

/** The region's hover title: `name · range · size`, all exact. */
export function regionTitle(
  region: MemoryRegion,
  lo: number,
  hi: number,
): string {
  return `${region.name} · ${formatRange(lo, hi)} · ${formatBytes(hi - lo)}`;
}

/** Baseline offset below a band's top edge: clears a capital's ascent. */
const LABEL_TOP_DY = 15;

/**
 * Where a region's label baseline goes, or null when it must be omitted.
 * Right-aligned (span labels sit left), tried bottom-first then top, and
 * only where the band is tall enough AND no label baseline already drawn
 * sits within one label height — a label is omitted, never overprinted.
 */
export function regionLabelY(
  top: number,
  height: number,
  occupiedBaselines: readonly number[],
): number | null {
  if (height < MIN_LABELLED_BAND) return null;
  const candidates = [top + height + LABEL_BOTTOM_DY, top + LABEL_TOP_DY];
  return (
    candidates.find((y) =>
      occupiedBaselines.every((b) => Math.abs(b - y) >= LABEL_H),
    ) ?? null
  );
}

export function RegionBands({
  regions,
  yOf,
  x,
  width,
  selectedRegionName,
  duplicated,
  spanLabelBaselines,
  onSelect,
}: {
  regions: ResolvedRegion[];
  yOf: (address: number) => number;
  x: number;
  width: number;
  /** Already null for a duplicated name — see MemoryChart.tsx. */
  selectedRegionName: string | null;
  /** Names shared by two or more rows: drawn, never selectable. */
  duplicated: ReadonlySet<string>;
  /** Baselines of every span/marker label the rail draws, so a region
   *  label never lands on one. */
  spanLabelBaselines: readonly number[];
  onSelect: (id: string) => void;
}) {
  const placedLabels: number[] = [...spanLabelBaselines];
  return (
    <g data-layer="regions">
      {regions.map(({ region, lo, hi }, index) => {
        const top = yOf(hi);
        const fullHeight = yOf(lo) - top;
        const height = Math.max(fullHeight - 2 * BAND_INSET, 1);
        const isSelectable = !duplicated.has(region.name);
        const labelY = regionLabelY(top, fullHeight, placedLabels);
        if (labelY !== null) placedLabels.push(labelY);
        return (
          <g
            key={`region-${index}-${region.id}-${lo}`}
            className={isSelectable ? styles.hit : undefined}
            data-region={region.name}
            onClick={isSelectable ? () => onSelect(region.id) : undefined}
          >
            <title>{regionTitle(region, lo, hi)}</title>
            <rect
              className={styles.regionBand}
              data-tier={tierOf(region.authorityClass)}
              data-selected={
                (isSelectable && selectedRegionName === region.name) ||
                undefined
              }
              x={x + BAND_INSET}
              y={top + BAND_INSET}
              width={width - 2 * BAND_INSET}
              height={height}
            />
            {labelY !== null && (
              <text
                className={styles.regionLabel}
                x={x + width - 5}
                y={labelY}
                textAnchor="end"
              >
                {region.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
