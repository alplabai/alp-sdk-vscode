# Memory tab: restructure around an address-ordered table

The Build Plan panel's Memory tab scored **16/40** against Nielsen's ten
heuristics and failed **6 of 8** cognitive-load checks in a dual-assessment
review (design review isolated from a deterministic detector/accessibility
pass). The verdict was not "needs polish": the primitives underneath are
domain-authored and correct, and the composition on top of them is the
default chart-plus-list arrangement that any product could wear unchanged.

This spec replaces the composition. It changes no data model semantics, adds
no write path, and keeps every refusal-to-fabricate rule the module already
enforces.

## Goal

Make the Memory tab answer its four questions — where does my image land, does
anything overlap, may I write here, why was this refused — without the reader
holding anything in working memory across the screen.

## Non-goals

- Editing the map. `write_authority` is optional on both `som-preset-v1` and
  `system-manifest-v1`; the view claims no eligibility. #662 records the
  decision as "default: stay read-only", and `test/memoryRegions.readOnly.test.js`
  keeps it a tripwire.
- Re-vendoring schemas or bumping `SUPPORTED_CLI_VERSION` (#662, blocked on
  upstream tags).
- The chart-series and button contrast failures. Those are pre-existing and
  ship separately on `fix/chart-series-contrast`.

## Decisions already taken

| Decision | Chosen |
|---|---|
| Scope | Structural restructure, not targeted repair |
| Scale model | Piecewise ("broken") scale, replacing true scale |
| `Equalized` mode | Removed; the rail has one behaviour and no mode buttons |
| Authority swatch | Six values, no collapsing |
| Layout | Narrow fluid rail on the left, table on the right |
| Customer extents vs SoM regions | One address-ordered table, producer column mandatory |
| Rail height allocation | 8px floor per drawn extent plus a proportional share |
| Findings actions | Open-file and copy, both via host messages |

## 1. One address-ordered table

Today a customer extent (`m55_he`) sits in a right-hand column and the SoM
region carrying its size (`he_slot0`) sits roughly 400px below in a separate
list. The surface never states the two describe the same address range.
`MemorySpan.sizeBytes` deliberately refuses the by-name join — two numbers from
two producers must not fold into one that reads as a single fact — and that
refusal is correct. Refusing it *silently* is not.

Both kinds become rows of one table, sorted by resolved base address:

- Every row carries a **producer** cell with an explicit value: `SoM region`
  or `placed image`. Adjacency never implies identity on its own.
- At an equal `base`, order is deterministic: the SoM region first, then the
  extents that land inside it. Two builds must not swap the rows.
- A span whose size does not resolve prints `size not pinned by this manifest`.
  The em-dash is removed; `null` still never renders as `0`.
- Where a same-named region resolves an extent, the span row names the
  provenance inline — `extent from region he_slot0` — rather than importing
  the number.

Columns, fixed and aligned: `swatch | name | producer | authority | kind |
base – end | size | cores`. Addresses are right-aligned and tabular so they form
a real column. `MemoryRegions.module.css` already states that monospace was
chosen to buy exactly that alignment; the current `display: flex; flex-wrap:
wrap` throws it away, leaving the `<code>` address starting at a different x on
every row.

Rows are grouped by the authority ordering `byGroupThenAddress` already
computes and currently renders no header for. Groups are rendered, **writable
first**, each with a count. Non-writable groups collapse by default.

## 2. The rail: a piecewise schematic

`DETAIL_FACTOR = 22` and its second rail are deleted. One rail remains.

**Segments.** A segment is the interval between two consecutive declared
boundaries.

- A segment containing no extent is a **gap segment**: fixed 12px, marked with
  a zigzag rule, with the compressed byte count printed (`— 1.20 MiB empty,
  compressed —`).
- A segment containing extents gets an **8px floor per drawn extent**, and the
  remaining rail height is distributed among them in proportion to byte size.

Both figures are **CSS pixels, not viewBox units**. That distinction is load-
bearing: §7 re-lays the rail's geometry against a measured container rather
than scaling the SVG, so a viewBox unit no longer has a fixed relationship to a
rendered pixel, and a floor expressed in viewBox units would shrink with the
panel — reintroducing the invisible sliver it exists to prevent.

The floor is required, not decorative: on the `rpmsg-aen` fixture, `mcuboot`'s
64 KiB is 1.2% of the ~5.5 MiB that remains *after* gaps are compressed — 3.5px
on a 300px rail, still an invisible sliver.

**What this costs, stated plainly.** The rail stops being a proportional ruler
and becomes a schematic whose order and boundaries are exact and whose heights
are not. It is named accordingly; "true scale" is removed as a label because it
would no longer be true. Exact sizes live in the table, digit by digit.

**The stability objection, answered.** `DETAIL_FACTOR`'s docblock argues a
content-driven magnification "would move under the reader between two builds,
and a ruler whose scale moves cannot be compared with yesterday's". That
objection applies to content-driven compression too, and is not dismissed: the
difference is that 22× was silent, while every compression here is announced —
the zigzag plus the compressed byte count. A reader can always see what the
drawing did. Segments are defined by declared boundaries, so they move only
when the manifest moves.

**Axis ticks.** Boundary ticks are declared addresses only, at full weight.
This removes a defect rather than adding one: `0x80291746` (`aen801`) and
`0x8008a2e9` (`rpmsg-v2n`) are floored artifacts of `(hi − lo) / 22` that today
print as axis bounds in the same type as authored addresses, on the one screen
where digits are read one at a time.

A segment tall enough to want an interior mark may still have one, and
`binaryTicks`' power-of-two alignment is retained for exactly that. Such a mark
is **computed, not declared, and must never be set in the same type as a
boundary tick** — it renders one register down and in secondary ink. The rule
the old axis broke is that a reader could not tell an authored address from an
arithmetic by-product; an interior mark is allowed only while that distinction
is visible.

**Apertures.** The aperture bar stays on the rail. Its label leaves: 9px rotated
type inside a 9-unit-wide bar (`APERTURE_W = 9`) is unreadable, and on the
`rpmsg-v2n` fixture it is the third simultaneous depiction of `ocram_low`. The
label moves into the table row.

## 3. Authority: six achromatic swatches and a permanent legend

The tint-and-dash encoding is deleted. Measured, it carries no information on
screen: the three fill-bearing classes score **1.31:1**, **1.20:1** and
**1.09:1** against their own backdrop in Dark+ (1.18 / 1.12 / 1.06 in Light+)
against a 3:1 non-text minimum, and `reserved` — no fill — renders as the plain
rail background, so the band that means "no writer" is the one that looks like
nothing is there. The 1px dash patterns are not resolvable on frames 1–4px tall.

Replacement: a solid **6px bar in its own gutter immediately left of the rail**,
never behind the data, and the same swatch at the head of every table row.

All six classes keep their own value — `customer_runtime`, `customer_image`,
`locked`, `reserved`, `composite`, `unstated`. Nothing is collapsed: a declared
`reserved` and a fail-closed `unstated` must not look alike, which is the same
discipline that refuses the by-name join.

The channel is **density and hatch, not hue**. `DESIGN.md`'s Status-Only Color
Rule reserves colour for surfaces reporting state, and write authority is not a
state; the Borrowed Palette Rule means the system has no palette of its own to
spend. All six derive from `{colors.text-primary}`.

The legend sits **above the chart and is always visible** — not a disclosure,
not the Notes tab. Today `.legend` describes bands, lines and colour and does
not mention frames at all, and the Notes tab does not document the encoding
either, so decoding one frame costs a 400px round trip, seven times.

**Acceptance criteria, measured not asserted:** each swatch value scores ≥3:1
against the panel ground in Dark+ and Light+, and all six are pairwise
distinguishable. Six values in one channel is what failed before; these two
gates are what make the choice safe rather than a repeat.

## 4. Typography: use the scale that already exists

Fourteen classes across the three stylesheets resolve to `--font-size-base`.
The design system is not missing — `DESIGN.md` defines six steps
(Display/Headline/Title/Body/Label/Micro at +7/+3/+1/0/−1/−2 from
`--vscode-font-size`) — the Memory tab simply does not use them.

Three registers:

- **Identifiers and addresses** stay at Body/600.
- **Qualifiers** — kind, cores, the authority phrase — drop to Label.
- **Statements that change how the map must be read** — `outside this map's
  window`, `address unresolved`, `blocked`, `size unresolved` — rise to Title
  with a status colour and a leading icon, so they read as verdicts rather than
  trailing metadata.

`address unresolved` loses the bordered `<code>` chip: a failure phrase must not
be styled as an address.

## 5. Findings above the picture, and two host messages

Unresolved entries with `status: "blocked"` move into the same `role="alert"`
region as `Conflicts`, above the chart. Today `Conflicts` gets a red-bordered
alert while a blocked IPC carve-out — the failure actually present in three of
the four fixtures — gets a small pill below the entire region list, roughly
1000px below the primary answer at 420px.

The `reason` strings are the highest-value text in the view: they name the exact
file and field to change. They render as a bordered callout, not a full-width
run of undifferentiated mono.

The named path becomes a **button that posts a message to the extension host**,
which calls `vscode.window.showTextDocument`. A raw `vscode://file` href is not
reliable under the webview's CSP and is not used. A copy button beside it posts
a second message; the host calls `vscode.env.clipboard.writeText`. Both are new
message types on the existing protocol and are their own plan task.

Non-blocked unresolved entries stay where they are. What is promoted is the
blocking verdict, not the list.

## 6. Keyboard and accessibility

Absorbs the deferred items from #664 that this restructure makes trivial, plus
the defects the accessibility pass measured (7 HIGH, 5 MEDIUM, 3 LOW).

- One table means **one `role="listbox"`**: a single tab stop plus roving
  tabindex, with `ArrowUp`/`ArrowDown`/`Home`/`End`. Today both lists give every
  option its own `tabIndex={0}` with no arrow-key model — 13+ tab stops on the
  `rpmsg-aen` fixture — while `role="listbox"` promises the opposite.
- The authority groups of §1 are `role="group"` inside that listbox, each with
  an accessible name carrying its label and count. The collapse control is a
  **button outside the option flow**, not an option itself — a listbox whose
  options toggle their own siblings' existence has no defined keyboard
  semantics, and arrow keys must never land on a control that is not a row.
  Collapsed rows are removed from the option set, not hidden while still
  focusable.
- `role="tablist"` gains arrow-key navigation, roving tabindex, a real
  `role="tabpanel"`, and `aria-controls`/`id` pairing.
- The `<svg role="img">` contradiction ends. The rail carries no focusable
  descendants; selection is driven from the table and the rail reflects it.
  Today the container declares itself one flat image while holding
  `role="button" tabIndex={0}` groups.
- The hover address readout gains a keyboard equivalent and becomes copyable.
  Today it is mouse-only, and selecting it is impossible because the drag
  gesture that would select the text is the same gesture that relocates it.
- Real headings replace the `<p>` elements currently styled as headings; the
  feature's only `<h4>`s live in the separate Notes tab.
- `.row` loses `cursor: pointer` for `[aria-disabled]` rows, and Space calls
  `preventDefault()` everywhere it is handled.
- Hit targets meet the 24×24 CSS-px minimum. Today a marker span hit-tests at
  ~2px and `heightOf()` floors bands at 1px.

## 7. Layout

`.chartScroll`'s `flex: none` and the fixed `W = 578` are removed. The rail
measures its container with a `ResizeObserver` and re-lays its geometry. It does
**not** scale the SVG: scaling takes the type down with it, which is the stated
reason `max-width: none` exists today.

The rail and table sit in an intrinsic grid that collapses to one column when
narrow. **Zero width-based media queries** — `DESIGN.md`'s No-Breakpoint Rule
holds, and the only `@media` blocks in the codebase remain
`prefers-reduced-motion: reduce`.

This removes both halves of one defect. At 1200px the measured dead rectangles
are 590×253px (`rpmsg-aen`), 545×240px (`rpmsg-v2n`) and 1195×235px (`aen801`,
~26% of the viewport). At 420px — a real width, since the panel is an editor-tab
webview and splits to roughly that — the fixed drawing overflows in all three
payloads, truncating `22× top 256.0 KiB` to `22× top 2` and `alp_default_rpmsg`
to `alp_defau`.

## 8. Degenerate states

- **No `memory[]`** (`aen801`): the region table already disappears correctly.
  The rail must also degrade — today the second rail draws an empty box with
  nine axis labels for content that is not there, which reads as a load failure.
  With the second rail gone, the remaining rail renders only what resolved.
- **All regions outside the window** (`rpmsg-v2n`): `ddr_main` is 4096.00 MiB
  against a 512 KiB window, signalled only by an italic clause at the end of a
  row. The window is stated at chart level with a count of what it excludes, and
  excluded rows carry the statement at Title register per §4.
- **Unresolved base** (`mram_main`): the three failure phrases that currently run
  together without separators (`composite · see the contained regions class not
  proven address unresolved`) become one status slot plus qualifiers.

## 9. DESIGN.md

**The Region-Frame Rule (#484 phase 2)** (`DESIGN.md:264-277`) is replaced. The
new rule states the gutter placement, the six achromatic values, the permanent
legend, and the ≥3:1 and pairwise-distinguishable criteria. If
`.apertureLabel`'s sanctioned `9px` disappears with the rotated label,
`test/buildPlan.typeScale.test.js`'s `SANCTIONED` list is updated in the same
change.

## 10. File decomposition

`MemoryChart.tsx` is at 751 lines, `BuildPlanView.tsx` at 625, and
`packages/alp-core/src/systemManifest/memoryView.ts` at 787 — all against the
800-line house cap. Segment arithmetic plus a `ResizeObserver` will push the
rail over it. The split is planned up front, not after:

- Segment and allocation maths join `regionWindow.ts` as React-free helpers.
- The table becomes its own component and stylesheet.
- Any further region logic in `memoryView.ts` splits rather than extends.

## 11. Tests and gates

- The render harness (`test/webview/ui-render.tsx`) pins, per fixture: the
  producer column, the deterministic equal-`base` order, the group headers and
  counts, gap-segment count and compressed byte text, the 8px floor, the six
  swatch values, legend presence, and the promoted blocked finding.
- A contrast test computes each swatch value against the panel ground in Dark+
  and Light+ and asserts ≥3:1, plus pairwise distinguishability.
- Keyboard tests assert a single tab stop into the table, arrow-key movement
  across rows and across group boundaries, `Home`/`End`, `preventDefault` on
  Space, that a collapsed group's rows leave the option set, and that the
  collapse control is reachable without arrow keys landing on it.
- `test/webview.cssTokens.test.js` continues to gate the Borrowed Palette Rule.
- `test/buildPlan.typeScale.test.js` is re-run against the new register
  assignments, with its `CHROME` allowlist and `SANCTIONED` list updated.
- `test/memoryRegions.readOnly.test.js` stays untouched in intent: the view
  remains read-only.
- Full local gate set green before any PR: `pnpm run format:check`,
  `pnpm run compile`, `pnpm test`, `pnpm exec vsce package --no-dependencies`,
  `bash scripts/check-vsix-allowlist.sh`.

## 12. Risks

- **Six values in one channel is what failed before.** The gates in §3 are the
  only thing separating this from a repeat; if a value cannot clear ≥3:1 or
  cannot be told from its neighbour, the encoding must change before it ships,
  not after.
- **The rail is no longer proportional.** Anyone reading heights as sizes will
  be wrong. The name, the legend, and the table carry the correction; if user
  testing shows the schematic still reads as a ruler, the floor is the first
  thing to revisit.
- **`ResizeObserver` in a webview** re-lays geometry on every resize; the
  implementation must not thrash. Measure before shipping.
