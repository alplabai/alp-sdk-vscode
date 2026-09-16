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
  MemoryUnresolved,
  MemoryView,
  SliceSize,
} from "../../types";
import { Button } from "../../shared/ui";
import { AuthorityLegend } from "./AuthoritySwatch";
import {
  DECLARING_FILE,
  copyFindingText,
  openDeclaringFile,
} from "./blockedFindingActions";
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
 * The DOM skeleton `Conflicts`, `OutsideRegionNotice` and `BlockedFindings`
 * share: a `role="alert"` block with a real heading and one row per finding.
 * Heading text and row content are supplied by the caller so each keeps its
 * own wording — only the structure is shared, never the framing. Generic
 * over the finding type so a `MemoryUnresolved` list (a blocked IPC
 * carve-out) gets the same alert treatment as a `MemoryConflict` one,
 * without a second, near-identical component.
 */
function FindingList<T extends { id: string }>({
  findings,
  heading,
  row,
}: {
  findings: T[];
  heading: (count: number) => string;
  row: (finding: T) => ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <div className={styles.conflicts} role="alert">
      <h3 className={styles.conflictsTitle}>{heading(findings.length)}</h3>
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

/** The finding's own displayed text, composed for "Copy" — label, kind,
 *  cores (when the manifest names any) and the resolver's reason, verbatim.
 *  Composed here rather than re-read off the DOM so "Copy" always copies
 *  exactly what the row itself renders, never a re-derived subset. */
function blockedFindingText(f: MemoryUnresolved): string {
  const parts = [f.label, KIND_LABEL[f.kind]];
  if (f.cores.length > 0) parts.push(f.cores.join(" ↔ "));
  parts.push(f.reason ?? "(no reason given)");
  return parts.join(" — ");
}

/**
 * Declared entries the allocator refused outright (`status === "blocked"`),
 * promoted out of the "Declared, not placed" list below and into the same
 * alert treatment as `Conflicts`/`OutsideRegionNotice`, above the picture —
 * a blocked carve-out is the allocator telling the reader something is
 * wrong, not a still-pending fact to skim later. Every other unresolved
 * status (`pending`, the emitter's own `unresolved`, …) stays in the list
 * below: not yet placed is not the same claim as refused.
 *
 * Two actions per finding (#484 Task 7): open the file that declares it
 * (always `board.yaml` — see `blockedFindingActions.ts`'s own doc) and copy
 * its text. Both `ghost`-appearance — DESIGN.md's Selected-Not-Suggested
 * rule reserves `{colors.accent}`/`{colors.button-bg}` for what is selected
 * or the primary action, and neither applies to a row-level utility action.
 */
function BlockedFindings({ findings }: { findings: MemoryUnresolved[] }) {
  return (
    <FindingList
      findings={findings}
      heading={(count) =>
        count === 1
          ? "One declared entry is blocked"
          : `${count} declared entries are blocked`
      }
      row={(f) => (
        <>
          <span className={styles.rowName}>{f.label}</span>
          <span className={styles.conflictKind}>{KIND_LABEL[f.kind]}</span>
          {f.cores.length > 0 && (
            <span className={styles.rowMeta}>
              <span>{f.cores.join(" ↔ ")}</span>
            </span>
          )}
          <span className={styles.reasonCallout}>
            {f.reason ?? "(no reason given)"}
          </span>
          <span className={styles.findingActions}>
            <Button appearance="ghost" onClick={openDeclaringFile}>
              Open {DECLARING_FILE}
            </Button>
            <Button
              appearance="ghost"
              onClick={() => copyFindingText(blockedFindingText(f))}
            >
              Copy
            </Button>
          </span>
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
  // A blocked entry is the allocator refusing something outright — the same
  // shape of problem `Conflicts`/`OutsideRegionNotice` already flag, so it
  // moves up beside them. Every other status (`pending`, the emitter's own
  // `unresolved`, …) is not yet placed, not refused, and stays below.
  const blocked = memory.unresolved.filter((e) => e.status === "blocked");
  const notBlocked = memory.unresolved.filter((e) => e.status !== "blocked");

  return (
    <div className={styles.root}>
      <Conflicts
        conflicts={memory.conflicts.filter((c) => c.kind !== "outside_region")}
      />
      <OutsideRegionNotice
        findings={memory.conflicts.filter((c) => c.kind === "outside_region")}
      />
      <BlockedFindings findings={blocked} />

      {placed.length === 0 && deviceRelative.length === 0 ? (
        <p className={styles.empty}>
          This manifest pins no address. Every declared carve-out and partition
          is listed below with the reason it did not resolve.
        </p>
      ) : (
        <div className={styles.map}>
          {placed.length > 0 && (
            <div className={styles.mapSide}>
              <AuthorityLegend />
              <p className={styles.legend}>
                The rail is a schematic: address space with nothing declared
                compresses to a fixed height and is marked, never drawn to
                scale.
              </p>
              <div className={styles.chartScroll}>
                <MemoryChart
                  spans={memory.spans}
                  apertures={memory.apertures}
                  regions={memory.regions ?? []}
                  budgets={budgetByCore}
                  selected={selected}
                  onSelect={toggle}
                />
              </div>
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

      {notBlocked.length > 0 && (
        <div className={styles.unresolved}>
          <h3 className={styles.unresolvedTitle}>
            Declared, not placed ({notBlocked.length})
          </h3>
          <ul className={styles.rows}>
            {notBlocked.map((entry) => (
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
                <span className={styles.reasonCallout}>
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
