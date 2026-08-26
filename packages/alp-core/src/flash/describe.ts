// SPDX-License-Identifier: Apache-2.0
//
// The words on the flash confirm dialog. Pure, and separate from the planner
// so the text is directly assertable: a consent screen whose wording is only
// reachable through a `vscode` modal is a screen no test can read.
//
// NOTHING HERE SUMMARISES. Every identifier the manifest carries is printed
// verbatim and in full — `core_id`, `flash_method`, `status`, `chip`,
// `firmware_path`, `flash_args`, the absolute project directory, the absolute
// manifest path. That is the repo's data-fidelity rule, and on this screen it
// is also the whole point: the reader is being asked to authorise an
// irreversible write, and a rounded or abbreviated identifier is how the wrong
// module gets flashed.

import type { FlashConsentPlan, FlashEntry } from "./consent";

/** Where the run will happen, for the lines the manifest cannot supply. */
export interface FlashConsentContext {
  /** The directory the run's `cwd` is — the project being flashed. */
  projectDir: string;
  /** The manifest the plan was built from. */
  manifestPath: string;
}

/** Printed where the manifest states nothing, so a short line is never
 *  mistaken for a complete one. */
const NOT_STATED = "(not stated)";

/** `flash_args` verbatim: an object as JSON, a bare string quoted as a string
 *  (so `"TBD"` can never be misread as a resolved recipe), absence named. */
function renderFlashArgs(value: FlashEntry["flashArgs"]): string {
  if (value === null || value === undefined) return NOT_STATED;
  return JSON.stringify(value);
}

/** One entry, with every field the manifest gave it. */
function renderEntry(entry: FlashEntry): string {
  const fields =
    entry.kind === "slice"
      ? [
          `os ${entry.os ?? NOT_STATED}`,
          `status ${entry.status ?? NOT_STATED}`,
          `flash_method ${entry.flashMethod ?? NOT_STATED}`,
          `flash_args ${renderFlashArgs(entry.flashArgs)}`,
        ]
      : [
          `chip ${entry.chip ?? NOT_STATED}`,
          `flash_method ${entry.flashMethod ?? NOT_STATED}`,
          `firmware_path ${entry.firmwarePath ?? NOT_STATED}`,
          `flash_args ${renderFlashArgs(entry.flashArgs)}`,
        ];
  const head = `  ${entry.kind} ${entry.id} — ${fields.join(", ")}`;
  return [head, ...entry.notes.map((note) => `      ! ${note}`)].join("\n");
}

/** The scope clause, in the CLI's own terms, or the whole-project statement. */
function renderScope(plan: FlashConsentPlan): string {
  if (plan.scope.coreId !== null) {
    return (
      `Scope: --core ${plan.scope.coreId} — tan flashes ONLY that slice and ` +
      "skips every other slice AND all helper MCUs. This is not a whole-board " +
      "write; the parts listed as skipped keep whatever is on them now."
    );
  }
  if (plan.scope.helperName !== null) {
    return (
      `Scope: --helper ${plan.scope.helperName} — tan flashes ONLY that ` +
      "helper MCU and skips ALL slices and every other helper."
    );
  }
  return "Scope: the whole project — every slice and every helper MCU below.";
}

/**
 * The dialog's one-line question. No absolute path: `NotificationPlan.message`
 * carries the customer-facing sentence and paths belong in the detail, which
 * for a modal is rendered ON the dialog (`planConfirm`).
 */
export function flashConsentMessage(plan: FlashConsentPlan): string {
  const board = plan.sku.length > 0 ? plan.sku : "this device";
  if (plan.scope.coreId !== null) {
    return `Alp: flash core ${plan.scope.coreId} on ${board}? This writes to the device.`;
  }
  if (plan.scope.helperName !== null) {
    return `Alp: flash helper MCU ${plan.scope.helperName} on ${board}? This writes to the device.`;
  }
  return `Alp: flash ${board}? This writes to the device.`;
}

/**
 * The dialog's detail — everything the reader needs to refuse.
 *
 * Ordered so the irreversible-write sentence is LAST, next to the buttons,
 * rather than scrolled off the top by a long manifest.
 */
export function describeFlashConsent(
  plan: FlashConsentPlan,
  context: FlashConsentContext,
): string {
  const sections: string[] = [
    [
      `Project: ${context.projectDir}`,
      `Manifest: ${context.manifestPath}`,
      `SKU: ${plan.sku.length > 0 ? plan.sku : NOT_STATED}`,
      renderScope(plan),
    ].join("\n"),
  ];

  if (plan.warnings.length > 0) {
    sections.push(plan.warnings.map((w) => `! ${w}`).join("\n"));
  }

  sections.push(
    [
      `Will be programmed (${plan.targets.length}):`,
      ...plan.targets.map(renderEntry),
    ].join("\n"),
  );

  if (plan.skipped.length > 0) {
    sections.push(
      [
        `Skipped, NOT written (${plan.skipped.length}):`,
        ...plan.skipped.map(
          (skip) => `${renderEntry(skip.entry)}\n      — ${skip.reason}`,
        ),
      ].join("\n"),
    );
  }

  sections.push(
    "Flashing OVERWRITES the target's non-volatile memory. It cannot be " +
      "undone, and programming the wrong slice or the wrong board can leave " +
      "the device unbootable. Nothing is written unless you continue.",
  );

  return sections.join("\n\n");
}
