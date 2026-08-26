// SPDX-License-Identifier: Apache-2.0
//
// What happens to the Template step's answer when the catalogue moves
// underneath it (#591).
//
// Kept out of `NewProjectFlowView.tsx` for the same reason `coreChoices.ts` is:
// the rule is a case that is awkward to stage in a DOM and trivial to state as
// a function.

/** The fields of a template this rule needs. */
export interface TemplateIdentity {
  id: string;
}

/**
 * The template selection that survives an arriving catalogue.
 *
 * Returns the selection UNCHANGED when it is still valid, and `""` only when
 * the catalogue genuinely no longer has it. Keeping the answer is the common
 * case — most SDKs ship the same starters, and dropping a choice the customer
 * already made, for nothing, is its own defect.
 *
 * `null` templates mean the catalogue is still in flight: there is nothing to
 * judge the selection against yet, so it is returned untouched. Treating a
 * pending fetch as an empty catalogue would clear the answer on every reload.
 *
 * A caller detects the drop by comparing: a result different from the input is
 * a selection that was removed.
 */
export function reconcileTemplateSelection(
  selected: string,
  templates: TemplateIdentity[] | null,
): string {
  if (selected === "") return "";
  if (templates === null) return selected;
  return templates.some((t) => t.id === selected) ? selected : "";
}
