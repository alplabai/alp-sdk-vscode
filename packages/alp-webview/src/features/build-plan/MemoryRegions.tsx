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
//
// READ-ONLY IS A GATE, NOT A HABIT: `test/memoryRegions.readOnly.test.js`
// fails if this file grows a write path.

import { useState } from "react";
import type {
  MemoryAperture,
  MemoryConflict,
  MemorySpan,
  MemoryView,
  SliceSize,
} from "../../types";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryRegions.module.css";

/** Height of the rails, px. */
const RAIL = 260;

/**
 * Vertical breathing room inside a rail, px.
 *
 * Not decoration: the highest and lowest extents land exactly ON the window's
 * ends, and a hairline drawn at y=0 or y=RAIL has half its label outside a rail
 * that clips. The window is mapped into the inset instead, which moves every
 * mark by the same amount and so states the same distances.
 */
const PAD = 12;

/**
 * Magnification of the detail rail, and so the fraction of the window it covers.
 *
 * Fixed, not fitted to the content. On the SoM this feature was designed
 * against, the band worth seeing — `reserved` + `storage` + the ATOC — is the
 * top 256 KiB of a 5632 KiB window, which is 1/22 of it; at true scale that
 * band is 12px of 260 and the ATOC inside it is 1.5px. A magnification that
 * chased the content would change under the reader between two builds, and a
 * ruler whose scale moves is a ruler you cannot compare against yesterday's.
 */
const DETAIL_FACTOR = 22;

interface Window {
  lo: number;
  hi: number;
}

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

const CONFLICT_TITLE: Record<MemoryConflict["kind"], string> = {
  overlap: "share addresses",
  covers_load_address: "covers an image load address",
  device_overlap: "overlap inside one flash device",
};

/**
 * How far a slot image reaches, per `tan size`.
 *
 * The manifest pins where an image LOADS and says nothing about how much room
 * it has; `tan size` resolves that budget from SoM metadata and reports it as
 * `flash.total`. Measured on E1M-AEN801: 2.63 MiB for both M55 slices, which
 * is 2688 KiB — byte-for-byte the `he_slot0` / `hp_slot0` region size. So the
 * budget IS the slot, and drawing it is the difference between a picture with
 * two hairlines on it and one that shows where the images actually sit.
 *
 * It is drawn DASHED and labelled, never as a solid manifest-pinned band: the
 * base comes from the manifest and the extent from a second tool, and a reader
 * has to be able to tell which number came from where.
 */
function budgetEnd(
  span: MemorySpan,
  budget: SliceSize | undefined,
): number | null {
  if (span.kind !== "slot_image" || span.base === null) return null;
  const total = budget?.flash.total;
  return typeof total === "number" && total > 0 ? span.base + total : null;
}

/**
 * The window the map covers: from the lowest pinned base to the highest end
 * anything reaches. Null when fewer than two distinct addresses are known — one
 * point is not a range, and a ruler drawn across nothing invites the reader to
 * measure distances that were never measured.
 */
function windowOf(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
): Window | null {
  const bases = spans.map((s) => s.base).filter((b): b is number => b !== null);
  if (bases.length === 0) return null;
  const ends = spans
    .flatMap((s) => [endOf(s) ?? s.base, budgetEnd(s, budgets.get(s.label))])
    .filter((e): e is number => e !== null);
  const lo = Math.min(...bases);
  const hi = Math.max(...ends);
  return hi > lo ? { lo, hi } : null;
}

/** Pixel offset of an address inside a rail drawn for `win`. */
const yOf = (addr: number, win: Window): number =>
  PAD + ((win.hi - addr) / (win.hi - win.lo)) * (RAIL - 2 * PAD);

/** The `tan size` budget for a slot, drawn behind its hairline. */
function BudgetBand({
  span,
  end,
  window: win,
}: {
  span: MemorySpan;
  end: number;
  window: Window;
}) {
  if (span.base === null) return null;
  const usable = RAIL - 2 * PAD;
  const top = yOf(end, win);
  const height = ((end - span.base) / (win.hi - win.lo)) * usable;
  return (
    <div
      className={styles.budgetBand}
      style={{ top: `${top}px`, height: `${height}px` }}
      title={`${span.label} — slot budget from tan size`}
    >
      <span className={styles.budgetLabel}>{span.label} budget</span>
    </div>
  );
}

/** One band or hairline on a rail. */
function Band({
  span,
  window: win,
  equalized,
  index,
  count,
  selected,
  onSelect,
}: {
  span: MemorySpan;
  window: Window;
  equalized: boolean;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  if (span.base === null) return null;
  const end = endOf(span);
  const usable = RAIL - 2 * PAD;
  const rowHeight = usable / count;
  // Equalized gives every entry the same slice of the rail, lowest address at
  // the bottom — the same order as the true scale, so switching modes never
  // flips the picture upside down.
  const top = equalized
    ? PAD + (count - 1 - index) * rowHeight
    : yOf(end ?? span.base, win);
  const height = equalized
    ? rowHeight
    : end === null
      ? 0
      : ((end - span.base) / (win.hi - win.lo)) * usable;
  return (
    <button
      type="button"
      className={end === null ? styles.marker : styles.band}
      data-kind={span.kind}
      data-selected={selected || undefined}
      style={{
        top: `${top}px`,
        height: end === null && !equalized ? undefined : `${height}px`,
      }}
      onClick={onSelect}
      title={`${span.label} — ${formatAddress(span.base)}`}
    >
      <span className={styles.bandLabel}>{span.label}</span>
    </button>
  );
}

/** One rail: the window, its bands, and a caption naming its scale. */
function Rail({
  spans,
  window: win,
  equalized,
  selected,
  onSelect,
  caption,
  budgets,
}: {
  spans: MemorySpan[];
  window: Window;
  equalized: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  caption: string;
  budgets: Map<string, SliceSize>;
}) {
  return (
    <div className={styles.railGroup}>
      <div className={styles.rail} style={{ height: `${RAIL}px` }}>
        {!equalized &&
          spans.map((span) => {
            const end = budgetEnd(span, budgets.get(span.label));
            return end === null ? null : (
              <BudgetBand
                key={`budget:${span.id}`}
                span={span}
                end={end}
                window={win}
              />
            );
          })}
        {spans.map((span, i) => (
          <Band
            key={span.id}
            span={span}
            window={win}
            equalized={equalized}
            index={i}
            count={spans.length}
            selected={selected === span.id}
            onSelect={() => onSelect(span.id)}
          />
        ))}
      </div>
      <span className={styles.railCaption}>{caption}</span>
    </div>
  );
}

/** Axis labels for a rail: the two addresses its ends actually are. */
function Axis({
  window: win,
  side,
}: {
  window: Window;
  side: "left" | "right";
}) {
  return (
    <div
      className={styles.axis}
      data-side={side}
      style={{ height: `${RAIL}px` }}
    >
      <span className={styles.axisEnd} style={{ top: `${PAD}px` }}>
        {formatAddress(win.hi)}
      </span>
      <span className={styles.axisEnd} style={{ top: `${RAIL - PAD}px` }}>
        {formatAddress(win.lo)}
      </span>
    </div>
  );
}

/**
 * One aperture as a rail beside the map — never as a band inside it.
 *
 * An aperture's own base and size are not in this contract; what is known is
 * which extents the resolver put inside it. So the rail spans the hull of its
 * members and says so: "at least this much of it is in use". A rail drawn to a
 * guessed extent would instead say how much is left, which nothing here knows.
 */
function ApertureRail({
  aperture,
  window: win,
}: {
  aperture: MemoryAperture;
  window: Window;
}) {
  if (aperture.hullBase === null || aperture.hullEnd === null) return null;
  const top = yOf(aperture.hullEnd, win);
  const bottom = yOf(aperture.hullBase, win);
  return (
    <div className={styles.apertureRail} style={{ height: `${RAIL}px` }}>
      <div
        className={styles.aperture}
        style={{ top: `${top}px`, height: `${Math.max(bottom - top, 2)}px` }}
        title={`${aperture.name} — hull of ${aperture.members.join(", ")}`}
      />
      <span className={styles.apertureLabel} style={{ top: `${top}px` }}>
        {aperture.name}
      </span>
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
  const slotBudget =
    span.kind === "slot_image" && budget && budget.flash.total !== null
      ? budget.flash.total
      : null;
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
        {/* A slot's capacity comes from `tan size`, not from the manifest, so
         *  it is named as a separate measurement rather than folded into the
         *  extent above. Gated on the KIND, not just on a name match: a
         *  partition may legally be named after a core. */}
        {slotBudget !== null && (
          <span>slot budget {formatBytes(slotBudget)} · tan size</span>
        )}
      </span>
    </li>
  );
}

/** Overlapping extents, stated before the picture rather than under it. */
function Conflicts({ conflicts }: { conflicts: MemoryConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className={styles.conflicts} role="alert">
      <p className={styles.conflictsTitle}>
        {conflicts.length === 1
          ? "One extent lands on another"
          : `${conflicts.length} extents land on others`}
      </p>
      <ul className={styles.conflictList}>
        {conflicts.map((c) => (
          <li key={c.id} className={styles.conflictRow}>
            <span className={styles.rowName}>
              {c.first} · {c.second}
            </span>
            <span className={styles.conflictKind}>
              {CONFLICT_TITLE[c.kind]}
            </span>
            <code className={styles.addr}>
              {c.device !== null
                ? `+${formatBytes(c.from)} – +${formatBytes(c.to)} in ${c.device}`
                : c.from === c.to
                  ? formatAddress(c.from)
                  : `${formatAddress(c.from)} – ${formatAddress(c.to)}`}
            </code>
          </li>
        ))}
      </ul>
      {/* The allocator's own overlap check runs against carve-outs already
       *  placed in the SAME region; a pinned address, a partition offset and a
       *  slice's load address are compared nowhere upstream. */}
      <p className={styles.conflictNote}>
        Computed here from the resolved extents — the allocator compares
        carve-outs only against carve-outs in the same region, so nothing
        upstream checks these pairs.
      </p>
    </div>
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
  const win = windowOf(placed, budgetByCore);
  const regionApertures = memory.apertures.filter(
    (a) => a.kind === "region" && a.hullBase !== null,
  );

  // The top 1/DETAIL_FACTOR of the window, magnified by exactly that factor
  // because it is drawn at the same rail height.
  //
  // FLOORED, because this bound is printed as an address. `(hi - lo) / 22` is
  // almost never whole, and `Number.prototype.toString(16)` renders the
  // remainder as hex digits after a dot — `0x80291745.d` reached the screen,
  // which is precisely the wrong-address failure this whole view exists to
  // prevent. An address is an integer or it is not an address.
  const detailSpan = win
    ? Math.max(1, Math.floor((win.hi - win.lo) / DETAIL_FACTOR))
    : 0;
  const detail: Window | null = win
    ? { lo: win.hi - detailSpan, hi: win.hi }
    : null;
  const inDetail = detail
    ? placed.filter((s) => {
        const reach =
          budgetEnd(s, budgetByCore.get(s.label)) ??
          endOf(s) ??
          (s.base as number);
        return reach > detail.lo;
      })
    : [];

  return (
    <div className={styles.root}>
      <Conflicts conflicts={memory.conflicts} />

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
          {win && (
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
              <div className={styles.rulers}>
                <Axis window={win} side="left" />
                <Rail
                  spans={placed}
                  window={win}
                  equalized={equalized}
                  selected={selected}
                  onSelect={setSelected}
                  caption={equalized ? "not to scale" : "true scale"}
                  budgets={budgetByCore}
                />
                {!equalized &&
                  regionApertures.map((a) => (
                    <ApertureRail key={a.id} aperture={a} window={win} />
                  ))}
                {!equalized && detail && (
                  <>
                    <Rail
                      spans={inDetail}
                      window={detail}
                      equalized={false}
                      selected={selected}
                      onSelect={setSelected}
                      caption={`${DETAIL_FACTOR}× top ${formatBytes(
                        detail.hi - detail.lo,
                      )}`}
                      budgets={budgetByCore}
                    />
                    <Axis window={detail} side="right" />
                  </>
                )}
              </div>
              {equalized && (
                <p className={styles.notToScale}>
                  Not to scale — every entry given equal height, and no
                  magnified band.
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

      {memory.apertures.length > 0 && (
        <p className={styles.apertureNote}>
          {memory.apertures.map((a) => `${a.name} (${a.kind})`).join(" · ")} —
          named by the manifest, with no extent of their own in this contract.
          The rails span what resolved into each, not the aperture.
        </p>
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
