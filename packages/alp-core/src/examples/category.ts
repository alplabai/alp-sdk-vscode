// SPDX-License-Identifier: Apache-2.0
//
// Which heading does an SDK example belong under? (#482 §2)
//
// The New Project picker listed all 100 SDK examples as one flat block. #482's
// worked case: a user on `E1M-AEN801` scaffolded `aen/aen-analog-validate` — a
// single-core DAC0 → ADC loopback demo — and reasonably concluded the wizard
// had ignored half the SoM. Nothing in the list distinguished one example from
// the next.
//
// ---------------------------------------------------------------------------
// WHERE THE CATEGORY COMES FROM, AND WHY THIS IS NOT A RE-DERIVATION
// ---------------------------------------------------------------------------
//
// tan's `examples` envelope carries `id`, `sourceDir`, `title`, `description`
// and nothing else — measured against the pinned v0.6.0-rc1's own published
// `envelope-contract.json`, not assumed from the issue, which was written
// against an older pin. So `ex.category` is not on the wire today.
//
// It is, however, structural rather than editorial. In the SDK's
// `metadata/catalog.json` the examples are grouped BY category, and every one
// of the 100 entries has `path === examples/<category>/<name>` — 100/100,
// measured, no exceptions — while tan's `sourceDir` is that path with the
// `examples/` prefix dropped (`multicore/rpmsg-v2n`). The leading segment IS
// the category; it is not a guess about one.
//
// So this reads what tan already sends, and defers the moment tan sends the
// fact outright: an explicit `category` always wins. That ordering is the
// whole safety property — the day tan forwards a category that disagrees with
// the directory, the producer is right and this stops guessing, with no change
// here. Nothing in this module opens `metadata/catalog.json`; SDK metadata
// reaches this extension through the CLI, and a second filesystem scanner is
// exactly what that rule exists to prevent.
//
// What CANNOT be derived, and is therefore not attempted: core count, OS set
// and SoM SKU (#482 §3/§4). #482 measured that the raw `board.yaml` disagrees
// with the resolved topology for almost every example — 96 look single-core
// where 23 are — so a locally-computed filter would mislabel the list. Those
// wait for the producer.

/** The fields this needs from one `tan examples` row. */
export interface ExampleCategorySource {
  id: string;
  /** Relative path inside `examples/`, e.g. `multicore/rpmsg-v2n`. */
  sourceDir?: string | null;
  /** tan's own category, once it sends one. Always wins when present. */
  category?: string | null;
}

/** First path segment of `value`, or null when it carries no `/`. */
function leadingSegment(value: string | null | undefined): string | null {
  if (!value) return null;
  // Normalise the separator: `sourceDir` is a RELATIVE path built by the
  // producer, and a Windows-built catalogue could hand back backslashes.
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const slash = cleaned.indexOf("/");
  if (slash <= 0) return null;
  const head = cleaned.slice(0, slash).trim();
  return head.length > 0 ? head : null;
}

/**
 * The heading an example renders under, or `null` when it has none.
 *
 * `null` is a real answer and the view must handle it: an example whose id
 * carries no directory belongs to no category, and inventing one ("Other",
 * "Uncategorised") would put a name on screen that exists nowhere in the SDK.
 */
export function exampleCategory(source: ExampleCategorySource): string | null {
  const declared = source.category?.trim();
  if (declared) return declared;
  return leadingSegment(source.sourceDir) ?? leadingSegment(source.id);
}
