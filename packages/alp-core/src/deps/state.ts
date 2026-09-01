// SPDX-License-Identifier: Apache-2.0
//
// The dependency table's state WORD — Ready / Will install / Needs you (#466 §1).
//
// `pass` / `warn` / `fail` are tan's verdict on a check. They do not answer the
// question someone opening this panel actually has, which is "do I have to do
// something?". A `fail` the extension can fix with one press and a `fail` that
// needs the user to go install a vendor toolchain read identically today.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT THE RE-DERIVATION `deps/planner.ts` FORBIDS
// ---------------------------------------------------------------------------
//
// planner.ts's rule is absolute and this file does not bend it: "tan owns the
// facts. Rows are DERIVED from `data.checks[]` — there is no allowlist, no
// status filter … It is never a TypeScript re-derivation — that is how
// tan-cli#104/#105 happened."
//
// The distinction that makes this legal is that **"Will install" is not a
// status — it is the presence of an action**. Both inputs are facts the
// producer already stated: `status` is tan's own word, carried verbatim, and
// the action comes from tan's `missingPrerequisites` (or, where tan named none,
// from this extension's own declared fix table — a fact about the EXTENSION,
// not a re-derivation of tan's verdict). Renaming a pair the producer already
// stated is presentation. Deciding a label by looking at `check.name` would be
// the forbidden shape, and nothing here does.
//
// The parameters are primitives rather than a `DependencyRow` for two reasons:
// it keeps this module free of an import cycle with `planner.ts`, and it makes
// the pair the doctrine turns on impossible to miss at the call site.
//
// ---------------------------------------------------------------------------
// WHY `unknown` IS A MEMBER, AND WHY IT CATCHES MORE THAN tan's `unknown`
// ---------------------------------------------------------------------------
//
// `DependencyStatus` is deliberately `string`, not a union, so that "a status
// tan adds later survives the trip instead of being coerced into today's
// vocabulary". A three-word mapping with no escape would do exactly the
// coercion that type exists to prevent: tan ships `degraded` next year and it
// silently renders as "Needs you", a claim nobody checked.
//
// So the mapping is a WHITELIST of the statuses whose meaning is settled, and
// everything else — tan's literal `unknown` included — becomes `"unknown"`.
// That is the conservative direction: an unrecognised status degrades to a
// visible "unknown" rather than being mislabelled with confidence. #466's
// acceptance criteria require `unknown` to stay visible as unknown, and this
// satisfies it for every future word too, not just that one.
//
// The row still carries tan's raw `status` untouched; this is an extra field,
// never a replacement, so nothing this file decides can lose a fact.

/**
 * What the panel says about a row, as a state rather than a verdict.
 *
 * - `ready` — tan passed the check. Nothing to do.
 * - `will-install` — the row carries an action that actually installs
 *   something, so pressing it is the whole fix.
 * - `needs-you` — tan is not happy and no action here will finish the job:
 *   either there is no button at all, or the button only opens a page.
 * - `unknown` — no claim. tan's status is one this mapping does not recognise.
 */
export type DependencyState =
  | "ready"
  | "will-install"
  | "needs-you"
  | "unknown";

/** tan statuses whose meaning is settled enough to map. Anything else is
 *  `unknown` by construction — see the header. */
const PASSING = "pass";
const NOT_PASSING = new Set(["warn", "fail"]);

/**
 * Effects that genuinely install something. `open-docs` is excluded on purpose:
 * `DependencyActionEffect`'s own docs say it "opens a web page and installs
 * NOTHING", so a row whose only action is a pointer is still the user's job and
 * must not be labelled "Will install".
 */
const INSTALLING_EFFECTS = new Set(["install", "bootstrap"]);

/**
 * The state word for one row, from the PAIR the producer already stated.
 *
 * @param status       tan's `check.status`, verbatim. Not narrowed to a union
 *                     for the reason `DependencyStatus` is not.
 * @param actionEffect the row's `action.effect`, or `null` when the row carries
 *                     no action at all.
 */
export function dependencyState(
  status: string,
  actionEffect: string | null,
): DependencyState {
  if (status === PASSING) return "ready";
  if (!NOT_PASSING.has(status)) return "unknown";
  return actionEffect !== null && INSTALLING_EFFECTS.has(actionEffect)
    ? "will-install"
    : "needs-you";
}

// There is deliberately NO label map here. The wording ("Ready", "Will
// install", …) lives only in `DependenciesView.tsx`, beside the existing
// `ACTION_LABELS`. A copy on each side of a boundary the webview cannot import
// across is the exact duplication `test/webview.payloadMirror.test.js` exists
// to catch, and a map of strings is a VALUE — the mirror gate compares types,
// so nothing would have caught the two drifting. Core decides WHICH state;
// the view decides what it is called.
