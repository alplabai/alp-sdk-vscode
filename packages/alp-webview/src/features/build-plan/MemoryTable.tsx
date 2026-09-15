// SPDX-License-Identifier: Apache-2.0
//
// The unified, address-ordered memory map (#484 phase 3).
//
// WHY ONE TABLE. A customer extent (`m55_he`) used to sit in one list and
// the SoM region carrying its size (`he_slot0`) sat ~400px below it in a
// second list, with nothing on the surface saying the two describe the same
// address range. The join stays refused by NAME here too — `row.producer`
// is the only thing distinguishing two adjacent rows that could otherwise
// read as one fact — but the refusal is no longer silent: both rows now
// sit next to each other, address-ordered, each labelled with the producer
// that emitted it.
//
// READ-ONLY, same gate as the rest of this feature:
// `test/memoryRegions.readOnly.test.js`'s VIEW_FILES covers this file too.

import { useState } from "react";
import type { MemoryRegion, MemorySpan, SliceSize } from "../../types";
import { type AuthorityTier, TIER_LABEL, tierOf } from "./authorityTier";
import { AuthorityLegend, AuthoritySwatch } from "./AuthoritySwatch";
import { budgetEnd, duplicatedNames, endOf, type Window } from "./regionWindow";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryTable.module.css";

/** Spec table (#484 §2), verbatim — carried over from MemoryRegionTable.tsx
 *  unchanged. `write_authority` null is "absent"; its label depends on
 *  `source`, which the class itself does not (see `authorityClassOf` in
 *  core). */
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
 *  word "flash". Carried over from MemoryRegionTable.tsx unchanged. */
function kindLabel(kind: string): string {
  return kind === "flash" || kind === "ram" ? kind : "class not proven";
}

/** A SPAN's `kind` is a different three-value domain (`slot_image` /
 *  `carve_out` / `partition`) from a REGION's (`flash` / `ram` / …), so
 *  `kindLabel` above cannot label it — this mirrors MemoryRegions.tsx's own
 *  `KIND_LABEL`, kept as a small separate copy rather than an import so
 *  this view file does not reach into a sibling component for three
 *  strings. */
const SPAN_KIND_LABEL: Record<MemorySpan["kind"], string> = {
  slot_image: "image slot",
  carve_out: "carve-out",
  partition: "partition",
};

// `duplicatedNames` is imported from `regionWindow.ts`, not redeclared here:
// every by-name join in this file — `usersOf` below, plus a span's own tier
// derivation, the chart's frame/aperture selection and core's
// `findOutsideRegion` — refuses an ambiguous name the same way, off the
// same computation, so no two of them can ever disagree about which names
// are ambiguous.

/** The labels of every resolved carve-out or partition that names this
 *  region. Carried over from MemoryRegionTable.tsx unchanged — see its own
 *  doc for why this is never called for a duplicated name. */
function usersOf(region: MemoryRegion, spans: MemorySpan[]): string[] {
  return spans
    .filter((s) => s.region === region.name || s.device === region.name)
    .map((s) => s.label);
}

/** Every distinct `flash_device` a resolved partition names that has no
 *  matching region row. Carried over from MemoryRegionTable.tsx unchanged. */
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

/** One row of the unified table — a region or a placed span, normalised to
 *  the same shape so both can sort and render together. */
interface Row {
  /** Unique React key. A duplicate-named region shares its `id` with every
   *  other row of that name (see `MemoryRegion.id`'s own doc), so the key
   *  carries the row's index too — the same trick MemoryRegionTable.tsx
   *  used to keep React from colliding on it. */
  key: string;
  /** The real selection id (`region.id` or `span.id`) — NOT guaranteed
   *  unique for a duplicated region name, on purpose: every row sharing
   *  that name is `inert` below, so none of them ever reaches `onSelect`. */
  id: string;
  origin: "region" | "span";
  tier: AuthorityTier;
  name: string;
  producer: "SoM region" | "placed image";
  /** Sort key. Null sorts last within the tier, by name — the same rule
   *  `compareByTierThenAddress` (Task 1) applies; see `compareRows` below
   *  for why this file cannot just call that comparator directly. */
  base: number | null;
  range: string;
  size: string;
  cores: string[];
  reason: string | null;
  /** "used by …" / "name shared by N rows, not joined" (region) or
   *  "extent from region …" / an unresolved-join sentence (span). */
  note: string | null;
  kindText: string;
  authorityText: string | null;
  /** Drives `.authority[data-class]`'s locked/customer_image styling in the
   *  detail row — the region's own class, or the class of the region a
   *  span's `region` unambiguously names. */
  authorityClassAttr: string | null;
  outside: boolean;
  accessibleName: string;
  /** A duplicated region name: no `onSelect`, `aria-disabled`, and
   *  `.row[aria-disabled]` sets `cursor: default` (#664 — the variant the
   *  old CSS lacked). */
  inert: boolean;
  selected: boolean;
}

function joinAccessibleName(parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p !== "").join(", ");
}

function regionRow(
  region: MemoryRegion,
  index: number,
  spans: MemorySpan[],
  dupes: Set<string>,
  countByName: Map<string, number>,
  window: Window | null,
  selectedId: string | null,
): Row {
  const isDuplicated = dupes.has(region.name);
  const end =
    region.base !== null && region.sizeBytes !== null
      ? region.base + region.sizeBytes
      : null;
  const range =
    region.base !== null
      ? end !== null
        ? `${formatAddress(region.base)} – ${formatAddress(end)}`
        : `${formatAddress(region.base)} – size unresolved`
      : "address unresolved";
  const size =
    region.sizeBytes !== null
      ? formatBytes(region.sizeBytes)
      : "size not pinned by this manifest";
  // A region with a base but no resolved size is marked outside only when
  // its base alone already clears `window.hi` — see MemoryRegionTable.tsx's
  // retired copy of this same comment for the lower-half reasoning.
  const outside =
    window !== null &&
    region.base !== null &&
    (region.sizeBytes !== null
      ? region.base >= window.hi || region.base + region.sizeBytes <= window.lo
      : region.base >= window.hi);
  const note = isDuplicated
    ? `name shared by ${countByName.get(region.name)} rows, not joined`
    : (() => {
        const users = usersOf(region, spans);
        return users.length > 0 ? `used by ${users.join(", ")}` : null;
      })();
  const authorityText = authorityLabel(region);
  const kindText = kindLabel(region.kind);
  const accessibleName = joinAccessibleName([
    region.name,
    "SoM region",
    region.authorityClass,
    authorityText,
    kindText,
    range,
    size,
    region.cores.length > 0 ? region.cores.join(" ↔ ") : null,
    region.reason,
  ]);
  return {
    key: `region:${index}:${region.id}`,
    id: region.id,
    origin: "region",
    tier: tierOf(region.authorityClass),
    name: region.name,
    producer: "SoM region",
    base: region.base,
    range,
    size,
    cores: region.cores,
    reason: region.reason,
    note,
    kindText,
    authorityText,
    authorityClassAttr: region.authorityClass,
    outside,
    accessibleName,
    inert: isDuplicated,
    selected: selectedId === region.id && !isDuplicated,
  };
}

/**
 * A span carries no `authorityClass` of its own. It takes the TIER of the
 * region its `region` field names, when that name is unambiguous
 * (`duplicatedNames`) and actually resolves to a region row — `"unproven"`
 * otherwise, the same fail-closed default every other unrecognised or
 * unjoinable value in this feature takes.
 */
function spanRow(
  span: MemorySpan,
  regions: MemoryRegion[],
  dupes: Set<string>,
  budgets: Map<string, SliceSize>,
  selectedId: string | null,
): Row {
  const ambiguous = span.region !== null && dupes.has(span.region);
  const match =
    span.region !== null && !ambiguous
      ? (regions.find((r) => r.name === span.region) ?? null)
      : null;
  const tier: AuthorityTier = match ? tierOf(match.authorityClass) : "unproven";
  const end = endOf(span);
  const budgetTo = budgetEnd(span, budgets.get(span.label));
  const range =
    span.base !== null
      ? end !== null
        ? `${formatAddress(span.base)} – ${formatAddress(end)}`
        : formatAddress(span.base)
      : span.deviceOffset !== null
        ? `+${formatBytes(span.deviceOffset)} in ${span.device ?? "?"}`
        : "—";
  const size =
    span.sizeBytes !== null
      ? formatBytes(span.sizeBytes)
      : budgetTo !== null && span.base !== null
        ? `${formatBytes(budgetTo - span.base)} · tan size`
        : "size not pinned by this manifest";
  // The two numbers are never merged: a resolved match prints the REGION's
  // own name, never its base or size — a reader wanting those reads the
  // region's own row, one address away.
  const note =
    span.region === null
      ? null
      : ambiguous
        ? `region name "${span.region}" is shared by multiple rows, not joined`
        : match
          ? `extent from region ${span.region}`
          : `names region "${span.region}", which this manifest does not resolve`;
  const kindText = SPAN_KIND_LABEL[span.kind];
  const authorityText = match ? authorityLabel(match) : null;
  const accessibleName = joinAccessibleName([
    span.label,
    "placed image",
    match ? match.authorityClass : "unproven",
    authorityText,
    kindText,
    range,
    size,
    span.cores.length > 0 ? span.cores.join(" ↔ ") : null,
    note,
  ]);
  return {
    key: `span:${span.id}`,
    id: span.id,
    origin: "span",
    tier,
    name: span.label,
    producer: "placed image",
    base: span.base,
    range,
    size,
    cores: span.cores,
    reason: null,
    note,
    kindText,
    authorityText,
    authorityClassAttr: match ? match.authorityClass : null,
    outside: false,
    accessibleName,
    inert: false,
    selected: selectedId === span.id,
  };
}

/**
 * Sorts within a tier by address, spans-with-no-base last (by name) — the
 * same rule `compareByTierThenAddress` (Task 1) applies for TIER and
 * ADDRESS — plus one rule that comparator cannot express: at an equal base,
 * the region sorts before the span that names it. A region and the span
 * resolving inside it almost never share a NAME (`he_slot0` the region,
 * `m55_he` the span), so `compareByTierThenAddress`'s own name tie-break
 * would already have returned a (wrong, name-order) non-zero result before
 * this rule ever got a chance to apply — which is why this file sorts rows
 * with its own comparator instead of calling that one directly. Tier is not
 * re-compared here: `byTier` below has already bucketed every row by tier,
 * so every pair this function ever sees shares one.
 */
function compareRows(a: Row, b: Row): number {
  if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  if (a.origin !== b.origin) return a.origin === "region" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function RowDetail({ row }: { row: Row }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailKind}>{row.kindText}</span>
      {row.authorityText && (
        <span
          className={styles.detailAuthority}
          data-class={row.authorityClassAttr ?? undefined}
        >
          {row.authorityText}
        </span>
      )}
      {row.cores.length > 0 && (
        <span className={styles.detailCores}>{row.cores.join(" ↔ ")}</span>
      )}
      {row.note && <span className={styles.detailNote}>{row.note}</span>}
      {row.reason && <span className={styles.detailReason}>{row.reason}</span>}
    </div>
  );
}

const TIERS: AuthorityTier[] = ["yours", "locked", "unproven"];

export function MemoryTable({
  regions,
  spans,
  budgets,
  window,
  selected,
  onSelect,
}: {
  regions: MemoryRegion[];
  spans: MemorySpan[];
  budgets: Map<string, SliceSize>;
  /** The chart's own (possibly grown) window, or null when no chart drew
   *  one — with no window there is no "outside it" to report. */
  window: Window | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<AuthorityTier, boolean>>({
    yours: true,
    locked: true,
    unproven: true,
  });
  const toggleGroup = (tier: AuthorityTier) =>
    setOpen((cur) => ({ ...cur, [tier]: !cur[tier] }));

  const dupes = duplicatedNames(regions);
  const countByName = new Map<string, number>();
  for (const r of regions) {
    countByName.set(r.name, (countByName.get(r.name) ?? 0) + 1);
  }
  const regionNames = new Set(regions.map((r) => r.name));
  const orphanDevices = devicesWithNoRegion(spans, regionNames);

  const allRows: Row[] = [
    ...regions.map((r, i) =>
      regionRow(r, i, spans, dupes, countByName, window, selected),
    ),
    ...spans.map((s) => spanRow(s, regions, dupes, budgets, selected)),
  ];

  const byTier: Record<AuthorityTier, Row[]> = {
    yours: [],
    locked: [],
    unproven: [],
  };
  for (const row of allRows) byTier[row.tier].push(row);
  for (const tier of TIERS) byTier[tier].sort(compareRows);

  // Roving tabindex: the selected row is the tab stop when there is one,
  // otherwise the very first row in tier-then-address order — never every
  // row at once, which would make Tab walk the whole map one row at a time.
  const activeKey =
    allRows.find((r) => r.selected)?.key ??
    TIERS.flatMap((t) => byTier[t])[0]?.key ??
    null;

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Memory map ({allRows.length})</h3>
      <AuthorityLegend />
      <ul className={styles.rows} role="listbox" aria-label="Memory map rows">
        {TIERS.map((tier) => (
          <li
            key={tier}
            role="group"
            data-tier-group={tier}
            aria-label={`${TIER_LABEL[tier]} (${byTier[tier].length})`}
          >
            <button
              type="button"
              className={styles.groupHead}
              aria-expanded={open[tier]}
              onClick={() => toggleGroup(tier)}
            >
              {TIER_LABEL[tier]} ({byTier[tier].length})
            </button>
            {open[tier] && (
              <ul className={styles.groupRows}>
                {byTier[tier].map((row) => (
                  <li
                    key={row.key}
                    className={styles.row}
                    role="option"
                    aria-selected={row.selected}
                    aria-expanded={row.selected}
                    aria-disabled={row.inert || undefined}
                    aria-label={row.accessibleName}
                    data-selected={row.selected || undefined}
                    tabIndex={row.key === activeKey ? 0 : -1}
                    onClick={() => {
                      if (!row.inert) onSelect(row.id);
                    }}
                    onKeyDown={(e) => {
                      if (row.inert) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(row.id);
                      }
                    }}
                  >
                    <span data-col="swatch">
                      <AuthoritySwatch tier={row.tier} />
                    </span>
                    <span data-col="name" className={styles.name}>
                      {row.name}
                      <span className={styles.producer}>{row.producer}</span>
                    </span>
                    <code data-col="range" className={styles.range}>
                      {row.range}
                    </code>
                    <span data-col="size" className={styles.size}>
                      {row.size}
                    </span>
                    {row.outside && (
                      <span className={styles.outsideFlag}>
                        outside this map&rsquo;s window
                      </span>
                    )}
                    <RowDetail row={row} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {orphanDevices.map((name) => (
        <p key={name} className={styles.footerNote}>
          <code>{name}</code> is a controller instance, not a region (no base)
        </p>
      ))}
    </div>
  );
}
