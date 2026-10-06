// SPDX-License-Identifier: Apache-2.0
//
// Pure row-building logic for the memory strip (#484) — no React, no CSS
// import, unit-tested directly through test/webview/esbuildImport.mjs the
// way authorityTier.ts and railScale.ts are. MemoryStrip.tsx draws; this
// module decides what each item IS: its exact range, its size in both
// spellings, its footprint, its authority, and the note that ties it to the
// region it came from. The strip's selected-item detail line is one of these
// rows printed in full.

import type {
  MemoryRegion,
  MemorySpan,
  MemoryUnresolved,
  SliceSize,
} from "../../types";
import { type AuthorityTier, tierOf } from "./authorityTier";
import {
  budgetEnd,
  duplicatedNames,
  endOf,
  resolvedRegions,
  type ResolvedRegion,
} from "./regionWindow";
import {
  formatAddress,
  formatBytes,
  formatOffset,
  formatRange,
  splitBytes,
} from "./format";
import { slotUsageOf, usedPercent } from "./slotUsage";

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

/**
 * Whether the SoM said anything about who may write its regions. False
 * when every resolved region is `unstated` (or there are none): the
 * fail-closed tier is then only a default, not a finding about the
 * reader's rows, and calling their own firmware "not yours" would be
 * false — so the strip draws no tier at all and says once that the SoM
 * does not publish authority. A declared `reserved` region keeps the
 * tiers: that tier is then a statement the manifest made.
 */
export function authorityDeclared(regions: MemoryRegion[]): boolean {
  return regions.some((r) => r.authorityClass !== "unstated");
}

/** The labels of every resolved carve-out or partition that names this
 *  region — never called for a region whose name is in `duplicatedNames()`;
 *  the caller renders the shared-name note instead, the same refusal
 *  `findOutsideRegion` applies in core. */
export function usersOf(region: MemoryRegion, spans: MemorySpan[]): string[] {
  return spans
    .filter((s) => s.region === region.name || s.device === region.name)
    .map((s) => s.label);
}

/** One item of the strip — a region or a placed span, normalised to the
 *  same shape so the detail line prints either without a second code path. */
export interface Row {
  /** Unique React key. A duplicate-named region shares its `id` with every
   *  other row of that name (see `MemoryRegion.id`'s own doc), so the key
   *  carries the row's index too — `id` alone would collide as a React
   *  key. */
  key: string;
  /** The real selection id (`region.id` or `span.id`) — NOT guaranteed
   *  unique for a duplicated region name, on purpose: every row sharing
   *  that name is `inert` below, so none of them is ever selectable. */
  id: string;
  origin: "region" | "span";
  tier: AuthorityTier;
  name: string;
  producer: "SoM region" | "placed image";
  /** Null when the manifest pinned no address. */
  base: number | null;
  range: string;
  /** The rounded figure alone (`2.63 MiB`), or the "not pinned" sentence
   *  when the manifest gave no size. */
  sizeText: string;
  /** The exact byte count in hex (`0x2a0000`), or null when there is no
   *  size to spell. */
  sizeHex: string | null;
  /** "from tan size" when the size is a `tan size` budget, not manifest-pinned. */
  sizeNote: string | null;
  /** `95.5 KiB · 3.6%`, "size unknown" for a slot image `tan size` did not
   *  measure, or null when this row has no footprint (a region, a
   *  carve-out, a partition). */
  usedText: string | null;
  /** The exact used byte count in hex, beside `usedText`. */
  usedHex: string | null;
  usedNote: string | null;
  cores: string[];
  reason: string | null;
  /** "used by …" / "name shared by N rows, not joined" (region) or the
   *  DECLARED-join sentence for a span's own `carve_out_region` name — a
   *  separate question from which region's extent CONTAINS the span's
   *  address (see `regionsContaining` below): a carve-out's
   *  `carve_out_region` says where the resolver allocated it FROM, by name,
   *  never what physically contains it. */
  note: string | null;
  kindText: string;
  authorityText: string | null;
  accessibleName: string;
  /** A duplicated region name: never selectable, because its id is shared
   *  with every other row of that name and a click could highlight all of
   *  them at once. */
  inert: boolean;
  selected: boolean;
}

/** The size cells for a byte count that may be absent. `fromBudget` marks a
 *  size `tan size` supplied rather than the manifest. */
function sizeCells(
  bytes: number | null,
  fromBudget: boolean,
): Pick<Row, "sizeText" | "sizeHex" | "sizeNote"> {
  if (bytes === null) {
    return {
      sizeText: "size not pinned by this manifest",
      sizeHex: null,
      sizeNote: null,
    };
  }
  return {
    sizeText: splitBytes(bytes).text,
    // Always the exact hex, even when the rounded figure is exact: the
    // detail line is compared digit by digit against a linker map.
    sizeHex: `0x${bytes.toString(16)}`,
    sizeNote: fromBudget ? "from tan size" : null,
  };
}

/** The used cells. A slot image with no measured footprint says so in
 *  words — never `0`, never blank. Anything that is not a slot image has
 *  no `tan size` footprint and carries none. */
export function usedCells(
  usage: ReturnType<typeof slotUsageOf>,
): Pick<Row, "usedText" | "usedHex" | "usedNote"> {
  if (usage === null) return { usedText: null, usedHex: null, usedNote: null };
  if (usage.used === null) {
    return { usedText: "size unknown", usedHex: null, usedNote: null };
  }
  const pct = usedPercent(usage);
  const bytes = splitBytes(usage.used).text;
  return {
    usedText: pct === null ? bytes : `${bytes} · ${pct}%`,
    usedHex: `0x${usage.used.toString(16)}`,
    usedNote: "from tan size",
  };
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
  selectedId: string | null,
): Row {
  const isDuplicated = dupes.has(region.name);
  const end =
    region.base !== null && region.sizeBytes !== null
      ? region.base + region.sizeBytes
      : null;
  // Half-open `[base, end)`, printed with its INCLUSIVE last byte.
  const range =
    region.base !== null
      ? end !== null
        ? formatRange(region.base, end)
        : `${formatAddress(region.base)} – size unresolved`
      : "address unresolved";
  const note = isDuplicated
    ? `name shared by ${countByName.get(region.name)} rows, not joined`
    : (() => {
        const users = usersOf(region, spans);
        return users.length > 0 ? `used by ${users.join(", ")}` : null;
      })();
  const authorityText = authorityLabel(region);
  const kindText = kindLabel(region.kind);
  const size = sizeCells(region.sizeBytes, false);
  const accessibleName = joinAccessibleName([
    region.name,
    "SoM region",
    region.authorityClass,
    authorityText,
    kindText,
    range,
    region.sizeBytes !== null ? formatBytes(region.sizeBytes) : size.sizeText,
    region.cores.length > 0 ? region.cores.join(" ↔ ") : null,
    note,
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
    ...size,
    usedText: null,
    usedHex: null,
    usedNote: null,
    cores: region.cores,
    reason: region.reason,
    note,
    kindText,
    authorityText,
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
 * `slot_image` span carries no `region` at all. A name-based derivation
 * once put `m55_he` (span, `region: null`) in "unproven" while `he_slot0`
 * (region, `customer_image`) at the very same base sat in "yours".
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
  const budgetTo = budgetEnd(span, budgets.get(span.label));
  // A slot image the manifest pins only a base for still occupies the slot
  // `tan size` measured, so its range reads base to the slot's last byte —
  // the same extent the strip draws — rather than a bare base address.
  const end = endOf(span) ?? budgetTo;
  const range =
    span.base !== null
      ? end !== null
        ? formatRange(span.base, end)
        : formatAddress(span.base)
      : span.deviceOffset !== null
        ? `${formatOffset(span.deviceOffset)} in ${span.device ?? "?"}`
        : "—";
  const usage = slotUsageOf(span, budgets.get(span.label));
  const sizeBytes =
    span.sizeBytes ??
    (budgetTo !== null && span.base !== null ? budgetTo - span.base : null);
  const size = sizeCells(sizeBytes, span.sizeBytes === null);
  const used = usedCells(usage);
  // The DECLARED join (`span.region`, a carve-out's `carve_out_region`) is a
  // separate question from containment above, and stays name-based: it is
  // the manifest's own statement of which aperture it allocated FROM, and
  // the two numbers (the region's own extent, this span's own extent) are
  // never merged into one — a reader wanting the region's own base/size
  // selects its band, one click away.
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
    sizeBytes !== null ? formatBytes(sizeBytes) : size.sizeText,
    used.usedText === null ? null : `used ${used.usedText}`,
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
    ...size,
    ...used,
    cores: span.cores,
    reason: null,
    note,
    kindText,
    authorityText,
    accessibleName,
    inert: false,
    selected: selectedId === span.id,
  };
}

/** Every row, region rows first then span rows, in the manifest's own order. */
export function buildRows(
  regions: MemoryRegion[],
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
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
      regionRow(r, i, spans, dupes, countByName, selected),
    ),
    ...spans.map((s) =>
      spanRow(s, regions, resolved, dupes, budgets, selected),
    ),
  ];
}

/** One declared entry the resolver did not place, or a SoM region that
 *  resolves no extent — address-less by nature, drawn as a ghost beside
 *  the strip rather than on it. */
export interface UnplacedRow {
  key: string;
  id: string;
  name: string;
  kindText: string;
  cores: string[];
  /** The emitter's own status word, capitalised ("Blocked", "Pending",
   *  "Unresolved"). */
  statusText: string;
  /** The size when the manifest resolved one without an address (V2N's
   *  `mram_main` resolves 5.50 MiB and no base), else null. */
  sizeText: string | null;
  /** The resolver's reason, verbatim and in full; null when it gave none. */
  reason: string | null;
  accessibleName: string;
}

const capitalise = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** Declared entries that resolved no address, in the manifest's own order. */
export function buildUnplacedRows(entries: MemoryUnresolved[]): UnplacedRow[] {
  return entries.map((e) => {
    const statusText = capitalise(e.status);
    return {
      key: `unplaced:${e.id}`,
      id: e.id,
      name: e.label,
      kindText: SPAN_KIND_LABEL[e.kind],
      cores: e.cores,
      statusText,
      sizeText: null,
      reason: e.reason,
      accessibleName: joinAccessibleName([
        e.label,
        SPAN_KIND_LABEL[e.kind],
        "not placed",
        statusText,
        e.cores.length > 0 ? e.cores.join(" ↔ ") : null,
        e.reason,
      ]),
    };
  });
}

/** SoM regions that resolve no extent — no base, no size, a zero size, or
 *  a status other than `ok` — which the strip cannot draw and must not
 *  drop: the reason they did not resolve is the one actionable half. */
export function unresolvedRegionRows(regions: MemoryRegion[]): UnplacedRow[] {
  const drawn = new Set(resolvedRegions(regions).map((r) => r.region));
  return regions
    .filter((r) => !drawn.has(r))
    .map((r, i) => {
      const statusText = capitalise(
        r.status === "ok" ? "unresolved" : r.status,
      );
      const sizeText = r.sizeBytes !== null ? formatBytes(r.sizeBytes) : null;
      return {
        key: `unresolved-region:${i}:${r.id}`,
        id: r.id,
        name: r.name,
        kindText: "SoM region",
        cores: r.cores,
        statusText,
        sizeText,
        reason: r.reason,
        accessibleName: joinAccessibleName([
          r.name,
          "SoM region",
          "not drawn",
          statusText,
          sizeText,
          r.cores.length > 0 ? r.cores.join(" ↔ ") : null,
          r.reason,
        ]),
      };
    });
}
