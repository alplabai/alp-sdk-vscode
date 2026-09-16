// SPDX-License-Identifier: Apache-2.0
//
// Two rules, not one, because the swatch encodes authority on TWO different
// channels and each needs its own gate:
//
//   1. Every tier, on its own, must be visible against the panel ground —
//      an ink too faint to see is a defect regardless of what tells tiers
//      apart from each other. Plain 3:1 non-text contrast, unconditional.
//
//   2. Every PAIR of tiers must be told apart from one another — but not
//      necessarily by ink. `yours` and `unproven` are deliberately the SAME
//      colour (both resolve `var(--text-primary)` at full strength) and are
//      told apart by PATTERN — solid fill vs hatch — precisely so the
//      difference "survives a greyscale display and does not rest on
//      lightness alone" (AuthoritySwatch.module.css). Two identical colours
//      contrast at exactly 1.00:1 no matter what percentage either tier's
//      CSS declares — that is not a defect to chase with a different
//      percentage, it is the point: pattern is carrying the distinction
//      instead of tone. A prior version of this gate compared ink alone and
//      demanded 1.5:1 between every pair, including `yours` vs `unproven`;
//      that demanded a difference on a channel the design never put one on,
//      and a gamut scan across every covered theme proved no percentage
//      could ever satisfy it (VS Code's own Light+/Dark+/2026-Dark
//      foreground-vs-background pairs are not far enough apart to fit three
//      pairwise-1.5:1 achromatic tiers between a 3:1 floor and full ink,
//      full stop). So: a pair whose PATTERNS differ is already
//      distinguishable and needs no ink check; a pair that shares a pattern
//      (only `yours` vs `locked` does — both a flat fill, differing solely
//      in density) still needs its ink apart by 1.5:1, because density is
//      the ONLY channel they have.
//
// A third check, below, is neither of these: it does not measure contrast at
// all, only that the SET of tiers `AuthoritySwatch.tsx`'s `data-tier` prop
// can ever be given a value from (its `AuthorityTier` type) is exactly the
// set of tiers `AuthoritySwatch.module.css` has a `[data-tier="…"]` rule
// for. Nothing else in this file would notice a mismatch there: rules 1 and
// 2 above only ever look tiers up BY NAME out of a fixed
// `["yours","locked","unproven"]` list, so a CSS rule renamed or dropped, or
// a fourth tier added to the type without a matching rule, would silently
// stop being checked rather than fail.
//
// A fourth set of checks, also below, closes a gap the third one cannot see:
// the union-versus-selectors arm reads `authorityTier.ts`'s TYPE and the
// CSS's selectors — neither one observes what `AuthoritySwatch.tsx` actually
// EMITS. A component that hardcodes `data-tier="yours"` regardless of its
// own `tier` prop, one that drops the `data-tier={tier}` attribute
// entirely, or one that returns `null`, all still satisfy every check above
// while painting nothing real. These three are component-anchored,
// source-text only (no render, no React, no jsdom — the component is
// mounted nowhere yet; a real render assertion belongs to the task that
// first mounts it), each tied to one of those three mutations.
//
// A fifth pair, also below, holds the memory chart's authority GUTTER
// (MemoryChart.module.css) to rules 1 and 2 above — the same three-tier
// vocabulary, painted as SVG `fill` rather than swatch `background`, would
// otherwise ship with no contrast gate of its own at all.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  THEMES,
  resolvedOpaqueRgb,
  contrast,
} = require("./helpers/vscodeThemes");
const { swatchInk } = require("./helpers/swatchInk");
const {
  gutterInk,
  gutterSelectionRingRgb,
  hatchPatternIdInTsx,
  hatchPatternIdInCss,
} = require("./helpers/gutterInk");
const { readDistCss } = require("./helpers/distCss");

/** Escapes a literal for use inside a `RegExp` — the hashed class names below
 * are read out of the built CSS, not written by hand, so they can carry any
 * of CSS Modules' hash characters. */
function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BUILD_PLAN_DIR = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
);
const COMPONENT_TSX = path.join(BUILD_PLAN_DIR, "AuthoritySwatch.tsx");
const AUTHORITY_TIER_TS = path.join(BUILD_PLAN_DIR, "authorityTier.ts");
const MODULE_CSS = path.join(BUILD_PLAN_DIR, "AuthoritySwatch.module.css");

/** The `AuthoritySwatch` function's own body — the balanced-brace region
 * between its opening `{` and matching closing `}` — so the three checks
 * below read what THIS function renders, not `AuthorityLegend`'s JSX
 * elsewhere in the same file (which invokes `<AuthoritySwatch ... />` as a
 * component, not as a literal `data-tier` attribute). */
function authoritySwatchBody(componentSrc) {
  const marker = "export function AuthoritySwatch(";
  const marked = componentSrc.indexOf(marker);
  if (marked === -1) {
    throw new Error(
      "could not find `export function AuthoritySwatch(` in AuthoritySwatch.tsx",
    );
  }
  // Skip the PARAMETER list paren-balanced first — it is itself
  // `({ tier }: { tier: AuthorityTier })`, so the first `{` after the
  // marker is the destructuring brace, not the function body's.
  const paramsOpenParen = marked + marker.length - 1;
  let parenDepth = 0;
  let paramsCloseParen = -1;
  for (let i = paramsOpenParen; i < componentSrc.length; i++) {
    const c = componentSrc[i];
    if (c === "(") parenDepth++;
    if (c === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        paramsCloseParen = i;
        break;
      }
    }
  }
  if (paramsCloseParen === -1) {
    throw new Error(
      "could not find the end of AuthoritySwatch's parameter list",
    );
  }
  const braceStart = componentSrc.indexOf("{", paramsCloseParen);
  let braceDepth = 0;
  for (let i = braceStart; i < componentSrc.length; i++) {
    const c = componentSrc[i];
    if (c === "{") braceDepth++;
    if (c === "}") {
      braceDepth--;
      if (braceDepth === 0) return componentSrc.slice(braceStart + 1, i);
    }
  }
  throw new Error(
    "could not find the closing brace of AuthoritySwatch's function body",
  );
}

test("each swatch tier clears 3:1 against the panel ground in every covered theme", () => {
  for (const theme of THEMES) {
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    for (const tier of ["yours", "locked", "unproven"]) {
      const ratio = contrast(swatchInk(theme, tier).rgb, ground);
      assert.ok(
        ratio >= 3,
        `swatch tier ${tier} vs panel ground in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    const tiers = {
      yours: swatchInk(theme, "yours"),
      locked: swatchInk(theme, "locked"),
      unproven: swatchInk(theme, "unproven"),
    };
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      const A = tiers[a];
      const B = tiers[b];
      if (A.pattern !== B.pattern) {
        // Different pattern (solid vs hatch) is its own distinguishing
        // channel — no ink separation is required or expected.
        continue;
      }
      const ratio = contrast(A.rgb, B.rgb);
      assert.ok(
        ratio >= 1.5,
        `tiers ${a} and ${b} are both "${A.pattern}" and contrast at ` +
          `${ratio.toFixed(2)}:1 in ${theme} — two tiers may share a colour ` +
          "only when their patterns differ",
      );
    }
  }
});

test("the AuthorityTier set AuthoritySwatch.tsx's data-tier prop is typed against is exactly the set AuthoritySwatch.module.css styles", () => {
  // Source-text cross-check, no render needed. AuthoritySwatch.tsx's own
  // legend is DERIVED from TIER_LABEL/TIER_ORDER rather than a hand-typed
  // ["yours","locked","unproven"] array — so the tier literals that
  // actually constrain what `data-tier={tier}` can ever be are not spelled
  // out in AuthoritySwatch.tsx's own text any more; they live in
  // authorityTier.ts's `AuthorityTier` type, which AuthoritySwatch.tsx
  // imports and types its `tier` prop against. Confirm that link still
  // holds, then compare THAT type's literal members — not a copy of them —
  // against the CSS module's own `[data-tier="…"]` selectors.
  const componentSrc = fs.readFileSync(COMPONENT_TSX, "utf8");
  assert.match(
    componentSrc,
    /import\s*\{[^}]*\bAuthorityTier\b[^}]*\}\s*from\s*"\.\/authorityTier"/,
    "AuthoritySwatch.tsx no longer types its data-tier prop against " +
      "./authorityTier's AuthorityTier — this cross-check has nothing left " +
      "to verify",
  );

  const authorityTierSrc = fs.readFileSync(AUTHORITY_TIER_TS, "utf8");
  const typeMatch = /type AuthorityTier\s*=\s*([^;]+);/.exec(authorityTierSrc);
  assert.ok(
    typeMatch,
    "could not find `type AuthorityTier = ...` in authorityTier.ts",
  );
  const typeTiers = [...typeMatch[1].matchAll(/"([a-z]+)"/g)]
    .map((m) => m[1])
    .sort();

  const cssSrc = fs.readFileSync(MODULE_CSS, "utf8");
  const cssTiers = [...cssSrc.matchAll(/\.swatch\[data-tier="([a-z]+)"\]/g)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(
    typeTiers,
    cssTiers,
    `AuthorityTier's literals (${typeTiers.join(", ")}) and ` +
      `AuthoritySwatch.module.css's [data-tier="…"] selectors ` +
      `(${cssTiers.join(", ")}) have drifted apart — a tier the component ` +
      "can be given no longer has a rule to paint it, or a CSS rule exists " +
      "for a tier the component can never be given.",
  );
});

test("AuthoritySwatch's span actually carries data-tier={tier} — kills a dropped attribute", () => {
  const body = authoritySwatchBody(fs.readFileSync(COMPONENT_TSX, "utf8"));
  assert.ok(
    body.includes("data-tier={tier}"),
    "AuthoritySwatch.tsx no longer binds data-tier={tier} on its <span> — " +
      "a swatch would render with no tier attribute at all, and " +
      'AuthoritySwatch.module.css\'s [data-tier="…"] rules would match nothing',
  );
});

test("AuthoritySwatch never hardcodes a data-tier literal — kills a fixed value", () => {
  const body = authoritySwatchBody(fs.readFileSync(COMPONENT_TSX, "utf8"));
  const literal = /data-tier="([^"]*)"/.exec(body);
  assert.ok(
    literal === null,
    literal
      ? `AuthoritySwatch.tsx hardcodes data-tier="${literal[1]}" on its ` +
          "<span> — every swatch would paint that one tier regardless of " +
          "its own tier prop"
      : undefined,
  );
});

test("AuthoritySwatch actually renders a <span className={styles.swatch}> — kills a return null", () => {
  const body = authoritySwatchBody(fs.readFileSync(COMPONENT_TSX, "utf8"));
  assert.ok(
    /<span\b/.test(body) && body.includes("className={styles.swatch}"),
    "AuthoritySwatch.tsx no longer renders a <span className={styles.swatch}> " +
      "— it may return null (or something else) and paint nothing the CSS " +
      "module's rules can ever match",
  );
});

// ---------------------------------------------------------------------------
// The swatch's [data-tier] rules, against the BUILT artifact (Task 6).
//
// Carried forward from Task 2, where it was correctly impossible: every check
// above reads AuthoritySwatch.module.css's SOURCE, because until Task 6
// nothing imported `AuthorityLegend`/`AuthoritySwatch` and `dist/main.css`
// carried zero `data-tier` rules at all — there was nothing built to read.
// `MemoryTable` (Task 4) already renders `<AuthoritySwatch>` per row, so by
// the time this task lands the rules are almost certainly in the bundle
// already; rendering `AuthorityLegend` in `MemoryRegions.tsx` is what makes
// this the first task that can assert it, not what first causes it.
//
// ANCHORED ON THE SWATCH'S OWN HASHED CLASS, not on any hashed class
// followed by `[data-tier=...]` — the same mistake `chartContrast.test.js`'s
// gutter check corrected after further testing proved an unscoped regex
// stayed green with every `.gutter[data-tier]` rule deleted, because
// `AuthoritySwatch.module.css`'s OWN `.swatch[data-tier="…"]` rules
// satisfied it instead. Here the risk runs the other way: `MemoryChart`'s
// authority gutter (MemoryChart.module.css) paints the identical three-tier
// vocabulary as SVG `fill` in the SAME bundle, so a bare `[data-tier=` match
// would stay green on the gutter's rules alone even with every one of the
// swatch's own deleted.
//
// `builtSwatchClass` finds `.swatch`'s hashed name through `width: 6px` — a
// single declaration confirmed unique across the WHOLE built stylesheet
// (`dist/main.css` today has exactly one occurrence of the literal
// `width:6px`), the same one-property-unique-to-it idiom
// `chartContrast.test.js`'s `builtGutterClass` uses for `.gutter`'s own
// `pointer-events: none`. `background:`, not `fill:`, is what tells the two
// components' rules apart even when both carry `[data-tier="…"]` —
// `AuthoritySwatch.module.css` paints an HTML `<span>`, `MemoryChart`'s
// gutter an SVG `<rect>` — but the width anchor already scopes the match to
// the right class before that distinction would even matter.
function builtSwatchClass(distCss) {
  const re = /\._([\w-]+)\{[^}]*\bwidth:6px\b[^}]*\}/;
  const m = re.exec(distCss);
  if (!m) {
    throw new Error(
      "could not find the built .swatch base rule (width: 6px) in " +
        "dist/main.css — run `pnpm run compile`",
    );
  }
  return m[1];
}

test("the swatch's three [data-tier] rules survive the build (verified against the built artifact, not just source)", () => {
  const distCss = readDistCss();
  const swatchClass = builtSwatchClass(distCss);
  for (const tier of ["yours", "locked", "unproven"]) {
    const re = new RegExp(
      `\\._${escapeForRegExp(swatchClass)}\\[data-tier=(?:"${tier}"|${tier})\\]`,
    );
    assert.ok(
      re.test(distCss),
      `dist/main.css has no ._${swatchClass}[data-tier=${tier}] rule — CSS ` +
        "Modules source alone cannot show this: the class is hashed at " +
        "build time and only the compiled output proves the rule reaches " +
        "a real selector, not the memory chart's authority gutter's " +
        "identically-shaped one",
    );
  }
});

// ---------------------------------------------------------------------------
// The memory chart's authority GUTTER (#484 phase 4) — a second reader of the
// identical three-tier vocabulary, in `MemoryChart.module.css` rather than
// `AuthoritySwatch.module.css`, drawn as SVG `fill` rather than CSS
// `background`. It is held to the SAME two criteria as the swatch above: on
// its own, each tier clears 3:1 against the panel ground; pairwise, two tiers
// sharing a pattern (only `yours` vs `locked`, a flat fill both times) still
// need 1.5:1 of their own. Introducing a THIRD colour surface for the same
// three tiers, with no test reading what it actually paints, is exactly the
// kind of gap a gate that only ever looked at `AuthoritySwatch.module.css`
// would never see — see `gutterInk.js`'s own header for why this reuses
// `swatchInk.js`'s parsing rather than a second hand-rolled regex.

test("each gutter tier clears 3:1 against the panel ground in every covered theme", () => {
  for (const theme of THEMES) {
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    for (const tier of ["yours", "locked", "unproven"]) {
      const ratio = contrast(gutterInk(theme, tier).rgb, ground);
      assert.ok(
        ratio >= 3,
        `gutter tier ${tier} vs panel ground in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the gutter's three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    const tiers = {
      yours: gutterInk(theme, "yours"),
      locked: gutterInk(theme, "locked"),
      unproven: gutterInk(theme, "unproven"),
    };
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      const A = tiers[a];
      const B = tiers[b];
      if (A.pattern !== B.pattern) {
        // Different pattern (solid vs hatch) is its own distinguishing
        // channel — no ink separation is required or expected.
        continue;
      }
      const ratio = contrast(A.rgb, B.rgb);
      assert.ok(
        ratio >= 1.5,
        `gutter tiers ${a} and ${b} are both "${A.pattern}" and contrast at ` +
          `${ratio.toFixed(2)}:1 in ${theme} — two tiers may share a colour ` +
          "only when their patterns differ",
      );
    }
  }
});

// The SELECTED state's own ring was found under this same 3:1
// floor: `--border-focus` (== --accent) measured as low as 1.85:1 (Light+)
// against the "yours" fill, four of five covered themes under the bar this
// file already holds the fills themselves to. A same-family accent ring on
// an accent-adjacent fill is not a channel a reader can rely on — this is
// the "ring vs fill" measurement that inference alone (ring vs ground) does
// not prove, because a selected region's ring sits ON the fill, not beside
// the panel ground.
test("the gutter's selection ring clears 3:1 against every tier's own fill in every covered theme", () => {
  for (const theme of THEMES) {
    const ring = gutterSelectionRingRgb(theme);
    for (const tier of ["yours", "locked", "unproven"]) {
      const fill = gutterInk(theme, tier).rgb;
      const ratio = contrast(ring, fill);
      assert.ok(
        ratio >= 3,
        `gutter selection ring vs "${tier}" fill in ${theme}: ` +
          `${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

// `gutterInk` above reads ONLY MemoryChart.module.css's side of the hatch:
// `.hatchStroke`'s own colour. It cannot see the OTHER half of the linkage —
// whether `.gutter[data-tier="unproven"]`'s `fill: url(#...)` id actually
// matches the `<pattern id="...">` MemoryChart.tsx mounts in `<defs>`. Break
// that link (rename `HATCH_PATTERN_ID` in MemoryChart.tsx, leave the CSS
// alone) and every test above still passes, while the "unproven" tier paints
// nothing at all in a real browser: an unresolvable SVG paint reference with
// no fallback renders as `none`, not as a default colour.
test("the hatch pattern id MemoryChart.tsx mounts matches the id MemoryChart.module.css references", () => {
  assert.equal(
    hatchPatternIdInTsx(),
    hatchPatternIdInCss(),
    "MemoryChart.tsx's HATCH_PATTERN_ID and MemoryChart.module.css's " +
      '.gutter[data-tier="unproven"] { fill: url(#...) } have drifted apart ' +
      "— the unproven tier would paint nothing at all",
  );
});
