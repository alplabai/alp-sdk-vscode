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
// The picture lives in `MemoryChart` — an SVG whose viewBox HEIGHT is fixed
// and whose WIDTH is this file's own measurement (Task 8, #484 phase 4):
// `.mapSide` below is watched with a `ResizeObserver` and its live width is
// handed straight down as `MemoryChart`'s `width` prop, so the rail and the
// unified table (`MemoryTable`) sit beside each other as two breakpoint-free
// flex columns — narrow rail, wide table — rather than a fixed-width picture
// a `.chartScroll` used to scroll sideways when the panel ran narrow.

import { useEffect, useId, useState } from "react";
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
  BOARD_CONFIG_LABEL,
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
 * share: a landmark with a real heading and one row per finding. Heading text
 * and row content are supplied by the caller so each keeps its own wording —
 * only the structure is shared, never the framing. Generic over the finding
 * type so a `MemoryUnresolved` list (a blocked IPC carve-out) gets the same
 * treatment as a `MemoryConflict` one, without a second, near-identical
 * component.
 *
 * A REGION, NOT AN ALERT. `role="alert"` is an assertive live region: it is
 * for content that APPEARS after the page has settled, and it interrupts
 * whatever the reader was being told. Nothing here appears — this component
 * returns null when it has no findings, so the element enters the DOM with
 * its content already in it, which is the case a live region announces
 * unreliably (there is no mutation to observe, only a node that was never
 * there before). And the findings are static facts read off a manifest, so
 * there is nothing to interrupt anyone for. `role="region"` with the heading
 * as its `aria-labelledby` makes each one a landmark the reader can jump to
 * BY NAME — which is what a list of findings actually wants.
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
  // Before the early return: a hook cannot be called conditionally.
  const headingId = useId();
  if (findings.length === 0) return null;
  return (
    <div className={styles.conflicts} role="region" aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.conflictsTitle}>
        {heading(findings.length)}
      </h3>
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
 * landmark treatment as `Conflicts`/`OutsideRegionNotice`, above the picture —
 * a blocked carve-out is the allocator telling the reader something is
 * wrong, not a still-pending fact to skim later. Every other unresolved
 * status (`pending`, the emitter's own `unresolved`, …) stays in the list
 * below: not yet placed is not the same claim as refused.
 *
 * Two actions per finding (#484 Task 7): open the file that declares it
 * (always board.yaml, resolved by the host — see `blockedFindingActions
 * .ts`'s own doc) and copy its text. Both `ghost`-appearance — DESIGN.md's
 * Selected-Not-Suggested rule reserves `{colors.accent}`/`{colors.button-bg}`
 * for what is selected or the primary action, and neither applies to a
 * row-level utility action.
 *
 * The button reads "Open board config", never a specific filename (#484
 * Task 7 fix round 2, item 5 — see `BOARD_CONFIG_LABEL`'s own doc for why):
 * the host, not this component, decides which file that resolves to.
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
            {/* No per-finding `title` on THIS one, on purpose. Two of these
             *  side by side would carry the same name, and that is correct:
             *  the host resolves the file itself, so both buttons do the
             *  identical thing and telling them apart would be describing a
             *  difference that is not there. */}
            <Button appearance="ghost" onClick={openDeclaringFile}>
              Open {BOARD_CONFIG_LABEL}
            </Button>
            {/* "Copy" is the one that IS ambiguous: each copies its own
             *  finding's text, so a screen reader meeting two of them hears
             *  one name for two different actions. The name comes from the
             *  content and stays "Copy" — a label that grew the finding's
             *  name would be read in full every time, for a button whose
             *  whole job is one word — so the finding rides in the
             *  DESCRIPTION instead, which is announced after the name and
             *  only where it is needed. */}
            <Button
              appearance="ghost"
              title={`Copy ${f.label}`}
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
  // The chart column's OWN live width (Task 8, #484 phase 4) — a callback
  // ref (`setChartColumn` handed straight to `.mapSide`'s `ref`) rather than
  // a plain `useRef`, because `.mapSide` mounts and unmounts as `placed`
  // flips between empty and not: a plain ref's `useEffect([])` would only
  // ever see whatever `.current` held at THIS component's own first mount,
  // missing every later mount of `.mapSide` itself. A callback ref re-fires
  // on every one of those, so the observer below is always attached to
  // whichever `.mapSide` node currently exists, never a stale or absent one.
  const [chartColumn, setChartColumn] = useState<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    if (!chartColumn) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setChartWidth(width);
    });
    observer.observe(chartColumn);
    return () => observer.disconnect();
  }, [chartColumn]);

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
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));
  // A blocked entry is the allocator refusing something outright — the same
  // shape of problem `Conflicts`/`OutsideRegionNotice` already flag, so it
  // moves up beside them. Every other status (`pending`, the emitter's own
  // `unresolved`, …) is not yet placed, not refused, and stays below.
  const blocked = memory.unresolved.filter((e) => e.status === "blocked");
  const notBlocked = memory.unresolved.filter((e) => e.status !== "blocked");
  // `memory.spans` is placed spans and device-relative ones together, so
  // this is the SAME check the old two-branch ternary made from its own two
  // halves (`placed.length === 0 && deviceRelative.length === 0`) — kept as
  // one named boolean because Task 8 now gates a SECOND, independent thing
  // (the two-column `.map` below) on it too, alongside `hasRegions`.
  const hasSpans = memory.spans.length > 0;
  const hasRegions = !!(memory.regions && memory.regions.length > 0);

  return (
    <div className={styles.root}>
      <Conflicts
        conflicts={memory.conflicts.filter((c) => c.kind !== "outside_region")}
      />
      <OutsideRegionNotice
        findings={memory.conflicts.filter((c) => c.kind === "outside_region")}
      />
      <BlockedFindings findings={blocked} />

      {!hasSpans && (
        <p className={styles.empty}>
          This manifest pins no address. Every declared carve-out and partition
          is listed below with the reason it did not resolve.
        </p>
      )}

      {/* The rail (when there is a placed span to draw) and the unified
       *  table share this one row — see `.map`'s own comment
       *  (MemoryRegions.module.css) for the breakpoint-free construction.
       *  Rendered whenever EITHER would have something to show, independent
       *  of the empty paragraph above: a manifest with regions but no
       *  placed span still gets a table of those regions, exactly as
       *  before Task 8 — only the LAYOUT changed, not which content shows
       *  when. */}
      {(hasSpans || hasRegions) && (
        <div className={styles.map}>
          {placed.length > 0 && (
            <div className={styles.mapSide} ref={setChartColumn}>
              <AuthorityLegend />
              <p className={styles.legend}>
                The rail is a schematic: address space with nothing declared
                compresses to a fixed height and is marked, never drawn to
                scale.
              </p>
              <MemoryChart
                spans={memory.spans}
                apertures={memory.apertures}
                regions={memory.regions ?? []}
                budgets={budgetByCore}
                width={chartWidth}
                selected={selected}
                onSelect={toggle}
              />
            </div>
          )}

          <div className={styles.tableSide}>
            <MemoryTable
              regions={memory.regions ?? []}
              spans={memory.spans}
              budgets={budgetByCore}
              window={chartWindow}
              selected={selected}
              onSelect={toggle}
            />
          </div>
        </div>
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
