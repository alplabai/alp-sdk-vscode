// SPDX-License-Identifier: Apache-2.0
//
// The shapes of the address-space view (#484). Types only — the narrowing,
// span building and conflict analysis live in the sibling modules.

/**
 * What kind of thing occupies an extent.
 *
 *  - `slot_image`  the primary image slot a Zephyr slice loads into
 *                  (`slices[].flash_args.slot0_load_address`)
 *  - `carve_out`   a resolved IPC shared-memory carve-out (`ipc[]`)
 *  - `partition`   a resolved storage partition (`storage[]`)
 */
export type MemorySpanKind = "slot_image" | "carve_out" | "partition";

/** `som_preset` | `soc_derived`, open: an unrecognised string is kept
 *  verbatim rather than dropped — see `MemoryRegion`. */
export type MemoryRegionSource = "som_preset" | "soc_derived" | (string & {});

/** `unclassified` and `unresolved` mean "not proven" and must never be
 *  read as RAM; open for the same reason as `MemoryRegionSource`. */
export type MemoryRegionKind =
  | "flash"
  | "ram"
  | "unclassified"
  | "unresolved"
  | (string & {});

/** Only `"ok"` is drawn; an unrecognised value is treated like
 *  `"unresolved"` — never drawn, even when the row also carries a base. */
export type MemoryRegionStatus = "ok" | "unresolved" | (string & {});

/** Derived from `write_authority` + `source` by `authorityClassOf`. A
 *  CLOSED union — unlike the three above, the UI's authority-tinted
 *  frames and grouping have to exhaust it. */
export type MemoryAuthorityClass =
  | "customer_runtime"
  | "customer_image"
  | "locked"
  | "reserved"
  | "composite"
  | "unstated";

/** One extent the manifest pins, with the provenance to say where it came from. */
export interface MemorySpan {
  /** Stable render key. `<kind>:<label>`. */
  id: string;
  kind: MemorySpanKind;
  /** The carve-out / partition name, or the `core_id` for a slot image. */
  label: string;
  /**
   * Absolute base address, or `null` when the manifest pins no absolute one.
   *
   * A storage partition is always `null` here even when it fully resolves: the
   * emitter reports `offset_kib` as an offset WITHIN its flash device, and the
   * device's own base is a SEPARATE pane (`memory[]`, narrowed below into
   * `regions`) that this field does not join in. Combining the two would
   * fold two differently-sourced numbers into one that reads as a single
   * fact from the manifest, so the offset is reported as an offset and the
   * absolute address stays absent here — a reader wanting the device's own
   * base joins `MemorySpan.device` to a `MemoryRegion.name` by hand, the way
   * the webview's `MemoryTable` does.
   */
  base: number | null;
  /** Offset within `device`, in bytes. Partitions only; `null` elsewhere. */
  deviceOffset: number | null;
  /** Extent in bytes, or `null` when the manifest pins a base but no size
   *  — which is the normal state of a slot image: the SLOT SPAN itself
   *  carries no size here, ever. A same-named `MemoryRegion` row MAY carry
   *  that slot's extent (`memory[]`, when the manifest resolves one) —
   *  listed separately in the region table and never joined to this span,
   *  the same rule `MemorySpan.base`'s doc above states for base. */
  sizeBytes: number | null;
  /** `carve_out_region`: the SoM region the resolver allocated from. */
  region: string | null;
  /** `flash_device`: the device this partition lives in. */
  device: string | null;
  /** Cores that reach this extent: a carve-out's endpoints, or a slot image's
   *  own core. Empty when the manifest names none. */
  cores: string[];
  /** Filesystem for a partition (`littlefs` / `fat` / `ext4` / `raw`). */
  fs: string | null;
}

/** One thing the customer declared that did NOT resolve to an extent. */
export interface MemoryUnresolved {
  id: string;
  kind: MemorySpanKind;
  label: string;
  cores: string[];
  /** The emitter's own status word (`blocked`, `degraded`, …), or
   *  `"unresolved"` when it stated none and the extent is missing anyway. */
  status: string;
  /** The resolver's sentence, VERBATIM and in full, or `null` when it gave
   *  none. It is the only actionable half — a summary of
   *  "memory_map.base is TBD for region 'mram_main' … Add a `memory_map:`
   *  block to metadata/e1m_modules/E1M-AEN801.yaml" tells the reader nothing. */
  reason: string | null;
}

/**
 * A region or flash device the manifest NAMES but does not describe here.
 *
 * `carve_out_region` and `flash_device` say which aperture the resolver
 * allocated out of; the aperture's own base and size, when the contract
 * carries them at all, arrive as a SEPARATE `memory[]` row (narrowed below
 * into `MemoryRegion`) — this type never reads that pane. So an aperture
 * here is still a name plus the hull of what landed inside it, never the
 * aperture's own extent, EVEN WHEN a same-named `MemoryRegion` resolves one:
 * the two are joined only in the UI, by name, never merged into one object
 * here. The distinction matters on screen either way: a rail drawn to the
 * hull says "at least this much of it is in use", which is true, where a
 * rail drawn to a guessed extent would say how much is left, which nothing
 * in THIS type knows.
 */
export interface MemoryAperture {
  id: string;
  /** The name the manifest gave it. */
  name: string;
  /** `region` for a `carve_out_region`, `device` for a `flash_device`. */
  kind: "region" | "device";
  /** Labels of the extents the resolver placed inside it, in map order. */
  members: string[];
  /** Lowest base among the members, or null when they are device-relative. */
  hullBase: number | null;
  /** Highest end among the members, or null for the same reason. */
  hullEnd: number | null;
}

/**
 * One row of the SoM's own region table (#484 phase 2): `memory[]` on
 * `system-manifest-v1`, present only from an alp-sdk that carries
 * alp-sdk#1365's `memory[]` pane (landed in alp-sdk#2030; not yet in a
 * tagged release, alp-sdk#2047) and only when it resolves at least one
 * region for this SoM.
 *
 * Regions never feed `spans`, `apertures` or the pre-existing conflict
 * checks — the UI joins them to spans and apertures BY NAME. The one
 * exception is `outside_region` (below), which reads both.
 */
export interface MemoryRegion {
  /** `memory:<name>` — distinct from `MemoryAperture`'s `region:<name>`,
   *  which names a different object and must not share selection state
   *  with this one. */
  id: string;
  name: string;
  source: MemoryRegionSource;
  kind: MemoryRegionKind;
  status: MemoryRegionStatus;
  /** Kept only when `status` is exactly `"ok"` — an unrecognised status
   *  drops it even if the row carries one. */
  base: number | null;
  /** Resolves independently of `base`. */
  sizeBytes: number | null;
  /** Verbatim, or `null` when the producer named none. */
  writeAuthority: string | null;
  authorityClass: MemoryAuthorityClass;
  cores: string[];
  /** Verbatim and in full. */
  reason: string | null;
}

/**
 *  - `overlap`              two sized extents share addresses
 *  - `covers_load_address`  a sized extent contains a slice's load address —
 *                           the shape of the ATOC incident (alp-sdk#1289): an
 *                           allocation landing on top of something already
 *                           living there, with nothing failing at build time
 *  - `device_overlap`       two partitions overlap inside one flash device
 *  - `outside_region`       a resolved carve-out's extent is not contained
 *                           in the one resolved region its `carve_out_region`
 *                           names — the manifest's own numbers disagreeing,
 *                           not a collision
 */
export type MemoryConflictKind =
  | "overlap"
  | "covers_load_address"
  | "device_overlap"
  | "outside_region";

/** Two extents the manifest placed on top of each other. */
export interface MemoryConflict {
  id: string;
  kind: MemoryConflictKind;
  /** The two labels, in map order — for `covers_load_address` the sized
   *  extent first, then the slice whose load address it covers. */
  first: string;
  second: string;
  /** The shared range, half-open: absolute addresses, or offsets in `device`.
   *  For `covers_load_address` both ends are the address itself. */
  from: number;
  to: number;
  /** The flash device both partitions live in; null for absolute conflicts. */
  device: string | null;
}

export interface MemoryView {
  /** `hw_info.sku`, so the view can name the part its addresses belong to. */
  sku: string;
  /** Resolved extents, ordered by base ascending; the ones with no absolute
   *  base last, then by label. Deterministic so a re-render never reshuffles. */
  spans: MemorySpan[];
  /** Declared-but-unresolved entries, in manifest order. */
  unresolved: MemoryUnresolved[];
  /** The regions and devices the manifest names, with what landed in each. */
  apertures: MemoryAperture[];
  /** The SoM's own region table (#484 phase 2). Omitted — never an empty
   *  array — when the manifest carries no `memory[]` pane, or the pane
   *  resolves no regions for this SoM. */
  regions?: MemoryRegion[];
  /**
   * Extents the manifest placed on top of one another.
   *
   * Computed rather than trusted: the allocator's own overlap check runs only
   * against carve-outs already placed in the SAME region, so two extents that
   * reach one address by different routes — a pinned `ipc[].address:`, a
   * partition offset, a slice's load address — are compared nowhere upstream.
   * This is the one thing this view can say that the manifest does not.
   */
  conflicts: MemoryConflict[];
}
