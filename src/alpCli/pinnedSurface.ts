// SPDX-License-Identifier: Apache-2.0
//
// What the PINNED tan can actually do — the two capability facts this
// extension has to branch on before it spawns anything.
//
// WHY THIS FILE EXISTS AT ALL. `test/golden/tan-surface/surface.json` is the
// authority: it is the pinned binary's own `--help`, recorded. It is also a
// TEST fixture, and `test/` is not in the VSIX — the shipped extension cannot
// read it. So the two facts the product branches on are re-declared here, in
// `src/`, and `test/tan.pinnedSurface.test.js` fails if either one drifts from
// the recording. Same shape as the vendored board schemas
// (`packages/alp-core/src/validation/vendoredSchemas.ts`): a runtime constant
// with a gate holding it to a vendored artefact, not a second opinion.
//
// WHY NOT PROBE. Both facts used to be established by SPAWNING the call and
// reading the refusal — nine `tan model` subcommands (#543) and three deferred
// `tan build` flags (#541). That works, and it costs a process per fact per
// refresh to learn something the pin already determines. Worse, two of the
// three shapes do not even come back as a classifiable refusal: `tan model add
// <id> --board …` sends two positionals to a command that takes one, so click
// exits 2 with `Got unexpected extra argument(s)` and NO envelope, and there is
// nothing for `cliSurface.ts` to classify.
//
// THE ALARM IS NOW DERIVED, NOT PROBED, AND IT STILL FIRES. The refusal these
// helpers synthesise is the same `{code, severity, message}` shape tan emits,
// carrying the same `model.unknown-subcommand` code, so it travels the same
// path through `src/models/service.ts` →
// `packages/alp-webview/src/features/models/cliSurface.ts` →
// `useModels`'s `cliModelSurfaceMissing` and lights the same one banner. What
// changed is where the fact comes from, not whether the customer is told.
//
// WHEN A PIN BUMP CLOSES ONE OF THESE. `test/tan.pinnedSurface.test.js` goes
// red naming the exact fact, because a capability that arrives is as much a
// change as one that disappears: a panel still reporting a gap that closed is
// the same defect as one probing a gap that never opened.

import type { AlpEnvelope, CliOutcome } from "./models";
import { SUPPORTED_CLI_VERSION } from "./service";

// ── `tan model` ──────────────────────────────────────────────────────────────

/**
 * Every subcommand `tan model` implements at `SUPPORTED_CLI_VERSION`.
 *
 * ONE. The Models panel drives nine (list, doctor, check, zoo, add, prep, run,
 * ab, build) and this pin has `build` — the other eight are tan-cli#857, and
 * this repo's half of it is #524.
 *
 * Held to `surface.json`'s `commands.model.subcommandValues` by the gate.
 */
export const MODEL_SUBCOMMANDS: readonly string[] = ["build"];

/** tan's own issue code for "that subcommand does not exist in this build",
 *  measured from the binary. Mirrored in the webview's `cliSurface.ts`, which
 *  classifies on it; the gate pins the two spellings equal. */
export const MODEL_UNKNOWN_SUBCOMMAND_CODE = "model.unknown-subcommand";

/** The upstream issue tracking the eight missing `tan model` subcommands. */
export const MODEL_SURFACE_REF = "tan-cli#857";

/** Whether the pinned tan implements `tan model <subcommand>`. */
export function isModelSubcommandImplemented(subcommand: string): boolean {
  return MODEL_SUBCOMMANDS.includes(subcommand);
}

/**
 * This extension's own code for "the pinned tan CAN do this and this panel
 * does not call it".
 *
 * The `models.` family, not tan's `model.` one, and that is the whole point:
 * `model.unknown-subcommand` is TAN's word for "the binary does not have this
 * subcommand", and once the pin does have it, sending that code is a lie the
 * webview would render as a capability banner — the wrong diagnosis and the
 * wrong tone for a gap that has become entirely ours. `models.cli-error` and
 * `models.tan-outdated` (`src/models/service.ts`) are the existing
 * extension-owned codes in this family; this joins them. Produced, never
 * matched, so it is outside `GATED_CODES` for the same reason they are.
 */
export const MODEL_SUBCOMMAND_UNWIRED_CODE = "models.panel-not-wired";

/** This repo's half of tan-cli#857 — restoring the Models surface in the IDE
 *  once the subcommands exist. */
export const MODEL_SURFACE_RESTORE_REF = "#524";

/**
 * The refusal `tan model <subcommand>` WOULD produce at this pin, without
 * running it — or, once the pin DOES implement that subcommand, an honest
 * report that this panel has not been rewired to call it.
 *
 * IT CONSULTS `isModelSubcommandImplemented`, so that constant is not merely
 * snapshot-checked, it DECIDES. Before this branch existed, a pin bump closing
 * tan-cli#857 reddened one constant-vs-snapshot compare, and the one-line edit
 * that greened it left all eight call sites in `src/models/panel.ts` still
 * synthesising "not implemented in tan <new version> (tan-cli#857)" about
 * capabilities that had just arrived — a false statement about the shipping
 * binary, produced by the very change that made it false.
 *
 * THE BRANCH LIVES HERE, not at those eight call sites. A caller that has to
 * remember to ask is a caller that can forget, and a ninth handler added later
 * would forget by default; here the check cannot be bypassed and cannot drift
 * between sites.
 *
 * Shaped as a real `CliOutcome` carrying a real envelope on purpose: every
 * consumer in `src/models/service.ts` reads `outcome.envelope.issues`, and a
 * bespoke "capability" channel beside it would be a second way to say one
 * thing. `exitCode: 1` and `ok: false` are what the binary returns for this
 * refusal. The envelope carries at least one issue in BOTH branches:
 * `toModelsData` merges `envelope.issues` and adds nothing of its own when the
 * envelope is non-null, so an empty list would reach the webview as
 * `ok: false` with no banner at all — a failure that renders as nothing.
 *
 * The message is written here rather than copied from tan because tan is not
 * being asked. It says more than tan's own "Unknown model subcommand: list.
 * Available: build." does — the version it is true of, and the issue that
 * changes it.
 */
export function unsupportedModelSubcommand(subcommand: string): CliOutcome {
  const implemented = isModelSubcommandImplemented(subcommand);
  const message = implemented
    ? `\`tan model ${subcommand}\` IS implemented in tan ` +
      `${SUPPORTED_CLI_VERSION}, but this panel has no call for it — the ` +
      "capability arrived and the wiring did not " +
      `(${MODEL_SURFACE_RESTORE_REF}). Nothing was run.`
    : `\`tan model ${subcommand}\` is not implemented in tan ` +
      `${SUPPORTED_CLI_VERSION} — this build implements ` +
      `\`model ${MODEL_SUBCOMMANDS.join("`, `model ")}\` and nothing else ` +
      `(${MODEL_SURFACE_REF}). Nothing was run.`;
  const envelope: AlpEnvelope = {
    command: "model",
    ok: false,
    exitCode: 1,
    project: { root: null, boardYaml: null },
    data: null,
    issues: [
      {
        // tan's code ONLY while the statement it makes is tan's. Once the pin
        // implements the subcommand, `model.unknown-subcommand` is a verdict
        // the binary would never return, and the webview would raise its
        // "this CLI cannot do it yet" banner over a CLI that can.
        code: implemented
          ? MODEL_SUBCOMMAND_UNWIRED_CODE
          : MODEL_UNKNOWN_SUBCOMMAND_CODE,
        severity: "error",
        message,
      },
    ],
  };
  return {
    exitCode: 1,
    kind: "runtime",
    ok: false,
    severity: "error",
    message,
    envelope,
  };
}

// ── `tan build`'s deferred flags ─────────────────────────────────────────────

/** The upstream issue tracking every deferred `tan build` flag. It is the ref
 *  the pinned binary's own help text carries: "Accepted by other commands; not
 *  implemented for `build` yet (tan-cli#427)". */
export const BUILD_DEFERRED_REF = "tan-cli#427";

/**
 * The `tan build` flags the Build Plan panel needs and this pin does not
 * implement.
 *
 * Deferred, NOT ignored and NOT misspelled: click accepts all three, which is
 * exactly why they cost three spawns and produced a failure three layers from
 * its cause (#541). Twelve of `tan build`'s twenty-two options are inert at
 * this pin; only the three this panel would send are listed, because a list of
 * flags nothing sends is a list nothing can keep true.
 *
 * Held to `surface.json`'s `commands.build.options[…].inert` by the gate —
 * including the other direction, that `--materialise` and `--plan-from`, which
 * this panel DOES still spawn, are live.
 */
export const DEFERRED_BUILD_OPTIONS: readonly string[] = [
  "--plan",
  "--manifest",
  "--manifest-from",
];

/** Whether the pinned tan defers `tan build <flag>`. */
export function isBuildOptionDeferred(flag: string): boolean {
  return DEFERRED_BUILD_OPTIONS.includes(flag);
}

/** This repo's half of tan-cli#427 — restoring the Build Plan panel's spawns
 *  once the flags do something. */
export const BUILD_DEFERRED_RESTORE_REF = "#541";

/**
 * Customer-facing sentence for a `tan build` flag this pin defers — or, for a
 * flag it does NOT defer, an honest report that this panel does not send it.
 *
 * IT CONSULTS `DEFERRED_BUILD_OPTIONS`, and before it did it described ANY
 * flag handed to it as deferred, including a live one. Not hypothetical:
 * `--materialise` and `--plan-from` are live at this pin and one typo away
 * from this call, and the day tan-cli#427 lands, `--plan`, `--manifest` and
 * `--manifest-from` join them while the two call sites in `buildPlanPanel.ts`
 * still pass exactly those three strings — the panel would go on blaming the
 * CLI for a gap that had become its own. The check is here rather than at the
 * call sites for the same reason as `unsupportedModelSubcommand`'s: a caller
 * that has to remember can forget.
 *
 * The deferred sentence is deliberately at least as specific as what the CLI
 * itself returns today ("`tan build --plan` is deferred and not available in
 * this build (see https://github.com/alplabai/tan-cli/issues/427)."): the
 * flag, the version, the upstream issue, and — the part the CLI cannot say —
 * that nothing ran, so a reader does not go looking for a failed subprocess in
 * the log.
 */
export function deferredBuildOptionMessage(flag: string): string {
  if (!isBuildOptionDeferred(flag)) {
    return (
      `\`tan build ${flag}\` is NOT deferred in tan ` +
      `${SUPPORTED_CLI_VERSION} — it does something, and this panel does not ` +
      `send it (${BUILD_DEFERRED_RESTORE_REF}). Nothing was run. Calling it ` +
      "deferred would blame the CLI for a gap that is this panel's."
    );
  }
  return (
    `\`tan build ${flag}\` is deferred in tan ${SUPPORTED_CLI_VERSION} and ` +
    `does nothing (${BUILD_DEFERRED_REF}: ` +
    `https://github.com/alplabai/tan-cli/issues/427). Nothing was run — this ` +
    "panel does not spawn a call the pinned CLI cannot answer."
  );
}
