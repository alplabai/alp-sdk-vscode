// SPDX-License-Identifier: Apache-2.0
//
// The address-space half of the system manifest (#484).
//
// WHAT THIS DELIBERATELY DOES NOT DRAW. The SoM's own region table —
// mcuboot / slot0 / reserved / storage / the Secure-Enclave ATOC band — is not
// in `system-manifest-v1`, so none of it is here. Drawing a backdrop this
// extension cannot read would mean parsing `metadata/e1m_modules/<SKU>.yaml`
// from TypeScript, which the manifest's own description forbids, and an
// editable affordance over a map that cannot tell `storage` from `atoc` is a
// live hazard: writing the ATOC can leave the part unbootable. alp-sdk#1365 is
// the request for the missing half; until it lands this view is read-only and
// shows only what the manifest itself pins.

import { useState } from "react";
import type { MemorySpan, MemoryView, SliceSize } from "../../types";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryRegions.module.css";

/** Where a span's end lies, or null when the manifest pinned no size. */
function endOf(span: MemorySpan): number | null {
  if (span.base === null || span.sizeBytes === null) return null;
  return span.base + span.sizeBytes;
}

const KIND_LABEL: Record<MemorySpan["kind"], string> = {
  slot_image: "image slot",
  carve_out: "carve-out",
  partition: "partition",
};

/**
 * The window the map covers: from the lowest pinned base to the highest pinned
 * end. Null when fewer than two distinct addresses are known — one point is
 * not a range, and a ruler drawn across nothing invites the reader to measure
 * distances that were never measured.
 */
function windowOf(spans: MemorySpan[]): { lo: number; hi: number } | null {
  const bases = spans.map((s) => s.base).filter((b): b is number => b !== null);
  if (bases.length === 0) return null;
  const ends = spans
    .map((s) => endOf(s) ?? s.base)
    .filter((e): e is number => e !== null);
  const lo = Math.min(...bases);
  const hi = Math.max(...ends);
  return hi > lo ? { lo, hi } : null;
}

/**
 * Vertical breathing room inside the rail, in px.
 *
 * Not decoration: the highest and lowest extents land exactly ON the window's
 * ends, and a hairline drawn at y=0 or y=height has half its label outside a
 * rail that clips. The window is mapped into the inset instead, which moves
 * every mark by the same amount and so states the same distances.
 */
const PAD = 12;

/** One band or hairline on the ruler. */
function Band({
  span,
  window: win,
  height,
  equalized,
  index,
  count,
  selected,
  onSelect,
}: {
  span: MemorySpan;
  window: { lo: number; hi: number };
  height: number;
  equalized: boolean;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  if (span.base === null) return null;
  const size = span.sizeBytes;
  const span_ = win.hi - win.lo;
  const usable = height - 2 * PAD;
  // Equalized gives every entry the same slice of the rail, lowest address at
  // the bottom — the same order as the true scale, so switching modes never
  // flips the picture upside down.
  const rowHeight = usable / count;
  const top = equalized
    ? PAD + (count - 1 - index) * rowHeight
    : PAD + ((win.hi - (endOf(span) ?? span.base)) / span_) * usable;
  const bandHeight = equalized
    ? rowHeight
    : size === null
      ? 0
      : (size / span_) * usable;
  return (
    <button
      type="button"
      className={size === null ? styles.marker : styles.band}
      data-kind={span.kind}
      data-selected={selected || undefined}
      style={{
        top: `${top}px`,
        height: size === null && !equalized ? undefined : `${bandHeight}px`,
      }}
      onClick={onSelect}
      title={`${span.label} — ${formatAddress(span.base)}`}
    >
      <span className={styles.bandLabel}>{span.label}</span>
    </button>
  );
}

/** The ruler: every extent the manifest pins, to scale unless told otherwise. */
function Ruler({
  spans,
  equalized,
  selected,
  onSelect,
}: {
  spans: MemorySpan[];
  equalized: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const win = windowOf(spans);
  if (!win) return null;
  const height = 260;
  const placed = spans.filter((s) => s.base !== null);
  return (
    <div className={styles.ruler} style={{ height: `${height}px` }}>
      {/* Two labels, and they sit at the inset ends the marks are mapped into,
       *  not at the rail's own edges — an axis that names an address a pixel
       *  away from the mark it belongs to is worse than no axis. */}
      <div className={styles.axis}>
        <span className={styles.axisEnd} style={{ top: `${PAD}px` }}>
          {formatAddress(win.hi)}
        </span>
        <span className={styles.axisEnd} style={{ top: `${height - PAD}px` }}>
          {formatAddress(win.lo)}
        </span>
      </div>
      <div className={styles.rail}>
        {placed.map((span, i) => (
          <Band
            key={span.id}
            span={span}
            window={win}
            height={height}
            equalized={equalized}
            index={i}
            count={placed.length}
            selected={selected === span.id}
            onSelect={() => onSelect(span.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** One placed extent, with everything the manifest said about it. */
function SpanRow({
  span,
  budget,
  selected,
  onSelect,
}: {
  span: MemorySpan;
  budget: SliceSize | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const end = endOf(span);
  return (
    <li
      className={styles.row}
      data-selected={selected || undefined}
      onClick={onSelect}
    >
      <span className={styles.rowName}>{span.label}</span>
      <span className={styles.kind} data-kind={span.kind}>
        {KIND_LABEL[span.kind]}
      </span>
      <code className={styles.addr}>
        {span.base !== null
          ? end !== null
            ? `${formatAddress(span.base)} – ${formatAddress(end)}`
            : formatAddress(span.base)
          : span.deviceOffset !== null
            ? `+${formatBytes(span.deviceOffset)} in ${span.device ?? "?"}`
            : "—"}
      </code>
      <span className={styles.rowSize}>
        {span.sizeBytes !== null
          ? formatBytes(span.sizeBytes)
          : "size not in the manifest"}
      </span>
      <span className={styles.rowMeta}>
        {span.region && <span>region {span.region}</span>}
        {span.fs && <span>fs {span.fs}</span>}
        {span.cores.length > 0 && <span>{span.cores.join(" ↔ ")}</span>}
        {/* The slot's capacity comes from `tan size`, not from the manifest,
         *  so it is named as a separate measurement rather than folded into
         *  the extent above — the map places only what the manifest pins. */}
        {budget?.flash.total !== null && budget?.flash.total !== undefined && (
          <span>slot budget {formatBytes(budget.flash.total)} · tan size</span>
        )}
      </span>
    </li>
  );
}

export function MemoryRegions({
  memory,
  sizes,
}: {
  memory: MemoryView | null;
  sizes: SliceSize[];
}) {
  const [equalized, setEqualized] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  if (!memory) return null;
  const budgetByCore = new Map(sizes.map((s) => [s.core_id, s]));
  const placed = memory.spans.filter((s) => s.base !== null);
  const deviceRelative = memory.spans.filter((s) => s.base === null);
  const drawable = windowOf(placed) !== null;

  return (
    <div className={styles.root}>
      <p className={styles.gap}>
        Only what the manifest pins. The SoM&rsquo;s own region table —
        bootloader, image slots and the Secure-Enclave band — is not part of{" "}
        <code>system-manifest-v1</code>, so it is not drawn here and nothing on
        this screen is editable (alp-sdk#1365).
      </p>

      {placed.length === 0 && deviceRelative.length === 0 ? (
        <p className={styles.empty}>
          This manifest pins no address. Every declared carve-out and partition
          is listed below with the reason it did not resolve.
        </p>
      ) : (
        <div className={styles.map}>
          {drawable && (
            <div className={styles.mapSide}>
              <div className={styles.scaleRow}>
                <button
                  type="button"
                  className={styles.scaleBtn}
                  aria-pressed={!equalized}
                  onClick={() => setEqualized(false)}
                >
                  True scale
                </button>
                <button
                  type="button"
                  className={styles.scaleBtn}
                  aria-pressed={equalized}
                  onClick={() => setEqualized(true)}
                >
                  Equalized
                </button>
              </div>
              <Ruler
                spans={placed}
                equalized={equalized}
                selected={selected}
                onSelect={setSelected}
              />
              {equalized && (
                <p className={styles.notToScale}>
                  Not to scale — every entry given equal height.
                </p>
              )}
            </div>
          )}
          <ul className={styles.rows}>
            {[...placed, ...deviceRelative].map((span) => (
              <SpanRow
                key={span.id}
                span={span}
                budget={budgetByCore.get(span.label)}
                selected={selected === span.id}
                onSelect={() =>
                  setSelected((cur) => (cur === span.id ? null : span.id))
                }
              />
            ))}
          </ul>
        </div>
      )}

      {memory.unresolved.length > 0 && (
        <div className={styles.unresolved}>
          <p className={styles.unresolvedTitle}>
            Declared, not placed ({memory.unresolved.length})
          </p>
          <ul className={styles.rows}>
            {memory.unresolved.map((entry) => (
              <li key={entry.id} className={styles.row}>
                <span className={styles.rowName}>{entry.label}</span>
                <span className={styles.kind} data-kind={entry.kind}>
                  {KIND_LABEL[entry.kind]}
                </span>
                <span className={styles.status} data-status={entry.status}>
                  {entry.status}
                </span>
                {entry.cores.length > 0 && (
                  <span className={styles.rowMeta}>
                    <span>{entry.cores.join(" ↔ ")}</span>
                  </span>
                )}
                {/* Verbatim and in full. The reason is the only actionable
                 *  half — it names the file and the field to change. */}
                <span className={styles.reason}>
                  {entry.reason ?? "(no reason given)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
