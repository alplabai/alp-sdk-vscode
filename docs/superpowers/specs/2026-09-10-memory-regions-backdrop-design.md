# Memory tab: the SoM region backdrop from `memory[]`

- **Date:** 2026-09-10
- **Issue:** #484 (phase 2, the read-only half). Editability stays with #662.
- **Upstream contract:** alplabai/alp-sdk#1365. The `memory[]` producer landed in `96a382929b` (alp-sdk#2030); no alp-sdk tag carries it yet (alplabai/alp-sdk#2047).

## Goal

When `build/system-manifest.yaml` carries the `memory[]` pane, the Build Plan panel's Memory tab draws the SoM's own region table behind the memory map, at true scale, labelled by write authority.

When the pane is absent — every manifest produced by alp-sdk `v0.16.0` / tan `0.6.0` — the tab renders exactly what it renders today.

## Non-goals

- **No schema re-vendor.** Re-vendoring is tag-only (#662). `schemas/system-manifest-v1.schema.json` and `packages/alp-core/src/validation/vendoredSchemas.ts` stay byte-identical.
- **No `SUPPORTED_CLI_VERSION` bump.** It stays `0.6.0` (#662).
- **No editing and no host round-trip.** #484 D5 is re-taken against the landed contract and stays read-only: `write_authority` is optional in both `som-preset-v1` and `system-manifest-v1` (promotion to required is alp-sdk#2024), so D5's precondition — authority schema-required with no default — is unmet by the contract itself.
- **No absolute base for storage partitions and no partition-vs-carve-out conflict.** No producer case exists: alp-sdk's `scripts/alp_orchestrate/partition.py` (`_has_real_dt_label`) refuses a `flash_device` naming a `memory_map:` region unless that region authors a verified `dt_label`, and no preset does. Revisit when one does.
- **No eligibility, "free" or "remaining" claims.** IPC and mount eligibility belong to the allocator and already reach the panel as `ipc[].status` / `ipc[].reason`.

## The contract, as consumed

From alp-sdk dev `metadata/schemas/system-manifest-v1.schema.json`:

- The pane is **omitted, never emitted empty**, when a SoM resolves no regions. An absent pane means "older producer or pending SoM", never "no regions".
- A row requires `name`, `source` (`som_preset` | `soc_derived`), `kind` (`flash` | `ram` | `unclassified` | `unresolved`) and `status` (`ok` | `unresolved`).
- Optional fields:
  - `base` — integer; present only when `status: ok`.
  - `size_bytes` — integer; resolves independently of `base`.
  - `write_authority` — `customer_image` | `vendor_image` | `customer_runtime` | `secure_enclave` | `none` | `composite`. Absent means unresolved, never `customer_runtime`.
  - `accessible_from` — core ids.
  - `reason` — required when `status: unresolved`.
- The `unclassified` and `unresolved` kinds mean "not proven" and must never be read as RAM.
- Rows join the other panes **by name**: `ipc[].carve_out_region` and `storage[].flash_device` each name a `memory[].name`. The join is partial by construction; an `on_module.ospi_memories` key is a legal `flash_device` with no row.

Real emitted examples (alp-sdk `tests/fixtures/emit-snapshots/`):

- `rpmsg-aen`: seven `som_preset` rows — `mcuboot` (`vendor_image`), `he_slot0` / `hp_slot0` (`customer_image`), `reserved` (`none`), `storage` (`customer_runtime`), `atoc` (`secure_enclave`), and `mram_main` (`composite`, `status: unresolved`, with a reason).
- `rpmsg-v2n`: three `soc_derived` rows (`ddr_main`, `ocram_low`, `m33_tcm`), `kind: unresolved`, `status: ok`, no `write_authority`.

## 1. Data model (`packages/alp-core`)

- `SystemManifest` gains `memory?: unknown[]`. `parseSystemManifest` reads it the way it reads `storage`: an array or `undefined`. `src/flash/gate.ts` and `src/debug.ts` are unaffected.
- `MemoryView` gains `regions?: MemoryRegion[]`. The key is **omitted** when the manifest has no `memory` or an empty array, so every existing whole-view assertion (including "survives a manifest caught mid-write") stays green unedited.
- `MemoryRegion` carries:
  - `id` — `memory:<name>`. The `region:` prefix already belongs to `MemoryAperture` ids; sharing it would couple selection state between two different objects.
  - `name`, `source`, `kind`, `status` — open unions of the known members plus `string`.
  - `base: number | null` — kept only when `status` is `ok`.
  - `sizeBytes: number | null`.
  - `writeAuthority: string | null` — verbatim.
  - `authorityClass` — derived, see §2.
  - `cores: string[]`.
  - `reason: string | null` — verbatim and in full.
- Rows are narrowed in `memoryView.ts`, not typed in `models.ts`, which mirrors the vendored v0.16.0 schema field for field. Narrowing follows the module's existing doctrine:
  - Null members are dropped.
  - A row without a text `name` is dropped whole.
  - `base` and `size_bytes` accept integers only, capped at `Number.isSafeInteger`. A hex string in this pane is a producer deviation and is dropped, never coerced.
  - Extra keys are ignored.
  - `buildMemoryView` never throws.
- Duplicate region names are kept as rows but refuse every join by that name.
- Regions never feed `spans`, `apertures`, or the existing conflict checks; the UI joins them to spans and apertures by name.

## 2. Authority presentation (fail-closed)

`authorityClassOf(writeAuthority, source)` lives in core, is unit-tested exhaustively, and defaults to `unstated`.

| `write_authority` | `authorityClass` | Label |
|---|---|---|
| `customer_runtime` | `customer_runtime` | customer · writable at runtime |
| `customer_image` | `customer_image` | customer · written at flash time |
| `vendor_image` | `locked` | vendor image · locked |
| `secure_enclave` | `locked` | Secure Enclave · locked |
| `none` | `reserved` | no writer · reserved |
| `composite` | `composite` | composite · see the contained regions |
| absent, `som_preset` row | `unstated` | authority not declared |
| absent, `soc_derived` row | `unstated` | not authored · SoC-derived table |
| any other string | `unstated` | `<value>` · unrecognised |

- `customer_image` and `customer_runtime` stay visually distinct. The first is where images load; the second is the only class a carve-out or mount may land on. Merging them into "customer" is the one-axis collapse the contract's two-axis vocabulary exists to prevent.
- A `kind` of `unclassified`, `unresolved`, or an unrecognised value renders "class not proven".
- An unrecognised `status` is never drawn, even when `base` is present.
- Labels are UI copy and live in the webview. `authorityClass` is a string-literal union with the identical member set on both sides of the payload mirror.

## 3. Findings

- `overlap`, `covers_load_address` and `device_overlap` are unchanged and computed without regions.
- **New: `outside_region`.** Emitted for a resolved carve-out whose `carve_out_region` names exactly one region that has `status: ok`, `base` and `size_bytes`, when the carve-out's extent is not contained in that region.
  - It is worded as "the manifest's own numbers disagree", not as a collision.
  - It is not emitted when the named region is unresolved, sizeless, duplicated or absent — so a manifest without `memory` can never produce it.
- **Never computed:**
  - region-vs-region overlap — V2N's `ddr_main` legitimately contains `m33_tcm`;
  - authority mismatch — V2N's `ocram_low` carries no authority, yet its carve-out resolves `ok`;
  - a slot load address outside every `customer_image` region.

  Eligibility is the allocator's verdict, not the view's.

## 4. Presentation (`packages/alp-webview`)

- **Backdrop.** Resolved regions (`status: ok`, with `base` and `size_bytes`) that intersect the chart window are drawn as frames behind the spans.
  - Frames use a neutral stroke with a tint or hatch by authority class, taken from theme tokens. They never use the six-colour series palette, which stays with the spans.
  - `composite` draws as an outer frame only, so it never covers the regions it contains.
  - A frame is labelled when its height allows.
- **Window rule.** Start from today's window over spans and budgets, then grow it, to a fixpoint, over every resolved region that intersects or touches it.
  - No spans means no chart; the region table still renders.
  - `rpmsg-aen` gives `0x80000000`–`0x80580000`. With `DETAIL_FACTOR` unchanged at 22, the magnified top band is exactly 256 KiB.
  - In `rpmsg-v2n`, `ocram_low` joins the window. `ddr_main` and `m33_tcm` are listed as outside it.
  - The growth is a pure function in the webview, pinned through the render harness via the chart's `aria-label` range.
- **Region table ("SoM regions (N)")**, rendered whenever `regions` is present.
  - Rows are grouped by authority class (locked, customer, reserved, composite, unstated), then ordered by `base` ascending with unresolved rows last.
  - Columns: name, authority label, class (`flash` / `ram` / "class not proven"), address range or "address unresolved", size, cores.
  - A row used by a carve-out or partition names its users (by-name join in the UI).
  - Unresolved rows carry `reason` verbatim.
  - When a chart is drawn, rows that fall outside its window say so. With no chart there is no window, so no row carries that note.
  - When a partition names a `flash_device` that has no row, one footer line reads: "`<name>` is a controller instance, not a region (no base)".
  - The existing "Declared, not placed" list stays reserved for customer declarations that failed to resolve.
- **Keyboard and selection.**
  - Region rows and existing span rows become focusable (`tabIndex=0`); Enter/Space selects; `role="listbox"` / `role="option"` with `aria-selected`.
  - Selecting a region highlights its frame and the aperture of the same name.
  - The read-only gate still forbids `<select>`, `onChange`, `draggable`, and the `board.yaml` field names.
- **Copy.**
  - `MemoryNotes.tsx` "What it cannot show" covers both cases: pane absent (older producer, or SoM layout pending) and pane present (region table shown, eligibility not claimed).
  - One sentence explains that a squiggle under `memory:` comes from an older bundled schema, not a bad manifest.
  - Stale headers are corrected in `MemoryRegions.tsx`, `MemoryNotes.tsx` and `packages/alp-core/src/systemManifest/staleness.ts`.
- **Styling.**
  - CSS Modules and `tokens.css` aliases only. Colours come from `--vscode-*`; font sizes use `--font-size-*` tokens (the #661 gate).
  - WCAG 2.2 AA: frame strokes stay legible in dark, light and high-contrast themes through theme variables; focus uses `--border-focus`.
  - No new motion.
- **Visual direction.** A refinement in Operate mode inside `DESIGN.md`: restrained colour, compact rows, reasons wrapped in full, no new visual world.

## 5. Tests and gates

**Fixtures**
- `test/fixtures/system-manifest.rpmsg-aen.memory.yaml` and `test/fixtures/system-manifest.rpmsg-v2n.memory.yaml` are byte copies of alp-sdk `tests/fixtures/emit-snapshots/rpmsg-{aen,v2n}.system-manifest.snap` (identical to tan-cli's planner-oracle emits). Provenance is recorded in the test file.
- `system-manifest.aen801.yaml` and `system-manifest.rpmsg-v2n.snap.yaml` stay untouched as the absent-case baselines.

**Must stay green unedited**
- `test/systemManifest.memoryView.test.js`, `test/systemManifest.service.test.js`, `test/systemManifest.fixtures.schemaConformance.test.js`.
- The vendored-schema byte pins.
- The three assertions in `test/memoryRegions.readOnly.test.js`.
- The absent-case needles in `test/webview/ui-render.tsx`, including `22× top 378.2 kib`.

**New pins**
1. Absent fixtures produce no `regions` key, and the whole view equals the pre-change output.
2. `memory: []` is treated as absent.
3. `rpmsg-aen` yields seven regions with bases `2147483648`, `2147549184`, `2150301696`, `2153054208`, `2153119744`, `2153218048`. `mram_main` has base `null`, `sizeBytes` `5767168`, `status` `unresolved`, and its reason verbatim. `spans`, `apertures` and `conflicts` equal those of the same manifest with `memory` removed.
4. `rpmsg-v2n` yields three regions, with `writeAuthority` `null` on all and `conflicts` `[]`.
5. `authorityClassOf` covers the full table, including absent under both sources and an unrecognised string.
6. An unrecognised `kind` renders not proven; an unrecognised `status` is not drawn.
7. `outside_region` has one positive case, and negatives for unresolved, sizeless, duplicated and absent regions.
8. Render harness, second pass with `rpmsg-aen`: authority labels, the `mram_main` reason, the chart `aria-label` range `0x80000000`–`0x80580000`, and no "free" or "remaining" text. A third pass with `rpmsg-v2n` shows "class not proven" and the outside-window rows.
9. Payload and protocol mirrors: `MemoryRegion` is registered, `MemoryView.regions?` is added, the `authorityClass` and `MemoryConflictKind` member sets match, and `SystemManifest.memory?` is in `KNOWN_UNMIRRORED` with its reason.
10. Read-only tripwire: `VIEW_FILES` is extended with any new view file. The assertions stay unchanged; the header prose records that D5 was re-taken against the landed contract and stays read-only.

**Local gates** — every step of `ci.yml`'s build job:
- `format:check`, `compile`, `typecheck`
- `scripts/fetch-tan-contract.mjs`
- `node --test test/*.test.js`, `test:e2e:webview`
- `check-extension-deps`, `check-cli-pin`
- `vsce package` and the VSIX allowlist
- the vendored-schema check

**Seen working**
- Render-harness screenshots in dark and light at 420 px and 1200 px, for the absent case (`aen801`) and the present cases (`rpmsg-aen`, `rpmsg-v2n`).
- The Extension Development Host with a `memory[]` snapshot copied to `build/system-manifest.yaml`. The panel reads the file from disk, so no tan build is needed.

## 6. Delivery

- Branch `feat/memory-regions-backdrop`, rebased onto `dev` after #661 merges, so the font-size gate applies.
- One PR to `dev` with `Refs #484` (not Closes), and a `## Unreleased` CHANGELOG entry.
- `docs/TROUBLESHOOTING_VALIDATION.md` gets one entry for the `memory:` squiggle under the bundled schema.
- No re-vendor, no pin bump, no change to `board.yaml` handling.
