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
//
// The picture lives in `MemoryChart` — an SVG with a fixed viewBox, for the
// reason its own header gives.

import { useState } from "react";
import type {
  MemoryConflict,
  MemorySpan,
  MemoryView,
  SliceSize,
} from "../../types";
import { formatAddress, formatBytes } from "./format";
import { MemoryChart, budgetEnd, endOf } from "./MemoryChart";
import styles from "./MemoryRegions.module.css";

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
  const budgetTo = budgetEnd(span, budget);
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
        {budgetTo !== null && span.base !== null && (
          <span>
            slot budget {formatBytes(budgetTo - span.base)} · tan size
          </span>
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
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));

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
          {placed.length > 0 && (
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
              <MemoryChart
                spans={memory.spans}
                apertures={memory.apertures}
                budgets={budgetByCore}
                equalized={equalized}
                selected={selected}
                onSelect={toggle}
              />
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
                onSelect={() => toggle(span.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {memory.apertures.length > 0 && (
        <p className={styles.apertureNote}>
          {memory.apertures.map((a) => `${a.name} (${a.kind})`).join(" · ")} —
          named by the manifest, with no extent of their own in this contract.
          The bars span what resolved into each, not the aperture.
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
