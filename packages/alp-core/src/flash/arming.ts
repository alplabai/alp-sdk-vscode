// SPDX-License-Identifier: Apache-2.0
//
// The arming rule (#540): given what `tan flash --dry-run --format json` says
// a run would do, may the extension add `--confirm`, and must the customer
// first acknowledge an ATOC replacement? Pure — the screen is
// `src/flash/gate.ts`.
//
// ── THE FACT THE RULE STANDS ON (tan 0.7.0) ────────────────────────────────
//
// What `--confirm` does depends on the backend tan RESOLVES, and on AEN that is
// not the one the manifest names: every planner-emitted Zephyr slice carries a
// `flash_args.jlink_flash_device`, which `select_flash_method` routes to
// Flow D (`alif_mram_jlink`) whatever `flash_method` says.
//
//   zephyr_west_flash / baremetal_cmake_flash   writes without it; no change
//   alif_mram_jlink (Flow D)                    previews without it; writes
//                                               with it, and then ALSO refuses
//                                               without `--atoc-unqueryable`
//   yocto_wic*                                  previews without it; with it,
//                                               a real bmaptool/dd to a HOST
//                                               block device
//   xspi_flashwriter                            previews without it; with it,
//                                               a hard refusal
//
// So the flag is safe to add for exactly one class, and the extension does not
// re-implement `select_flash_method` to find out which: it asks tan for a
// preview and reads the resolved backend off each entry.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// Arm only when every in-scope entry that HAS a confirm gate resolves to
// Flow D. Any `never-arm` entry is never armed; beside a Flow D entry it
// refuses the whole run, because the alternative is a half-write the customer
// was not told about. A scope of backends that write unasked is left exactly
// as it was.

import {
  classifyBackend,
  FLOW_D_METHOD,
  type FlashBackendClass,
  type FlashEnvelope,
  type FlashEnvelopeEntry,
} from "./envelope";

export type FlashRefusalReason =
  | "preview-failed"
  | "nothing-in-scope"
  | "mixed-backends"
  | "preview-only-backend"
  | "setools-not-operator-named"
  | "replacement-text-missing"
  | "left-out-sibling";

export type FlashArmingDecision =
  /** Spawn the argv as the call site wrote it. */
  | { kind: "unarmed" }
  /** Add `--confirm`, and make the customer acknowledge the ATOC replacement. */
  | {
      kind: "arm-flow-d";
      /** tan's own replacement text, verbatim from the preview. */
      replacementNote: string;
      /** The slices the new ATOC names, `DEVICE` excluded. */
      atocNames: readonly string[];
      setoolsDir: string | null;
      setoolsSource: string | null;
    }
  /** Spawn nothing. `message` is customer-facing and says nothing was written. */
  | { kind: "refuse"; reason: FlashRefusalReason; message: string };

/** What the caller knows that the preview alone does not. */
export interface FlashArmingContext {
  /** The argv carried `--core`. */
  scoped: boolean;
  /**
   * The same preview with `--core` dropped, used to find Flow D slices the
   * scoped ATOC would leave out. Null when it could not be obtained, which is
   * treated as "cannot prove nothing is delisted" and refuses.
   */
  wholeBoard: FlashEnvelope | null;
}

const NOTE_START = "NOTE: a real write REPLACES";
/** The text tan appends after its replacement note (probe selection). */
const NOTE_END = " (probe selection";
/** tan's sentence when `--core` leaves other Flow D slices out of the ATOC. */
const LEFT_OUT_SENTENCE = /are NOT named, so they will be delisted/;

function refuse(
  reason: FlashRefusalReason,
  message: string,
): FlashArmingDecision {
  return { kind: "refuse", reason, message };
}

/** tan's replacement text out of the lead Flow D entry's message, or null. */
export function flowDReplacementNote(message: string): string | null {
  const start = message.indexOf(NOTE_START);
  if (start < 0) return null;
  const end = message.indexOf(NOTE_END, start);
  return (end < 0 ? message.slice(start) : message.slice(start, end)).trim();
}

function flowDIds(env: FlashEnvelope): string[] {
  return env.entries
    .filter((e) => e.status !== "skipped" && e.method === FLOW_D_METHOD)
    .map((e) => e.id);
}

function firstErrorMessage(env: FlashEnvelope): string {
  const failedEntry = env.entries.find((e) => e.status === "failed");
  const issue = env.issues.find((i) => i.severity === "error");
  return failedEntry?.message || issue?.message || "tan reported an error.";
}

function ids(entries: readonly FlashEnvelopeEntry[]): string {
  return entries.map((e) => e.id).join(", ");
}

export function decideFlashArming(
  preview: FlashEnvelope,
  context: FlashArmingContext,
): FlashArmingDecision {
  if (!preview.ok) {
    return refuse(
      "preview-failed",
      "tan could not preview this flash, so nothing was written. " +
        firstErrorMessage(preview),
    );
  }

  const inScope = preview.entries.filter((e) => e.status !== "skipped");
  if (inScope.length === 0) {
    return refuse(
      "nothing-in-scope",
      "tan's preview selects nothing to write, so nothing was written.",
    );
  }

  const byClass = (cls: FlashBackendClass): FlashEnvelopeEntry[] =>
    inScope.filter((e) => classifyBackend(e.method) === cls);
  const flowD = byClass("flow-d");
  const neverArm = byClass("never-arm");
  const writesUnasked = byClass("writes");

  if (flowD.length > 0 && neverArm.length > 0) {
    return refuse(
      "mixed-backends",
      `This flash mixes Flow D (${ids(flowD)}) with ${ids(neverArm)}, which ` +
        "tan only writes to a host block device or a flash-writer when told " +
        "to confirm. Alp does not arm that, and arming only the Flow D half " +
        "would leave the board half-programmed — so nothing was written. " +
        "Flash the Flow D slices on their own.",
    );
  }

  if (flowD.length === 0) {
    if (neverArm.length > 0 && writesUnasked.length === 0) {
      return refuse(
        "preview-only-backend",
        `${ids(neverArm)} would only be previewed: tan writes this backend ` +
          "only under --confirm, and Alp does not arm it from the IDE — so " +
          "nothing was written.",
      );
    }
    return { kind: "unarmed" };
  }

  // ── Flow D in scope, and nothing that forbids arming it ─────────────────
  const lead = flowD.find((e) => flowDReplacementNote(e.message) !== null);
  if (flowD.some((e) => e.setools?.signSkipped === true)) {
    return refuse(
      "setools-not-operator-named",
      "tan will not run a SETOOLS install that only the project's manifest " +
        "names, so it could not sign the ATOC and nothing was written. Set " +
        "SETOOLS_DIR to your SETOOLS install and flash again.",
    );
  }
  if (lead === undefined) {
    return refuse(
      "replacement-text-missing",
      "tan's preview did not include its boot-table replacement warning, so " +
        "Alp cannot show you what this write would delist and nothing was " +
        "written. This tan version is not one this build knows how to arm.",
    );
  }
  const note = flowDReplacementNote(lead.message) as string;

  const named = new Set(lead.atocNames ?? []);
  let leftOut: string[] = [];
  if (context.scoped) {
    leftOut =
      context.wholeBoard === null
        ? []
        : flowDIds(context.wholeBoard).filter((id) => !named.has(id));
  }
  const unverifiable = context.scoped && context.wholeBoard === null;
  if (unverifiable || leftOut.length > 0 || LEFT_OUT_SENTENCE.test(note)) {
    const who = leftOut.length > 0 ? ` (${leftOut.join(", ")})` : "";
    return refuse(
      "left-out-sibling",
      `Flashing one core would replace the whole boot table and delist the ` +
        `other Flow D slice(s)${who}${unverifiable ? ", or Alp could not check whether it would" : ""}. ` +
        "Use the whole-board Flash instead — nothing was written.",
    );
  }

  return {
    kind: "arm-flow-d",
    replacementNote: note,
    atocNames: lead.atocNames ?? [],
    setoolsDir: lead.setools?.dir ?? null,
    setoolsSource: lead.setools?.source ?? null,
  };
}
