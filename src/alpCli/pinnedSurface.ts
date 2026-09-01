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

// ── inert options, and WHY each one is inert ─────────────────────────────────

/**
 * The four situations `surface.json`'s `inert: true` collapses into one
 * boolean. Only `deferred` will ever start doing something.
 */
export type InertKind =
  | "deferred"
  | "compatibility"
  | "parity"
  | "not-applicable";

/**
 * Every option the pinned recording marks inert, keyed `"<command> <flag>"`,
 * with the kind of inertness it is.
 *
 * DECLARED, NOT DERIVED, and that is the point. The recording carries the
 * reason only in `marker` prose — "Accepted by other commands; not implemented
 * for `build` yet (tan-cli#427)", "(unused: faultdecode is HW-free)" — beside a
 * `ref` that is null for four of the six markers. Sniffing the kind out of that
 * text at runtime is the mistake that shipped in the proxy classifier (#511): a
 * condition pinned to one spelling, blind to every other, with no code to fall
 * back on. So the kind is written down here and `test/tan.pinnedSurface.test.js`
 * holds this table to the recording in BOTH directions — every entry still
 * inert, and every inert option in the recording present here. The second
 * direction is what stops a new inert flag arriving unclassified.
 *
 * Unlike `DEFERRED_BUILD_OPTIONS` below, this covers every command, not just
 * the flags one panel sends: a table nothing keeps true is a list, and the
 * two-direction gate is what makes keeping it true automatic rather than
 * remembered.
 */
export const INERT_OPTIONS: Readonly<Record<string, InertKind>> = {
  // DEFERRED — click accepts it, `build` has not implemented it yet, and
  // tan-cli#427 tracks its arrival. The only kind that will ever start doing
  // something, and therefore the only one a "not yet" sentence is true of.
  "build --all": "deferred",
  "build --ci": "deferred",
  "build --manifest": "deferred",
  "build --manifest-from": "deferred",
  "build --no-auto-bootstrap": "deferred",
  "build --no-color": "deferred",
  "build --non-interactive": "deferred",
  "build --plan": "deferred",
  "build --pristine": "deferred",
  "build --quiet": "deferred",
  "build --target": "deferred",
  "build --verbose": "deferred",

  // COMPATIBILITY — accepted so a caller written against an older tan does not
  // break. Never going to act; there is nothing to wait for.
  "doctor --build": "compatibility",

  // PARITY (#602) — tan's own reason, read past the matched clause into the
  // rest of the sentence, is the parity wording verbatim: "the oracle's clap
  // `GlobalArgs` are `global = true`, so every verb accepts all of them"
  // (`diff`, `pinmux`, `faultdecode`) / "clap makes every one of them
  // `global = true` in the oracle" (`inspect`) / "`global = true` clap
  // options `<mod>.rs` never reads" (`support-bundle`, `trace` — this one
  // literally embeds `global = true` in the matched marker, not just the
  // surrounding sentence). That is a claim about WHY the flag exists on this
  // command — because every command has it, not because this one has a
  // domain-specific need for it — which is `INERT_KIND_REASON.parity`'s
  // definition, not `not-applicable`'s. `--verbose`/`--quiet`/`--ci`/
  // `--no-color`/`--non-interactive`/`--all`/`--target` are ordinary,
  // applicable CLI ergonomics concepts (any command COULD read them); these
  // six commands simply do not act on them. Corrected from an earlier
  // `not-applicable` pass over all 36 that conflated "global-architecture
  // artifact" with "meaningless by nature" — refuted by `faultdecode`'s own
  // marker for `--board-yaml`/`--project`/`--sdk-root` just below, which
  // states a genuine domain reason ("reads no board.yaml and drives no
  // alp-sdk checkout") that none of the parity flags carry.
  "diff --all": "parity",
  "diff --ci": "parity",
  "diff --no-color": "parity",
  "diff --non-interactive": "parity",
  "diff --target": "parity",
  "diff --verbose": "parity",

  "faultdecode --all": "parity",
  "faultdecode --ci": "parity",
  "faultdecode --non-interactive": "parity",
  "faultdecode --quiet": "parity",
  "faultdecode --target": "parity",
  "faultdecode --verbose": "parity",

  "inspect --all": "parity",
  "inspect --ci": "parity",
  "inspect --no-color": "parity",
  "inspect --non-interactive": "parity",
  "inspect --target": "parity",
  "inspect --verbose": "parity",

  "pinmux --all": "parity",
  "pinmux --ci": "parity",
  "pinmux --no-color": "parity",
  "pinmux --non-interactive": "parity",
  "pinmux --quiet": "parity",
  "pinmux --target": "parity",
  "pinmux --verbose": "parity",

  "support-bundle --all": "parity",
  "support-bundle --ci": "parity",
  "support-bundle --no-color": "parity",
  "support-bundle --non-interactive": "parity",
  "support-bundle --quiet": "parity",

  "trace --all": "parity",
  "trace --ci": "parity",
  "trace --no-color": "parity",
  "trace --non-interactive": "parity",
  "trace --verbose": "parity",

  // NOT APPLICABLE — the recording's words are "(unused: faultdecode is
  // HW-free)" / "reads no board.yaml and drives no alp-sdk checkout -- it is
  // pure ARMv8-M register arithmetic". The flag is meaningless for THIS
  // command by nature — a fault decoder has no notion of a project or a
  // board — not merely unimplemented the way the `parity` flags above are.
  // `--board-yaml` joins `--project`/`--sdk-root` here rather than the
  // `parity` block above for exactly that reason: faultdecode's own marker
  // names board.yaml specifically, the same domain exclusion as the other
  // two, not the generic "every verb accepts all of them" one.
  "faultdecode --project": "not-applicable",
  "faultdecode --sdk-root": "not-applicable",
  "faultdecode --board-yaml": "not-applicable",
};

/** How each permanent kind is explained to a customer. `deferred` is absent on
 *  purpose: it gets the upstream issue and its URL instead, because it is the
 *  one kind with something to point at. */
const INERT_KIND_REASON: Readonly<
  Record<Exclude<InertKind, "deferred">, string>
> = {
  compatibility:
    "it is kept so callers written against an older tan keep working",
  parity: "it is there so this command's flags match every other command's",
  "not-applicable": "it does not apply to this command",
};

/** Which kind of inert `tan <command> <flag>` is at this pin, or null when the
 *  flag is live (or is not an option at all — an unknown flag is not inert,
 *  it is unknown). */
export function inertKindOf(command: string, flag: string): InertKind | null {
  return INERT_OPTIONS[`${command} ${flag}`] ?? null;
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

/**
 * Whether the pinned tan defers `tan build <flag>`.
 *
 * Reads `INERT_OPTIONS`, not `DEFERRED_BUILD_OPTIONS`. The two answer different
 * questions and only one of them is about the binary: the list below is the
 * three flags THIS PANEL would send, so consulting it made
 * `deferredBuildOptionMessage` describe the other nine deferred build flags —
 * `--all`, `--ci`, `--target`, `--verbose`, `--quiet`, `--pristine`,
 * `--no-color`, `--non-interactive`, `--no-auto-bootstrap` — as flags that "do
 * something", which the recording says they do not.
 */
export function isBuildOptionDeferred(flag: string): boolean {
  return inertKindOf("build", flag) === "deferred";
}

/**
 * This repo's half of tan-cli#427 — restoring the Build Plan panel's spawns
 * once the flags do something.
 *
 * #580, not #541. #541 is the issue that took the spawns OUT, and it is closed
 * as completed; this ref is printed by the branch of
 * `deferredBuildOptionMessage` that fires once a flag is NOT deferred — that
 * is, on the day tan-cli#427 lands. Pointing the reader at a closed issue at
 * exactly the moment something is supposed to happen is the failure this
 * constant exists to prevent. `MODEL_SURFACE_RESTORE_REF` has the same shape
 * and its ticket (#524) is open, which is what makes it work.
 */
export const BUILD_DEFERRED_RESTORE_REF = "#580";

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
/**
 * The `build` flags tan RETIRED, and what replaces each.
 *
 * ── Why this is not just a value in `INERT_OPTIONS` ─────────────────────────
 *
 * `INERT_OPTIONS` mirrors the pinned RECORDING, and the recording is correct:
 * on tan `0.6.0` these three still refuse with `cli.command-deferred` and the
 * message still names tan-cli#427. Changing their kind there would make the
 * table disagree with the binary it claims to describe.
 *
 * What changed is not the binary's behaviour but the DECISION behind it.
 * tan-cli#427 closed having RETIRED them rather than delivered them:
 *
 *   build_cmd.py:229   _RETIRED_FLAGS = { "--plan", "--manifest", "--manifest-from" }
 *
 * and `build_cmd.py:218-228` commits the reasoning, including the trade it
 * accepts: there is no "preview the live plan and stop" mode left at all.
 *
 * ── Why the message had to change on the same day ──────────────────────────
 *
 * `deferredBuildOptionMessage`'s `deferred` branch hands the customer
 * `tan-cli#427` and its URL. That was right while the flag was pending. It is
 * now the exact failure the SAME function warns about two branches up, in
 * prose written before anyone knew which way #427 would go:
 *
 *   "naming tan-cli#427 here would promise an arrival that is not coming,
 *    which is the more expensive half of the same confusion -- a customer who
 *    waits for a flag to start working waits forever."
 *
 * A customer who follows that link now lands on a CLOSED issue whose decision
 * is that the flag is gone. So these carry the replacement instead, which is
 * also what tan's own decision comment asked consumers to do: "a customer who
 * typed `--plan` should be told to type `--plan-from`, in the error itself,
 * not sent to a tracker."
 */
export const RETIRED_BUILD_OPTIONS: Readonly<Record<string, string>> =
  Object.freeze({
    "--plan":
      "`tan build --plan-from FILE` reads a plan, and `--materialise` / " +
      "`--execute` act on one. There is no flag that previews the live plan " +
      "and stops -- that mode was retired with this one.",
    "--manifest":
      "A native `tan build` writes `build/system-manifest.yaml` itself. There " +
      "is no pre-build projection of it any more -- build, then read the file.",
    "--manifest-from":
      "`build/system-manifest.yaml` is plain YAML written by `tan build`, and " +
      "a caller reads it directly rather than asking the CLI to hand it over.",
  });

/**
 * The message for a flag tan retired. Names the replacement, never an issue.
 *
 * Callers do NOT have to know a flag is retired: `deferredBuildOptionMessage`
 * consults this first, so every existing site got the corrected wording
 * without being edited. A gate a caller opts into is a gate the next caller
 * forgets, which is #596 written down.
 */
export function retiredBuildOptionMessage(
  flag: string,
  command = "build",
): string {
  const replacement = RETIRED_BUILD_OPTIONS[flag];
  if (!replacement) {
    // Not retired. Fall through to the inertness answer rather than inventing
    // one -- claiming a live flag is retired is the same lie in the other
    // direction.
    return deferredBuildOptionMessage(flag, command);
  }
  // The URL stays, and that is a correction to this function's first draft.
  // It was dropped on the reasoning that a closed issue promises nothing --
  // but `test/tanPayloadShape.test.js` and `test/ideHub.buildPlanPanel.test.js`
  // both require the panel to say AT LEAST what tan's own refusal said, and
  // tan prints that URL. Dropping it gave the customer less than the CLI
  // would have. The false promise was never the link; it was the word
  // "deferred" and the implied wait, and #427 read today tells them exactly
  // what replaced the flag.
  return (
    `\`tan ${command} ${flag}\` is retired. It still refuses in tan ` +
    `${SUPPORTED_CLI_VERSION}, and it is not coming back -- ${BUILD_DEFERRED_REF} ` +
    "(https://github.com/alplabai/tan-cli/issues/427) closed by retiring it, " +
    `not by implementing it. ${replacement} Nothing was run.`
  );
}

export function deferredBuildOptionMessage(
  flag: string,
  command = "build",
): string {
  // Retired beats every other answer, and is checked BEFORE `inertKindOf`.
  // The pinned recording still marks these `deferred`, so without this the
  // branch below would hand the customer a closed issue and an implied wait.
  if (command === "build" && flag in RETIRED_BUILD_OPTIONS) {
    return retiredBuildOptionMessage(flag, command);
  }

  const kind = inertKindOf(command, flag);
  if (kind === null) {
    return (
      `\`tan ${command} ${flag}\` is NOT deferred in tan ` +
      `${SUPPORTED_CLI_VERSION} — it does something, and this panel does not ` +
      `send it (${BUILD_DEFERRED_RESTORE_REF}). Nothing was run. Calling it ` +
      "deferred would blame the CLI for a gap that is this panel's."
    );
  }
  if (kind !== "deferred") {
    // No upstream issue, and deliberately no "yet": naming tan-cli#427 here
    // would promise an arrival that is not coming, which is the more expensive
    // half of the same confusion — a customer who waits for a flag to start
    // working waits forever.
    return (
      `\`tan ${command} ${flag}\` is accepted by tan ` +
      `${SUPPORTED_CLI_VERSION} and ignored — ${INERT_KIND_REASON[kind]}, not ` +
      "a capability on its way, so there is nothing to wait for. Nothing " +
      "was run."
    );
  }
  return (
    `\`tan ${command} ${flag}\` is deferred in tan ` +
    `${SUPPORTED_CLI_VERSION} and does nothing (${BUILD_DEFERRED_REF}: ` +
    `https://github.com/alplabai/tan-cli/issues/427). Nothing was run — this ` +
    "panel does not spawn a call the pinned CLI cannot answer."
  );
}
