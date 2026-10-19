// SPDX-License-Identifier: Apache-2.0
//
// The region cards' view: a waffle of squares per resolved region, drawn in
// the placed lane under the region's own cell (layout and fill rules in
// stripCards.ts). Decorative for assistive tech, like the callouts: the
// region's cell button above carries the accessible name, the roving tab
// stop and the key handling, so a card is one more place to CLICK the same
// selection, and shows it. READ-ONLY like the rest of the feature.

import { Icon } from "../../shared/ui";
import { CARD_ROW_GAP_PX, type RegionCard } from "./stripCards";
import { CELL_PITCH_PX, CELL_ROWS } from "./slotUsage";
import styles from "./MemoryStrip.module.css";

/** Lane height needed for slot cards (row 0) plus `rows` rows of cards. */
export function cardLaneHeight(
  cards: readonly RegionCard[],
  cardHeight: number,
): number {
  const rows = Math.max(1, ...cards.map((c) => c.row + 1));
  return rows * cardHeight + (rows - 1) * CARD_ROW_GAP_PX;
}

export function RegionCards({
  cards,
  cardHeight,
  selected,
  onPick,
}: {
  cards: readonly RegionCard[];
  cardHeight: number;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <>
      {cards.map((c, i) => (
        <div
          key={`${c.id}:${i}`}
          className={styles.regionCard}
          data-region-card={c.name}
          data-kind={c.kind}
          data-tier={c.tier ?? undefined}
          data-selected={c.selectable && c.id === selected ? "" : undefined}
          data-keep-selection=""
          data-pickable={c.selectable || undefined}
          aria-hidden="true"
          title={c.title}
          style={{
            left: c.left,
            width: c.width,
            top: c.row * (cardHeight + CARD_ROW_GAP_PX),
          }}
          onClick={c.selectable ? () => onPick(c.id) : undefined}
        >
          <span className={styles.cardHeading}>
            {c.padlock && (
              <Icon name="lock" size={10} className={styles.lockIcon} />
            )}
            {c.heading}
          </span>
          {c.subtitle && (
            <span className={styles.cardSubtitle}>{c.subtitle}</span>
          )}
          <span
            className={styles.waffle}
            data-kind={c.kind}
            data-filled={c.filled}
            style={{
              width: c.cols * CELL_PITCH_PX,
              height: CELL_ROWS * CELL_PITCH_PX,
            }}
          />
        </div>
      ))}
    </>
  );
}
