// SPDX-License-Identifier: Apache-2.0
//
// Pure row-building logic for the unified memory map (#484 phase 3) — no
// React, no CSS import, unit-tested directly through
// test/webview/esbuildImport.mjs the way authorityTier.ts and railScale.ts
// are. MemoryTable.tsx renders; this module decides which rows exist, which
// tier each belongs in, and the order they render in.
//
// Round 1 of review found this logic component-local, which is exactly why
// nothing could reach it: a harness assertion that reads a row's rendered
// `data-tier` against `byTier[row.tier]` can never disagree with itself when
// both read the same field off the same object. Moving tier derivation and
// sort order here, with their own unit tests asserting group MEMBERSHIP by
// name rather than by re-reading the field under test, is what actually
// closes that hole.

import type { MemoryRegion, MemorySpan, SliceSize } from "../../types";
import { type AuthorityTier, tierOf } from "./authorityTier";
import {
  budgetEnd,
  duplicatedNames,
  endOf,
  resolvedRegions,
  type ResolvedRegion,
  type Window,
} from "./regionWindow";
import { formatAddress, formatBytes } from "./format";

/** Spec table (#484 §2), verbatim. `write_authority` null is "absent" —
 *  its label depends on `source`, which the class itself does not (see
 *  `authorityClassOf` in core). */
export function authorityLabel(region: MemoryRegion): string {
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
export function kindLabel(kind: string): string {
  return kind === "flash" || kind === "ram" ? kind : "class not proven";
}

/** A SPAN's `kind` is a different three-value domain (`slot_image` /
 *  `carve_out` / `partition`) from a REGION's (`flash` / `ram` / …), so
 *  `kindLabel` above cannot label it. */
export const SPAN_KIND_LABEL: Record<MemorySpan["kind"], string> = {
  slot_image: "image slot",
  carve_out: "carve-out",
  partition: "partition",
};

// `duplicatedNames` is imported from `regionWindow.ts`, not redeclared here:
// every by-name join in this file — `usersOf` below, the chart's own
// frame/aperture selection and core's `findOutsideRegion` — refuses an
// ambiguous name the same way, off the same computation, so no two of them
// can ever disagree about which names are ambiguous.

/** The labels of every resolved carve-out or partition that names this
 *  region — never called for a region whose name is in `duplicatedNames()`;
 *  the caller renders the shared-name note instead, the same refusal
 *  `findOutsideRegion` applies in core. */
export function usersOf(region: MemoryRegion, spans: MemorySpan[]): string[] {
  return spans
    .filter((s) => s.region === region.name || s.device === region.name)
    .map((s) => s.label);
}

/** Every distinct `flash_device` a resolved partition names that has no
 *  matching region row — a controller instance is not a region and has no
 *  base to show. */
export function devicesWithNoRegion(
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
export interface Row {
  /** Unique React key. A duplicate-named region shares its `id` with every
   *  other row of that name (see `MemoryRegion.id`'s own doc), so the key
   *  carries the row's index too — `id` alone would collide as a React
   *  key. */
  key: string;
  /** The real selection id (`region.id` or `span.id`) — NOT guaranteed
   *  unique for a duplicated region name, on purpose: every row sharing
   *  that name is `inert` below, so none of them ever reaches `onSelect`. */
  id: string;
  origin: "region" | "span";
  tier: AuthorityTier;
  name: string;
  producer: "SoM region" | "placed image";
  /** Sort key. Null sorts last within the tier, by name. */
  base: number | null;
  range: string;
  size: string;
  cores: string[];
  reason: string | null;
  /** "used by …" / "name shared by N rows, not joined" (region) or the
   *  DECLARED-join sentence for a span (region) or the DECLARED-join
   *  sentence for a span's own `carve_out_region` name — a separate
   *  question from which region's extent CONTAINS the span's address (see
   *  `regionsContaining` below): a carve-out's `carve_out_region` says
   *  where the resolver allocated it FROM, by name, never what physically
   *  contains it. */
  note: string | null;
  kindText: string;
  /** A span's raw `kind` (`slot_image` / `carve_out` / `partition`), or
   *  null for a region row — drives the detail row's `[data-kind]`, the
   *  marker a placed image is findable by on the map. */
  rawKind: MemorySpan["kind"] | null;
  authorityText: string | null;
  /** Drives `.authority[data-class]`'s locked/customer_image styling in the
   *  detail row — the region's own class, or the class of the region whose
   *  extent contains a span's base address. */
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

/**
 * Every resolved region whose extent CONTAINS `address`, half-open
 * `[lo, hi)` — the same half-open convention `findConflicts`/`extentOf`
 * use in core, so a base sitting exactly on a region's own upper bound is
 * not read as inside it.
 */
function regionsContaining(
  address: number,
  resolved: ResolvedRegion[],
): MemoryRegion[] {
  return resolved
    .filter((r) => address >= r.lo && address < r.hi)
    .map((r) => r.region);
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
  // its base alone already clears `window.hi`. The LOWER half needs a real
  // extent to know the region fully clears `window.lo` rather than merely
  // starting before it, and a sizeless region has none: its true reach is
  // unknown, so it is never claimed to be outside on the lower side — it
  // could still extend into the window.
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
    rawKind: null,
    authorityText,
    authorityClassAttr: region.authorityClass,
    outside,
    accessibleName,
    inert: isDuplicated,
    selected: selectedId === region.id && !isDuplicated,
  };
}

/**
 * A span carries no `authorityClass` of its own. It takes the tier of the
 * region whose extent CONTAINS its base address — a geometric fact, not a
 * name match. `span.region` (a carve-out's `carve_out_region`) says which
 * aperture the resolver allocated FROM, by declaration; it is not
 * necessarily the region a span's address physically lands inside, and a
 * `slot_image` span carries no `region` at all. Round 1 review measured the
 * defect the old name-based derivation produced: `m55_he` (span, `region:
 * null`) and `he_slot0` (region, `customer_image`) share the base
 * `0x80010000`, yet the name join put `m55_he` in "unproven" and `he_slot0`
 * in "yours" — separated by an entire "Locked" group, in a table whose
 * whole point is putting the two on adjacent rows.
 *
 * Fail-closed to `"unproven"` when the base is absent, or when it is
 * contained by zero or by two-or-more resolved regions — an ambiguous
 * containment is refused exactly like an ambiguous name, never guessed.
 */
function spanRow(
  span: MemorySpan,
  regions: MemoryRegion[],
  resolved: ResolvedRegion[],
  dupes: Set<string>,
  budgets: Map<string, SliceSize>,
  selectedId: string | null,
): Row {
  const containing =
    span.base !== null ? regionsContaining(span.base, resolved) : [];
  const containingMatch = containing.length === 1 ? containing[0] : null;
  const tier: AuthorityTier = containingMatch
    ? tierOf(containingMatch.authorityClass)
    : "unproven";
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
  // The DECLARED join (`span.region`, a carve-out's `carve_out_region`) is a
  // separate question from containment above, and stays name-based: it is
  // the manifest's own statement of which aperture it allocated FROM, and
  // the two numbers (the region's own extent, this span's own extent) are
  // never merged into one — a reader wanting the region's own base/size
  // reads its row, one address away.
  const nameAmbiguous = span.region !== null && dupes.has(span.region);
  const nameMatch =
    span.region !== null && !nameAmbiguous
      ? (regions.find((r) => r.name === span.region) ?? null)
      : null;
  const note =
    span.region === null
      ? null
      : nameAmbiguous
        ? `region name "${span.region}" is shared by multiple rows, not joined`
        : nameMatch
          ? `extent from region ${span.region}`
          : `names region "${span.region}", which this manifest does not resolve`;
  const kindText = SPAN_KIND_LABEL[span.kind];
  const authorityText = containingMatch
    ? authorityLabel(containingMatch)
    : null;
  const accessibleName = joinAccessibleName([
    span.label,
    "placed image",
    // Neither a class nor a tier name: `authorityTier.ts` exists to keep
    // the six-class and three-tier vocabularies apart, and reusing either
    // word here for "no single region contains this address" would
    // conflate them.
    containingMatch ? containingMatch.authorityClass : "authority not joined",
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
    rawKind: span.kind,
    authorityText,
    authorityClassAttr: containingMatch ? containingMatch.authorityClass : null,
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
 * the region sorts before the span whose address it contains. A region and
 * a span landing inside it almost never share a NAME (`he_slot0` the
 * region, `m55_he` the span), so `compareByTierThenAddress`'s own name
 * tie-break would already have returned a (wrong, name-order) non-zero
 * result before this rule ever got a chance to apply — which is why this
 * module sorts rows with its own comparator instead of calling that one
 * directly. Tier is not re-compared here: `groupRowsByTier` below has
 * already bucketed every row by tier, so every pair this function ever sees
 * shares one.
 */
export function compareRows(a: Row, b: Row): number {
  if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  if (a.origin !== b.origin) return a.origin === "region" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export const TIERS: AuthorityTier[] = ["yours", "locked", "unproven"];

/** Every row, region rows first then span rows, unsorted and unbucketed —
 *  `groupRowsByTier` below does both from this. */
export function buildRows(
  regions: MemoryRegion[],
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  window: Window | null,
  selected: string | null,
): Row[] {
  const dupes = duplicatedNames(regions);
  const countByName = new Map<string, number>();
  for (const r of regions) {
    countByName.set(r.name, (countByName.get(r.name) ?? 0) + 1);
  }
  const resolved = resolvedRegions(regions);
  return [
    ...regions.map((r, i) =>
      regionRow(r, i, spans, dupes, countByName, window, selected),
    ),
    ...spans.map((s) =>
      spanRow(s, regions, resolved, dupes, budgets, selected),
    ),
  ];
}

/** Buckets `rows` by tier and sorts each bucket with `compareRows` — the
 *  one place tier order (`TIER_ORDER`) and within-tier order meet. */
export function groupRowsByTier(rows: Row[]): Record<AuthorityTier, Row[]> {
  const byTier: Record<AuthorityTier, Row[]> = {
    yours: [],
    locked: [],
    unproven: [],
  };
  for (const row of rows) byTier[row.tier].push(row);
  for (const tier of TIERS) byTier[tier].sort(compareRows);
  return byTier;
}
