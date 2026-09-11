// SPDX-License-Identifier: Apache-2.0
//
// The SoM's own region table (#484 phase 2) — mcuboot, the image slots, the
// writable window, the Secure-Enclave band — read straight from
// `system-manifest-v1`'s `memory[]` pane, when a producer new enough to
// emit it resolved one for this SoM. Grouped by write authority: that is
// the one axis a customer opens this tab to answer ("can I write here"),
// so it groups the rows rather than sitting in a column to scan.
//
// READ-ONLY, same gate as MemoryRegions.tsx and MemoryChart.tsx:
// `test/memoryRegions.readOnly.test.js`'s VIEW_FILES covers this file too.

import type { MemoryRegion, MemorySpan } from "../../types";
import { duplicatedNames, type Window } from "./regionWindow";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryRegionTable.module.css";

/** Spec table (#484 §2), verbatim. `write_authority` null is "absent" —
 *  its label depends on `source`, which the class itself does not (see
 *  `authorityClassOf` in core). */
function authorityLabel(region: MemoryRegion): string {
  const { writeAuthority, source } = region;
  if (writeAuthority === null) {
    return source === "soc_derived"
      ? "not authored · SoC-derived table"
      : "authority not declared";
  }
  switch (writeAuthority) {
    case "customer_runtime":
      return "customer · writable at runtime";
    case "customer_image":
      return "customer · written at flash time";
    case "vendor_image":
      return "vendor image · locked";
    case "secure_enclave":
      return "Secure Enclave · locked";
    case "none":
      return "no writer · reserved";
    case "composite":
      return "composite · see the contained regions";
    default:
      return `${writeAuthority} · unrecognised`;
  }
}

/** `flash` / `ram` render as themselves; `unclassified`, `unresolved`, or
 *  anything this build has never seen renders "class not proven" — an
 *  open `kind` this wide cannot be read as RAM just because it is not the
 *  word "flash". */
function kindLabel(kind: string): string {
  return kind === "flash" || kind === "ram" ? kind : "class not proven";
}

/** Grouping order (#484 §4): locked, customer, reserved, composite,
 *  unstated. `customer_runtime` and `customer_image` share a GROUP
 *  position but keep their own distinct LABEL above — merging them into
 *  one value would be the one-axis collapse the contract's two-axis
 *  vocabulary exists to prevent. */
const GROUP_ORDER: Record<MemoryRegion["authorityClass"], number> = {
  locked: 0,
  customer_runtime: 1,
  customer_image: 1,
  reserved: 2,
  composite: 3,
  unstated: 4,
};

function byGroupThenAddress(a: MemoryRegion, b: MemoryRegion): number {
  const g = GROUP_ORDER[a.authorityClass] - GROUP_ORDER[b.authorityClass];
  if (g !== 0) return g;
  if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  return a.name.localeCompare(b.name);
}

// `duplicatedNames` is imported from `regionWindow.ts`, not redeclared here:
// every by-name join in this file — `usersOf` below, plus the chart's own
// frame/aperture selection and core's `findOutsideRegion` — refuses an
// ambiguous name the same way, off the same computation, so the table row,
// the chart frame and the aperture bar can never disagree about which names
// are ambiguous.

/** The labels of every resolved carve-out or partition that names this
 *  region — a `carve_out_region` or a `flash_device` match, exactly the
 *  by-name join `MemoryAperture.members` already does for the chart's
 *  aperture bars, done here again because a region row and an aperture are
 *  different objects with different id namespaces (see `MemoryRegion.id`'s
 *  own doc). Reads only `spans`, never `unresolved`: a carve-out that
 *  named this region but did not resolve is not a user of it yet.
 *
 *  NEVER call this for a region whose name is in `duplicatedNames()` —
 *  the caller (`MemoryRegionTable` below) renders the shared-name note
 *  instead, the same refusal `findOutsideRegion` applies in core. */
function usersOf(region: MemoryRegion, spans: MemorySpan[]): string[] {
  return spans
    .filter((s) => s.region === region.name || s.device === region.name)
    .map((s) => s.label);
}

/** Every distinct `flash_device` a resolved partition names that has no
 *  matching region row — #484 §4's footer line: a controller instance is
 *  not a region and has no base to show. */
function devicesWithNoRegion(
  spans: MemorySpan[],
  regionNames: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    if (span.kind !== "partition" || span.device === null) continue;
    if (seen.has(span.device) || regionNames.has(span.device)) continue;
    seen.add(span.device);
    out.push(span.device);
  }
  return out;
}

export function MemoryRegionTable({
  regions,
  spans,
  window,
  selected,
  onSelect,
}: {
  regions: MemoryRegion[];
  spans: MemorySpan[];
  /** The chart's own (possibly grown) window, or null when no chart drew
   *  one — with no window there is no "outside it" to report. */
  window: Window | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const ordered = [...regions].sort(byGroupThenAddress);
  const regionNames = new Set(regions.map((r) => r.name));
  const orphanDevices = devicesWithNoRegion(spans, regionNames);
  const dupes = duplicatedNames(regions);
  const countByName = new Map<string, number>();
  for (const r of regions) {
    countByName.set(r.name, (countByName.get(r.name) ?? 0) + 1);
  }

  return (
    <div className={styles.root}>
      <p className={styles.title}>SoM regions ({regions.length})</p>
      <ul className={styles.rows} role="listbox" aria-label="SoM regions">
        {ordered.map((region, i) => {
          const isDuplicated = dupes.has(region.name);
          // Refuse the join for a duplicated name here too, the same way
          // MemoryChart's `selectedRegionName` does: two rows share the
          // same `id` (`memory:<name>`), so checking `selected ===
          // region.id` alone would mark BOTH rows selected the instant
          // either is clicked. `isDuplicated` is computed above, from the
          // same `duplicatedNames` this file imports from regionWindow.
          const isSelected = selected === region.id && !isDuplicated;
          // A sizeless row (base known, size unresolved — the F22 "size
          // unresolved" state) still says so when its base alone is
          // outside the window: the `>= window.hi` half is checked either
          // way, and only the LOWER half needs the extent to know it fully
          // clears `window.lo` versus merely starting before it.
          const outside =
            window !== null &&
            region.base !== null &&
            (region.base >= window.hi ||
              (region.sizeBytes !== null
                ? region.base + region.sizeBytes <= window.lo
                : region.base < window.lo));
          return (
            // Keyed by index PLUS id: two duplicate-named rows share the
            // same `id` (`memory:<name>`) — `id` alone would collide as a
            // React key, and `isSelected` above already refuses to mark
            // either one selected, so a click on either never highlights
            // both.
            <li
              key={`${i}-${region.id}`}
              className={styles.row}
              data-selected={isSelected || undefined}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => onSelect(region.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(region.id);
                }
              }}
            >
              <span className={styles.rowName}>{region.name}</span>
              <span
                className={styles.authority}
                data-class={region.authorityClass}
              >
                {authorityLabel(region)}
              </span>
              <span className={styles.regionClass}>
                {kindLabel(region.kind)}
              </span>
              <code className={styles.addr}>
                {region.base !== null
                  ? region.sizeBytes !== null
                    ? `${formatAddress(region.base)} – ${formatAddress(region.base + region.sizeBytes)}`
                    : `${formatAddress(region.base)} – size unresolved`
                  : "address unresolved"}
              </code>
              <span className={styles.rowSize}>
                {region.sizeBytes !== null
                  ? formatBytes(region.sizeBytes)
                  : "—"}
              </span>
              {region.cores.length > 0 && (
                <span className={styles.rowMeta}>
                  {region.cores.join(" ↔ ")}
                </span>
              )}
              {isDuplicated ? (
                // Refuse the join rather than guessing which row a
                // carve-out or partition meant — the same rule
                // `findOutsideRegion` applies in core.
                <span className={styles.rowMeta}>
                  name shared by {countByName.get(region.name)} rows, not joined
                </span>
              ) : (
                (() => {
                  const users = usersOf(region, spans);
                  return (
                    users.length > 0 && (
                      <span className={styles.rowMeta}>
                        used by {users.join(", ")}
                      </span>
                    )
                  );
                })()
              )}
              {outside && (
                <span className={styles.outsideNote}>
                  outside this map&rsquo;s window
                </span>
              )}
              {region.reason && (
                <span className={styles.reason}>{region.reason}</span>
              )}
            </li>
          );
        })}
      </ul>
      {orphanDevices.map((name) => (
        <p key={name} className={styles.footerNote}>
          <code>{name}</code> is a controller instance, not a region (no base)
        </p>
      ))}
    </div>
  );
}
