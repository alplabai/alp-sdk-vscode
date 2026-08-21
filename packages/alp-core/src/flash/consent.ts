// SPDX-License-Identifier: Apache-2.0
//
// What a `tan flash` run is about to PROGRAM, and what it will skip — derived
// from `build/system-manifest.yaml`. Pure: no `vscode`, no `fs`, no
// `child_process`. The screen itself is `src/flash/gate.ts`; the shape
// precedent is `../deps/consent.ts` (#467).
//
// ── WHY THE MANIFEST AND NOT `--dry-run` (a deliberate deviation from #540) ─
//
// #540 recommends "preview with `tan flash --dry-run`, then a modal". This
// module deviates, for two measured reasons:
//
//   1. `tan flash` HAS NO ENTRY in the vendored envelope corpus
//      (`test/golden/tan-contract/envelope-contract.json` records 18
//      envelopes; flash is not among them). Its JSON shape is neither frozen
//      nor measurable in this repo, so a parser written against it would be
//      inventing a contract rather than consuming one.
//   2. `--dry-run`'s own help at the 0.6.0-rc1 pin says it "also bypasses the
//      required-tool PATH gate". A green dry-run therefore does NOT prove the
//      flashing tools are installed, and rendering it as a preview would put
//      a reassurance on screen that the run does not support.
//
// The system manifest is already parsed and modelled here (`../systemManifest`),
// is already covered by tests, and carries the fields the dialog must name
// (`core_id`, `status`, `flash_method`, `flash_args`, `helper_mcus[].name`,
// `.chip`). It is structured data instead of scraped text.
//
// ── TWO RULES THAT DECIDE EVERY QUESTION BELOW ─────────────────────────────
//
// (a) OVER-LISTING IS SAFE; UNDER-LISTING IS NOT. A consent screen that names
//     something tan then skips costs the reader a line. A screen that omits
//     something tan then writes is a device programmed without consent. So no
//     entry of `slices[]` or `helper_mcus[]` is ever dropped: an entry either
//     appears as a target or appears in `skipped` with the reason.
//
// (b) THIS MODULE DOES NOT PREDICT TAN'S DECISIONS. `status` is reported
//     VERBATIM and is never used to filter, which is the deliberate answer to
//     "how is a slice whose status is not a programmable one reported?" —
//     it is reported, with its status, as a target. Nothing in this repo
//     measures which of `pending`/`ok`/`failed`/`skipped` tan will act on, and
//     the same doctrine is already written down for `zephyrCoreIds`
//     ("the tool is the one that knows whether it can act on it … filtering
//     here would replace that message with an absence"). A slice the manifest
//     gives no `flash_method` gets a NOTE saying so — the manifest's own
//     statement that there is no flash wiring — and still appears.
//
// The one thing this module DOES claim is scope, and it claims it only where
// the CLI's own help states it, verbatim at the 0.6.0-rc1 pin:
//
//   --core   CORE_ID  "Flash only the slice with this core_id (skips every
//                      other slice AND all helpers)."
//   --helper NAME     "Flash only the helper MCU with this name (skips ALL
//                      slices and every other helper)."
//
// That second half of `--core` is why `skipped` exists at all: a user who
// clicks a per-slice Flash button expecting a whole-board write and gets one
// slice has a HALF-PROGRAMMED board, and nothing on screen said so.

import type { SystemManifest } from "../systemManifest/models";

/** Which side of the manifest an entry came from. */
export type FlashEntryKind = "slice" | "helper";

/**
 * One thing a flash run may write, carried verbatim off the manifest.
 *
 * Every field is `null` rather than absent when the manifest omits it, so a
 * renderer can say "not stated" instead of quietly printing a shorter line
 * than the entry deserves.
 */
export interface FlashEntry {
  kind: FlashEntryKind;
  /** `slices[].core_id` or `helper_mcus[].name`. Verbatim, never shortened. */
  id: string;
  /** `slices[].os`; null for a helper, which declares none. */
  os: string | null;
  /** `helper_mcus[].chip`; null for a slice, which declares none. */
  chip: string | null;
  /** `slices[].status`; null for a helper. Reported, never used to filter. */
  status: string | null;
  /** `flash_method`, or null when the manifest omits it. */
  flashMethod: string | null;
  /** `helper_mcus[].firmware_path`, or null. */
  firmwarePath: string | null;
  /**
   * `flash_args` exactly as the manifest carries it — an object, the STRING
   * `"TBD"` (the model tolerates both, and the real AEN801 emit uses the
   * string), or null when omitted. Kept as the union rather than coerced: a
   * consent screen that renders `"TBD"` as if it were a recipe is lying about
   * what is configured.
   */
  flashArgs: Record<string, unknown> | string | null;
  /** Manifest-grounded caveats about this entry. Never a prediction. */
  notes: readonly string[];
}

/** An entry the argv's scope removes, with the CLI's own reason. */
export interface FlashSkip {
  entry: FlashEntry;
  /** Why it is skipped, sourced from the scoping flag's own help text. */
  reason: string;
}

/** The `--core` / `--helper` scope a flash argv carries. Both null = whole project. */
export interface FlashScope {
  coreId: string | null;
  helperName: string | null;
}

/** Everything the confirm dialog needs, and nothing it has to re-derive. */
export interface FlashConsentPlan {
  /** `hw_info.sku`, verbatim. Empty string when the manifest omits it. */
  sku: string;
  scope: FlashScope;
  /** In scope for this argv — what may be written. */
  targets: readonly FlashEntry[];
  /** Out of scope for this argv — what will NOT be written, and why. */
  skipped: readonly FlashSkip[];
  /**
   * Facts the reader must see that are not about one entry: a scope naming
   * something the manifest does not contain, or a manifest with nothing in it
   * at all. A caller REFUSES on a plan with no targets rather than asking for
   * consent to nothing — see `src/flash/gate.ts`.
   */
  warnings: readonly string[];
}

/** `flash_args` is `"TBD"` (or any other bare string) rather than a recipe. */
function flashArgsNote(value: FlashEntry["flashArgs"]): string[] {
  return typeof value === "string"
    ? [
        `flash_args is the string ${JSON.stringify(value)}, not a recipe — ` +
          "the manifest does not state what would be written",
      ]
    : [];
}

function sliceEntry(slice: SystemManifest["slices"][number]): FlashEntry {
  const notes = [
    ...(slice.flash_method === undefined
      ? [
          "no flash_method in the manifest — this slice carries no flash " +
            "wiring, and tan decides what that means for the run",
        ]
      : []),
    ...flashArgsNote(slice.flash_args ?? null),
  ];
  return {
    kind: "slice",
    id: slice.core_id,
    os: slice.os ?? null,
    chip: null,
    status: slice.status ?? null,
    flashMethod: slice.flash_method ?? null,
    firmwarePath: null,
    flashArgs: slice.flash_args ?? null,
    notes,
  };
}

function helperEntry(
  helper: SystemManifest["helper_mcus"][number],
): FlashEntry {
  const notes = [
    ...(helper.flash_method === undefined
      ? [
          "no flash_method in the manifest — this helper MCU carries no " +
            "flash wiring, and tan decides what that means for the run",
        ]
      : []),
    ...flashArgsNote(helper.flash_args ?? null),
  ];
  return {
    kind: "helper",
    id: helper.name,
    os: null,
    chip: helper.chip ?? null,
    status: null,
    flashMethod: helper.flash_method ?? null,
    firmwarePath: helper.firmware_path ?? null,
    flashArgs: helper.flash_args ?? null,
    notes,
  };
}

/**
 * Split a manifest into "may be written" and "skipped by this argv's scope".
 *
 * `scope` defaults to the whole project (both fields null), which is what a
 * bare `tan flash` does. Passing BOTH a `coreId` and a `helperName` is argv
 * this repo never builds; it is handled by applying the `--core` rule first
 * and then the `--helper` rule, so the result is the intersection — the
 * conservative reading, and it can only ever list FEWER targets than either
 * flag alone, never a target neither flag selects.
 */
export function planFlashConsent(
  manifest: SystemManifest,
  scope: FlashScope = { coreId: null, helperName: null },
): FlashConsentPlan {
  const targets: FlashEntry[] = [];
  const skipped: FlashSkip[] = [];
  const warnings: string[] = [];

  for (const slice of manifest.slices) {
    const entry = sliceEntry(slice);
    if (scope.helperName !== null) {
      skipped.push({
        entry,
        reason: `--helper ${scope.helperName} skips ALL slices`,
      });
      continue;
    }
    if (scope.coreId !== null && slice.core_id !== scope.coreId) {
      skipped.push({
        entry,
        reason: `--core ${scope.coreId} flashes only the slice with that core_id`,
      });
      continue;
    }
    targets.push(entry);
  }

  for (const helper of manifest.helper_mcus) {
    const entry = helperEntry(helper);
    if (scope.coreId !== null) {
      skipped.push({
        entry,
        reason: `--core ${scope.coreId} skips every other slice AND all helpers`,
      });
      continue;
    }
    if (scope.helperName !== null && helper.name !== scope.helperName) {
      skipped.push({
        entry,
        reason: `--helper ${scope.helperName} flashes only that helper MCU`,
      });
      continue;
    }
    targets.push(entry);
  }

  // A scope naming something absent is not the same failure as an empty
  // manifest, and the reader needs to be able to tell them apart: one is a
  // stale core id in the UI, the other is a project that has not been built.
  if (
    scope.coreId !== null &&
    !manifest.slices.some((slice) => slice.core_id === scope.coreId)
  ) {
    warnings.push(
      `the manifest has no slice with core_id ${scope.coreId} — this argv ` +
        "selects nothing",
    );
  }
  if (
    scope.helperName !== null &&
    !manifest.helper_mcus.some((helper) => helper.name === scope.helperName)
  ) {
    warnings.push(
      `the manifest has no helper MCU named ${scope.helperName} — this argv ` +
        "selects nothing",
    );
  }
  if (manifest.slices.length === 0 && manifest.helper_mcus.length === 0) {
    warnings.push(
      "the manifest declares no slices and no helper MCUs — there is nothing " +
        "to program",
    );
  }

  return {
    sku: manifest.hw_info?.sku ?? "",
    scope,
    targets,
    skipped,
    warnings,
  };
}
