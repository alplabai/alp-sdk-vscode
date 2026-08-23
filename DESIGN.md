---
name: Alp IDE
description: A VS Code-native design system that owns no palette of its own — every color resolves through the user's active theme.
colors:
  text-primary: "var(--vscode-foreground)"
  text-secondary: "var(--vscode-descriptionForeground)"
  text-section-header: "var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground))"
  text-link: "var(--vscode-textLink-foreground)"
  text-link-active: "var(--vscode-textLink-activeForeground)"
  accent: "var(--vscode-focusBorder)"
  accent-fg: "var(--vscode-button-foreground)"
  button-bg: "var(--vscode-button-background)"
  button-fg: "var(--vscode-button-foreground)"
  button-hover-bg: "var(--vscode-button-hoverBackground)"
  surface-bg: "var(--vscode-sideBar-background, var(--vscode-editor-background))"
  surface-hover: "var(--vscode-toolbar-hoverBackground)"
  surface-badge: "var(--vscode-badge-background)"
  surface-input: "var(--vscode-input-background)"
  surface-dropdown: "var(--vscode-dropdown-background, var(--vscode-input-background))"
  surface-btn-secondary: "var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.1))"
  surface-btn-secondary-hover: "var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.2))"
  badge-fg: "var(--vscode-badge-foreground)"
  border-default: "var(--vscode-panel-border)"
  border-widget: "var(--vscode-widget-border)"
  border-focus: "var(--vscode-focusBorder)"
  border-input: "var(--vscode-input-border)"
  status-ok: "var(--vscode-testing-iconPassed)"
  status-warn: "var(--vscode-editorWarning-foreground)"
  status-err: "var(--vscode-editorError-foreground)"
  status-info: "var(--vscode-editorInfo-foreground, var(--vscode-textLink-foreground))"
typography:
  display:
    fontFamily: "var(--vscode-font-family, system-ui, sans-serif)"
    fontSize: "calc(var(--vscode-font-size, 13px) + 7px)"
    fontWeight: 600
  headline:
    fontFamily: "var(--vscode-font-family, system-ui, sans-serif)"
    fontSize: "calc(var(--vscode-font-size, 13px) + 3px)"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "var(--vscode-font-family, system-ui, sans-serif)"
    fontSize: "calc(var(--vscode-font-size, 13px) + 1px)"
    fontWeight: 600
  body:
    fontFamily: "var(--vscode-font-family, system-ui, sans-serif)"
    fontSize: "var(--vscode-font-size, 13px)"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "var(--vscode-font-family, system-ui, sans-serif)"
    fontSize: "calc(var(--vscode-font-size, 13px) - 1px)"
    fontWeight: 600
    letterSpacing: "0.04em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Cascadia Code', 'Liberation Mono', 'Courier New', monospace"
    fontSize: "calc(var(--vscode-font-size, 13px) - 1px)"
rounded:
  sm: "2px"
  md: "3px"
  lg: "8px"
  xl: "10px"
  full: "9999px"
spacing:
  "1": "2px"
  "2": "4px"
  "3": "6px"
  "4": "8px"
  "5": "12px"
  "6": "16px"
  "7": "20px"
  "8": "24px"
  "10": "32px"
components:
  button-primary:
    backgroundColor: "{colors.button-bg}"
    textColor: "{colors.button-fg}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-primary-hover:
    backgroundColor: "{colors.button-hover-bg}"
    textColor: "{colors.button-fg}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-secondary:
    backgroundColor: "{colors.surface-btn-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-btn-secondary-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-hover}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.status-err}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  card:
    backgroundColor: "{colors.surface-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  status-chip:
    backgroundColor: "{colors.status-ok}"
    textColor: "{colors.badge-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "1px 6px"
  stepper-dot:
    backgroundColor: "{colors.surface-bg}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.full}"
    height: "22px"
    width: "22px"
  stepper-dot-active:
    backgroundColor: "{colors.button-bg}"
    textColor: "{colors.button-fg}"
  stepper-dot-complete:
    backgroundColor: "{colors.status-ok}"
    textColor: "{colors.button-fg}"
---

# Design System: Alp IDE

## Overview

**Creative North Star: "The Native Guest"**

Alp IDE is a guest in someone else's house, and it behaves like one. The panels
render inside VS Code, next to the user's editor, in the theme the user chose
years ago and has not thought about since — and the correct reaction to an Alp
panel is no reaction at all. It should read as workbench chrome. The system
therefore owns no palette: every color in 3,821 lines of CSS resolves through
`var(--vscode-*)`, and the only literal color values in the product are second
arguments inside `var()` fallbacks and one boot-failure message that renders
when React never mounted. The brand is not a color. It is the masked `ALP LAB`
wordmark that takes on the theme's own foreground, and the precision of
everything around it.

The tone is precise, quiet, and instrument-grade. Nothing here exists to be
noticed. Confidence comes from consistency and correctness, not from
decoration — which is the visual translation of the product's own rule that an
estimate is called an estimate and a host run is called a reference. Surfaces
are flat, separated by single-pixel borders. Depth is a tonal shift, not a
shadow. Color appears almost nowhere except where something is reporting its
state, and that scarcity is what makes a red border mean something.

Density is workbench density, not marketing density. Type sizes are `calc()`
offsets from `--vscode-font-size`, so a user who runs a 15px editor gets a 15px
panel; nothing is pinned to a designer's 16px. Layout is intrinsic — the system
ships zero width-based breakpoints and reflows through `auto-fit` grids
instead. What this system rejects is equally definite: it is not a branded SaaS
dashboard with a palette of its own, it is not Material or Fluent wearing a VS
Code costume, and it is not marketing-toned onboarding.

**Key Characteristics:**

- No palette of its own — every color is `var(--vscode-*)`, gated by a test
- Flat by default; exactly one `box-shadow` in the entire system
- Tiny radii (2–3px) — controls and containers, not cards in a feed
- Type anchored to the workbench font size, never hardcoded px
- Zero width breakpoints; reflow comes from `auto-fit` grids and `flex-wrap`
- Variants are `data-*` attributes, never class-name soup
- 27 hand-drawn 24×24 stroke icons in `currentColor`, no icon font, no package

## Colors

The palette is not the system's to choose. Every value is a semantic alias
declared once in `packages/alp-webview/src/styles/tokens.css`, mapping a
`--vscode-*` variable injected by the host to a stable name that features
consume. Change the theme, and the whole product changes with it — correctly,
in both directions, without a single override.

### Primary

- **Workbench Action** (`{colors.button-bg}` / `{colors.button-fg}`): the
  theme's own button fill. This is what a call to action looks like — Build,
  Flash, Create Project, Install. It is the only fill the user is asked to
  press.

### Secondary

- **Focus Accent** (`{colors.accent}`, aliased from the theme's focus border):
  a saturated fill deliberately chosen *over* the button background because in
  dark themes `focusBorder` reads far brighter, so a selected toggle is
  unmistakable next to an unselected one. It marks state, not intent.

### Tertiary

- **Pass Green** (`{colors.status-ok}`): a check that passed, a completed
  wizard step, a connector line behind the user.
- **Attention Amber** (`{colors.status-warn}`): action required, update needed —
  a condition the user can still work around.
- **Failure Red** (`{colors.status-err}`): a validation error, a missing
  dependency, a destructive action's outline. Also the only color the `danger`
  button carries, as text and border on a transparent fill.
- **Advisory Blue** (`{colors.status-info}`): informational callouts, falling
  back to the link color when the theme has no `editorInfo` entry.

### Neutral

- **Primary Text** (`{colors.text-primary}`): body copy, labels, values, and
  the fill color of the masked wordmark.
- **Secondary Text** (`{colors.text-secondary}`): descriptions, hints, paths,
  section labels, resting icon buttons. The workhorse of a dense readout.
- **Panel Ground** (`{colors.surface-bg}`): the sidebar background, falling
  back to the editor background so a full-tab panel still sits on the right
  ground.
- **Hover Wash** (`{colors.surface-hover}`): the toolbar hover fill. This is
  how the system says "interactive" without a border or a shadow.
- **Hairline** (`{colors.border-default}`) and **Widget Hairline**
  (`{colors.border-widget}`): the 1px rules that do all the structural work
  shadows would do elsewhere.
- **Focus Ring** (`{colors.border-focus}`): a 1px outline, keyboard-only.

### Named Rules

**The Borrowed Palette Rule.** No literal color ships. A hex, `rgb()`, or
`hsl()` value may appear only as the second argument of a `var()` fallback —
never as the value itself. `test/webview.cssTokens.test.js` fails the build on
any token used but not declared; the no-literal half is the rule this file
carries. The single sanctioned exception is `.alp-boot-error` in `styles.css`,
which paints `#f88` because it only renders when React failed to mount and
legibility outranks theming.

**The Selected-Not-Suggested Rule.** `{colors.accent}` marks what is currently
selected — an active toggle, a chosen segment. It never marks what to do next.
The primary action stays on `{colors.button-bg}`. Two saturated fills competing
on one screen is how a panel stops reading as chrome.

**The Status-Only Color Rule.** Green, amber, red, and blue appear only where
something is reporting state. A surface that is not reporting anything has no
color of its own — it is text on ground, separated by a hairline.

## Typography

**UI Font:** the workbench font (`var(--vscode-font-family)`, falling back to
`system-ui, sans-serif`) — one family for everything.
**Mono Font:** a concrete stack (`ui-monospace, SFMono-Regular, "SF Mono",
Menlo, Monaco, Consolas, "Cascadia Code", "Liberation Mono", "Courier New",
monospace`), deliberately *not* `var(--vscode-editor-font-family)`.

**Character:** there is no pairing to admire. One sans family carries the whole
interface at workbench density, and monospace appears only where a value must
be read character by character — a register, a path, a version, a diagnostic
code. The hierarchy is built from six close steps, not from dramatic contrast:
the largest text in the system is seven pixels bigger than the smallest.

### Hierarchy

- **Display** (600, `calc(var(--vscode-font-size) + 7px)` — 20px at the 13px
  default): panel titles only, one per view.
- **Headline** (600–700, `+3px` — 16px, line-height 1.3): section headings,
  Markdown `h1`, and large counted values in status readouts.
- **Title** (600, `+1px` — 14px): step headings and sub-panel titles.
- **Body** (400, `var(--vscode-font-size)` — 13px, line-height 1.5): all
  running text, labels, descriptions, and control text. Prose is capped at
  `--prose-max` (90ch), not by pixels.
- **Label** (600, `-1px` — 12px, letter-spacing 0.04em, uppercase): section
  labels and captions. Also the size for monospace paths and hints.
- **Micro** (`-2px` — 11px): badges and micro-metadata only.

### Named Rules

**The Workbench Anchor Rule.** Every type size is a `calc()` offset from
`--vscode-font-size`. No hardcoded px in type, ever. A user who raises their
editor font size raises ours — that is the whole point of being a guest.

**The Uppercase Label Rule.** Uppercase plus letter-spacing is reserved for
section labels (0.04em in shared layout, 0.7px in the Overview). Buttons,
headings, and body text are never uppercased; VS Code does not shout, so
neither do we.

**The Path Font Rule.** File paths in lists and chrome use the *sans* UI font,
not monospace — VS Code renders paths in the workbench font, and matching it is
what keeps a truncated path from looking pasted in.

## Layout

Two width tokens decide everything. `--content-max` (1600px) caps the page
shell — wide enough to use a real monitor, narrow enough that a toolbar does
not stretch across a 5K display. `--prose-max` (90ch) caps running text, in
characters rather than pixels so it tracks the font: past roughly 90 characters
the eye loses the line start on the way back. Both replaced a scatter of
per-view caps (640, 720, 860, 920) that left most of a wide editor empty.

The spacing scale is fine-grained at the bottom and coarse at the top —
2, 4, 6, 8, 12, 16, 20, 24, 32px — because workbench density lives in the 4–12px
range and only page-level padding needs 24–32px. Section shells pad
`8px 12px`; full-tab views pad `24px 32px`.

Grids are intrinsic. Status cards use `repeat(auto-fit, minmax(260px, 1fr))`,
so the last row expands rather than leaving phantom tracks; catalogs and
template pickers use `auto-fill` at 260px, 220px, 160px, and 150px depending on
how much each tile must say. Toolbars and chip rows simply `flex-wrap`.

### Named Rules

**The No-Breakpoint Rule.** The system ships zero width-based media queries. The
only four `@media` blocks in the entire codebase are
`prefers-reduced-motion: reduce`. A panel can be 300px wide docked in the
sidebar or 2000px wide as a full tab, and the same grid handles both. Adding a
breakpoint means the intrinsic layout was wrong first.

**The Two-Measure Rule.** Card grids, tables, and toolbars take
`--content-max` and use the whole window. A paragraph takes `--prose-max` and
does not. These are different jobs and must not share one cap.

## Elevation & Depth

This system is flat, and not by accident. In 3,821 lines of CSS there is
exactly one `box-shadow`. Depth is carried by a 1px border and a tonal shift:
`{colors.surface-hover}` for interactive response, `{colors.border-widget}` for
structural separation, and a `color-mix(in srgb, var(--text-primary) 4%,
transparent)` wash for the Overview's top bar. Nothing floats, because nothing
in a workbench floats.

### Shadow Vocabulary

- **Popover Lift** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)`): the
  configurator's dropdown menu, the one layer that escapes the document flow
  and overlaps content beneath it.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest and flat on hover.
`box-shadow` is permitted only on a layer that leaves the document flow and
covers content it does not own — today, exactly one dropdown. A card, a row, a
button, or a panel that reaches for a shadow is solving a hierarchy problem
that a border and a tonal shift should have solved.

## Shapes

The corner language is deliberately tight. `--radius-sm` (2px) is the workhorse
for controls — buttons, inputs, links, inline code, skeleton lines — 23 uses.
`--radius-md` (3px) belongs to containers and icon buttons — cards, dropdown
panels, section icon buttons — 22 uses. `--radius-lg` (8px) appears five times,
on the larger composite blocks: the configurator's `.card`, `.core` and
`.advCard`, and the Overview's `.statusCard` and `.panelCard`. `--radius-xl`
(10px) is the badge pill — all three of its uses are a `.badge`.
`--radius-full` (9999px) is the fully-rounded end, 14 uses: three are actual
circles (the stepper dot, the spinner, the loading ring inside a button); the
other eleven are pills, chips and the scrollbar thumb, whose height decides the
corner.

Counts are measured from `packages/alp-webview/src/**/*.css`, not remembered.
They moved once already: seven `border-radius` declarations wrote a raw pixel
value instead of a token, four of them off the scale entirely, and snapping
them to their nearest token (#558) changed four of the five numbers above.
`test/webview.cssTokens.test.js` now fails the build on a bare `border-radius`
literal, so the next drift is caught rather than counted later.

Borders are always exactly 1px, except the stepper's dot and connector, which
use 1.5px so a 22px circle does not read as hairline-thin at 100% zoom.
Nothing is clipped, masked, or angled — with one exception: the `ALP LAB`
wordmark is painted as a CSS mask over `{colors.text-primary}` rather than
shipped as a colored asset, so it inverts correctly between light and dark
themes with no second file.

### Named Rules

**The Two-Pixel Rule.** Controls get 2px, containers get 3px. If a new surface
wants 12px or 16px, it has drifted out of the workbench and into a product
someone would call "an app."

## Components

Every variant in this system is a `data-*` attribute on a single base class,
not a second class name. `data-appearance` on buttons, `data-padding` on cards,
`data-variant` on chips, `data-status` on stepper steps, `data-error` on
fields. This keeps CSS Modules flat and makes state inspectable in the DOM.

### Buttons

Restrained and native — a user should assume the button belongs to VS Code.

- **Shape:** near-square corners (2px, `--radius-sm`), no border on filled
  variants, `inline-flex` with a 4px gap so an icon and its label stay locked.
- **Padding:** `4px 12px` (`--space-2 --space-5`), line-height 1.4, nowrap.
- **Primary:** the theme button fill on the theme button foreground; hover
  swaps to `{colors.button-hover-bg}`.
- **Accent:** `{colors.accent}` on `{colors.accent-fg}`; hover applies
  `filter: brightness(1.08)` rather than a second color, because there is no
  second theme variable to swap to. Toggles and segmented controls only.
- **Secondary:** `{colors.surface-btn-secondary}` on primary text; hover
  deepens to the `-hover` alias.
- **Ghost:** transparent with a 1px hairline; hover fills with
  `{colors.surface-hover}`.
- **Danger:** transparent with an error-colored border *and* text; hover fills
  with the theme's error-validation background. Destructive actions are
  outlined, never filled — a filled red button invites the click it is warning
  about.
- **Disabled:** `opacity: 0.4` plus `pointer-events: none`; no color change.
- **Loading:** a 12px `currentColor` ring with a transparent top edge spins at
  `--duration-slow`, and the button reports `aria-busy`.
- **Focus:** 1px `{colors.border-focus}` outline at `outline-offset: 2px`,
  keyboard-only via `:focus-visible`.

### Cards / Containers

- **Corner style:** 3px (`--radius-md`), `overflow: hidden`.
- **Background:** `{colors.surface-bg}`; **Border:** 1px
  `{colors.border-default}`.
- **Shadow strategy:** none. See Elevation & Depth.
- **Internal padding:** four steps via `data-padding` — `none`, `sm` (8px),
  `md` (16px, default), `lg` (24px).
- **State:** only `border-color` transitions, at `--duration-base`.

### Inputs / Fields

- **Style:** theme input background, 1px theme input border, 2px radius,
  `4px 8px` padding, full width.
- **Focus:** border shifts to `{colors.border-focus}` *and* a 1px outline is
  drawn at `outline-offset: -1px`, so the ring sits inside the control instead
  of nudging layout.
- **Error:** `data-error` on the wrapper turns the label, the border, and the
  message error-colored in one move — the label is not left neutral while the
  border shouts.
- **Anatomy:** label (600 weight) → input → hint or error, stacked with a 4px
  gap. Hint and error both render at 12px.

### Chips

- **Style:** a 10px pill, `1px 6px` padding, 12px at 600 weight, foreground
  always `{colors.badge-fg}` with only the background changing per state.
- **States:** `ready` → "Ready" on pass green; `setup-required` → "Action
  Required" and `not-updated` → "Update Needed", both on attention amber;
  `not-installed` → "Missing" on failure red. The label is part of the
  component, not the caller's copy.

### Navigation

Navigation in this system is progress, not a menu. A horizontal `Stepper` runs
across the top of every wizard; a `StepperNav` runs across the bottom, split
`space-between` above a 1px top border with trailing actions pushed right.

- **Dot:** 22px circle, 1.5px border, 12px 600-weight numeral. Neutral at rest,
  theme-button fill when `active`, pass green when `complete`, failure red on
  `error`.
- **Connector:** a 1.5px line that fills with pass green once the step behind
  it is complete, centered against the dot with an explicit 10px offset —
  `(22 − 1.5) / 2`.
- **Vertical mode:** `data-direction="vertical"` flips the axis, unwraps
  titles, and grows them from 12px to 13px, because a vertical rail has the
  width to spell things out.

### Signature Component — the Icon set

27 hand-drawn icons in a single `Icon` component: 24×24 viewBox, `fill: none`,
`stroke: currentColor`, `strokeWidth: 1.6`, round caps and joins, default
rendered size 20px, always `aria-hidden` and `focusable="false"`. No icon font,
no Lucide, no Heroicons, no `<img>`. Because every icon is `currentColor`, an
icon inside a ghost button, a section header, or an empty state simply inherits
whatever the surrounding text is doing — including the error color when its
field fails.

#### Named Rules

**The No-Emoji Rule.** No emoji ships. That means every pictograph
(`U+1F000–U+1FAFF`), every Miscellaneous Symbol and Dingbat
(`U+2600–U+27BF`) — including `✓`, `✗`, and `⚠` used as status markers — the
emoji-presentation selector `U+FE0F`, the zero-width joiner `U+200D`, the
regional-indicator flags (`U+1F1E6–U+1F1FF`), and the emoji-by-default slices at
`U+23E9–U+23FA` (`⏳ ⏰ ⏱`) and `U+2196–U+21AA`. In the webview the replacement is
the line-icon set — `<Icon name="check" />`, `<Icon name="x" />`,
`<Icon name="warning" />` — never a character. In the extension host it is a
`ThemeIcon` or a `$(codicon)` string, and only on the four surfaces that render
one: QuickPick, StatusBarItem, TreeItem, MarkdownString. Notifications and
output channels render neither, so there the replacement is words, or a
bracketed ASCII tag matching the channel's existing `[cli] ` shape — `[ok]`,
`[fail]`.

**The Typography-Is-Not-Emoji Rule.** The ban stops at pictographs. `→ ⇒ ⇔ ↔ ×
· § ⊆ — … ° ± ≤ ≥` and the Box Drawing set (`└ ├ ─ │`) are legal everywhere, in
UI copy and in comments. This boundary is load-bearing, not a detail: roughly
150 `→` live in this repo's comments and test names, and a rule that reds on
`a → b` is a rule someone deletes. Widening a range — `U+2300–U+23FF` instead of
`U+23E9–U+23FA`, or the whole Arrows block instead of `U+2196–U+21AA` — breaks
correct code on the first run.

### Signature Component — the Skeleton shimmer

Loading is a 1.5s horizontal gradient sweep between the editor background and
`{colors.surface-hover}` at 200% background-size — theme-derived, so it
disappears into light and dark equally. Lines default to 14px with a 4px gap.
It is the only continuous animation in the system, and it stops entirely under
`prefers-reduced-motion`.

### Motion

Three durations (`--duration-fast` 100ms, `--duration-base` 150ms,
`--duration-slow` 250ms) and two curves (`--ease-out`
`cubic-bezier(0.16, 1, 0.3, 1)` for entrances, `--ease-in-out`
`cubic-bezier(0.4, 0, 0.2, 1)` for continuous loops). Transitions carry
`background`, `color`, `border-color`, `opacity`, and `transform` — never
`box-shadow`, since there is nothing to transition. Entrances use a single
shared `fadeIn` (opacity plus a 4px rise). All three durations are redefined to
`0ms` under `prefers-reduced-motion: reduce`, which switches the whole system
off at the token layer instead of per-rule.

## Do's and Don'ts

### Do:

- **Do** resolve every color through a semantic alias in `tokens.css`. If the
  alias you need does not exist, add it there — one `--vscode-*` mapping in one
  file — rather than reaching for `--vscode-*` in a feature stylesheet.
- **Do** size type as a `calc()` offset from `--vscode-font-size`, and space it
  on the `--space-*` scale.
- **Do** express variants as `data-*` attributes on one base class.
- **Do** reach for `repeat(auto-fit, minmax(<min>, 1fr))` when a grid must
  survive a 300px sidebar and a 2000px tab.
- **Do** use the 27-icon stroke set for iconography; it inherits `currentColor`
  and matches VS Code's own line-icon language.
- **Do** keep `→ ⇒ ↔ × · § — …` and Box Drawing characters — they are
  typography, not emoji, and banning them is how a no-emoji gate gets deleted.
- **Do** outline destructive actions in `{colors.status-err}` rather than
  filling them.
- **Do** give a `var()` a fallback whenever the variable can resolve *empty* —
  `--vscode-editor-font-family` does, and a `var()` fallback cannot rescue a
  property that was set to nothing.

### Don't:

- **Don't** ship an emoji — not in JSX text, not in a QuickPick or notification
  string, not in a tree-item label, not in a contributed command title, not in
  an `icon:` field on the wire. `📦 🧪 📄 ⏳ ✓ ✗ ⚠` are all out; an `<Icon>` or a
  `$(codicon)` takes their place. See The No-Emoji Rule.
- **Don't** write a literal `#hex`, `rgb()`, or `hsl()` as a property value.
  Fallback arguments inside `var()` are the only place a literal belongs.
- **Don't** add a width-based `@media` query. Fix the intrinsic layout instead.
- **Don't** add a `box-shadow` to anything that stays in the document flow.
- **Don't** use `{colors.accent}` for a call to action; it means "this one is
  selected," and a second saturated fill on screen destroys that meaning.
- **Don't** hardcode a px font size, a px gap outside the `--space-*` scale, or
  a radius above 3px on a control or container.
- **Don't** import a UI framework, an icon package, an icon font, or a webfont.
  The panels have no network access under the shell's CSP, and everything the
  system needs is already inherited from the host.
- **Don't** dress a panel as a branded product surface — a palette of its own,
  Material or Fluent elevation and ripple, a hero image, a gradient, or a
  celebratory animation. Every one of those breaks the guest relationship the
  whole system is built on.
