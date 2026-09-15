// SPDX-License-Identifier: Apache-2.0
//
// The address-space half of the system manifest (#484).
//
// THE SoM's OWN REGION TABLE — mcuboot / slot0 / reserved / storage / the
// Secure-Enclave ATOC band — now DOES reach this view: alp-sdk#1365 landed
// `memory[]` on `system-manifest-v1` (alp-sdk#2030), and `MemoryChart`
// draws each resolved region as a backdrop frame behind the spans. The
// table below the map is `MemoryTable` (#484 phase 3) — ONE address-ordered
// table, region rows and placed-span rows together, replacing the two
// separate lists this file used to render side by side. Absent when the
// manifest predates that producer, or resolves no regions for this SoM —
// never guessed, and never read from `metadata/e1m_modules/<SKU>.yaml`,
// which the manifest's own description still forbids parsing from
// TypeScript.
//
// STILL READ-ONLY, for the same reason as before: `write_authority` is
// optional on both `som-preset-v1` and `system-manifest-v1` (promotion to
// required is alp-sdk#2024), so an editable affordance over a map that
// cannot always tell `storage` from `atoc` remains a live hazard — writing
// the ATOC can leave the part unbootable. #484 D5 was re-taken against the
// landed contract and reached the same answer.
//
// READ-ONLY IS A GATE, NOT A HABIT: `test/memoryRegions.readOnly.test.js`
// fails if this file grows a write path.
//
// The picture lives in `MemoryChart` — an SVG with a fixed viewBox, for
// the reason its own header gives. The table lives in `MemoryTable`.

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  MemoryConflict,
  MemorySpan,
  MemoryView,
  SliceSize,
} from "../../types";
import { formatAddress, formatBytes } from "./format";
import { MemoryChart } from "./MemoryChart";
import { MemoryTable } from "./MemoryTable";
import { chartWindowOf } from "./regionWindow";
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
  // Never actually looked up: OutsideRegionNotice (below) owns this kind's
  // rendering and Conflicts never receives one. Present only because
  // Record<MemoryConflict["kind"], string> requires every member.
  outside_region: "lands outside the region it names",
};

/** `from – to` as an address range, or a single address when they're equal.
 *  Shared by `Conflicts`' absolute-address branch and `OutsideRegionNotice`,
 *  which has no device-relative branch to choose between — `outside_region`
 *  findings never carry a `device`. */
function formatExtent(from: number, to: number): string {
  return from === to
    ? formatAddress(from)
    : `${formatAddress(from)} – ${formatAddress(to)}`;
}

/**
 * The DOM skeleton `Conflicts` and `OutsideRegionNotice` share: a
 * `role="alert"` block with a pluralised heading and one row per finding.
 * Heading text and row content are supplied by the caller so each keeps its
 * own wording — only the structure is shared, never the framing.
 */
function FindingList({
  findings,
  heading,
  row,
}: {
  findings: MemoryConflict[];
  heading: (count: number) => string;
  row: (finding: MemoryConflict) => ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <div className={styles.conflicts} role="alert">
      <p className={styles.conflictsTitle}>{heading(findings.length)}</p>
      <ul className={styles.conflictList}>
        {findings.map((f) => (
          <li key={f.id} className={styles.conflictRow}>
            {row(f)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Overlapping extents, stated before the picture rather than under it. */
function Conflicts({ conflicts }: { conflicts: MemoryConflict[] }) {
  return (
    <FindingList
      findings={conflicts}
      heading={(count) =>
        count === 1
          ? "One extent lands on another"
          : `${count} extents land on others`
      }
      row={(c) => (
        <>
          <span className={styles.rowName}>
            {c.first} · {c.second}
          </span>
          <span className={styles.conflictKind}>{CONFLICT_TITLE[c.kind]}</span>
          <code className={styles.addr}>
            {c.device !== null
              ? `+${formatBytes(c.from)} – +${formatBytes(c.to)} in ${c.device}`
              : formatExtent(c.from, c.to)}
          </code>
        </>
      )}
    />
  );
}

/**
 * `outside_region` findings, rendered separately from `Conflicts` above.
 *
 * `Conflicts`' heading ("One extent lands on another") and its row
 * (`{first} · {second}`) are a COLLISION framing: two things sharing an
 * address. A carve-out that overruns the region it names is a different
 * shape of problem — the manifest's OWN numbers disagreeing with each
 * other — and reusing the collision heading here would claim something
 * false: nothing else occupies the space this carve-out spilled into.
 */
function OutsideRegionNotice({ findings }: { findings: MemoryConflict[] }) {
  return (
    <FindingList
      findings={findings}
      heading={(count) =>
        count === 1
          ? "The manifest's own numbers disagree"
          : `${count} extents disagree with the region they name`
      }
      row={(f) => (
        <>
          <span className={styles.rowName}>
            {f.first}&rsquo;s extent is not inside region {f.second}
          </span>
          <code className={styles.addr}>{formatExtent(f.from, f.to)}</code>
        </>
      )}
    />
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
  // Same call `MemoryChart` makes internally, so the window this table
  // reports as "outside" and the one the chart actually draws can never
  // disagree.
  const chartWindow = chartWindowOf(
    memory.spans,
    budgetByCore,
    memory.regions ?? [],
  );
  const deviceRelative = memory.spans.filter((s) => s.base === null);
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));

  return (
    <div className={styles.root}>
      <Conflicts
        conflicts={memory.conflicts.filter((c) => c.kind !== "outside_region")}
      />
      <OutsideRegionNotice
        findings={memory.conflicts.filter((c) => c.kind === "outside_region")}
      />

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
              <div className={styles.chartScroll}>
                <MemoryChart
                  spans={memory.spans}
                  apertures={memory.apertures}
                  regions={memory.regions ?? []}
                  budgets={budgetByCore}
                  equalized={equalized}
                  selected={selected}
                  onSelect={toggle}
                />
              </div>
              <p className={styles.legend}>
                {equalized
                  ? "Not to scale — every entry given equal height."
                  : "Bands are extents, lines are a base with no size. Colour groups by region, device or core."}
              </p>
            </div>
          )}
        </div>
      )}

      {(memory.spans.length > 0 ||
        (memory.regions && memory.regions.length > 0)) && (
        <MemoryTable
          regions={memory.regions ?? []}
          spans={memory.spans}
          budgets={budgetByCore}
          window={chartWindow}
          selected={selected}
          onSelect={toggle}
        />
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
