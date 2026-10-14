// SPDX-License-Identifier: Apache-2.0
//
// The consent gate every `tan flash` dispatch passes through (#540).
//
// ── WHY IT LIVES INSIDE THE RUNNER AND NOT AT THE CALL SITES ───────────────
//
// `runAlpStreamed` calls `gateFlashDispatch` unconditionally, on every argv,
// before it spawns anything. That placement is #467's lesson applied a second
// time: putting the dependency-install consent INSIDE `runFixAll` rather than
// behind an injected callback is what made it un-bypassable, and it reddened 8
// of 13 existing tests on the spot — which was the proof it was worth more
// than the injectable version.
//
// The same reasoning is sharper here. There are two flash call sites today
// (`src/west.ts`'s `alp.westAlpFlash`, and the Build Plan panel's per-slice
// button) and the defect in #540 is that BOTH forgot the same flag. A gate
// wired at the call sites would be a gate the third call site can forget in
// exactly the same way. A gate in the one function they all dispatch through
// cannot be forgotten — it can only be deliberately removed, which is a diff a
// reviewer sees.
//
// ── WHAT IT DOES, IN ORDER ────────────────────────────────────────────────
//
//   1. Not a flash argv?          returned unchanged — UNLESS it mentions the
//                                 word `flash` somewhere the command reader
//                                 could not account for, which is refused
//                                 rather than guessed at (see below).
//   2. `--dry-run`?               returned unchanged and UNARMED. A dry run
//                                 writes no device: tan prints what each
//                                 backend would do. (It is not spawn-free —
//                                 a Flow D preview runs SETOOLS `app-gen-toc`
//                                 in a scratch copy of the install — but
//                                 nothing reaches the board.)
//   3. `--recover`?               REFUSED here, never armed. Its help: "For a
//                                 BRICKED device only, with Alp Lab-supplied
//                                 binaries." Nothing in this extension has the
//                                 standing to authorise that from a button.
//   4. `--project`?               REFUSED. Two different anchors for the same
//                                 manifest, and this repo cannot say which one
//                                 tan uses — see `flashManifestPath`.
//   5. An argv tan would reject at parse (a value-taking flag with no value, a
//      second positional past `maxPositionals: 1`)? REFUSED. Consent for a run
//      that cannot start is consent collected under false pretences, and the
//      failure toast afterwards talks about re-flashing a run that never began.
//   6. No `cwd`, or no readable `build/system-manifest.yaml`? REFUSED, naming
//      the file. There is nothing to consent to, and a bare `tan flash` sent
//      anyway would be a blind write.
//   7. Otherwise: the manifest is parsed, `planFlashConsent` says what is in
//      scope and what the scope skips, tan is asked for a `--dry-run` preview
//      of the same argv (below), and a BLOCKING modal asks. Its accept
//      re-reads the manifest and proves it BYTE-IDENTICAL to the one the
//      dialog described. A Flow D flash then asks a SECOND modal, and the
//      manifest is proved unchanged again after it; only then is the argv
//      released to the spawn.
//
// ── WHAT THE GATE DOES ABOUT `--confirm` (tan 0.7.0) ──────────────────────
//
// Whether `--confirm` writes anything depends on the backend tan RESOLVES, and
// on AEN that is not the one the manifest names. Every planner-emitted Zephyr
// slice carries `flash_args.jlink_flash_device`, which `select_flash_method`
// (tan `python/tan/core/flash_plan.py`) routes to Flow D (`alif_mram_jlink`)
// whatever `flash_method: zephyr_west_flash` says. Flow D computes
// `planning_only = dry_run or not confirm`, so the old gate — a modal that
// then released the argv UNCHANGED — made the AEN "Write to Device" button
// preview and write nothing.
//
//   backend tan resolves     bare `tan flash`   with `--confirm`
//   zephyr_west_flash        writes             no change
//   baremetal_cmake_flash    writes             no change
//   yocto_wic*               preview            a real bmaptool/dd to a HOST
//                                               block device
//   xspi_flashwriter         preview            hard refusal ("HW-gated")
//   alif_mram_jlink          preview            writes, but REFUSED with
//                                               `flash.atoc-replacement-
//                                               unacknowledged` unless
//                                               `--atoc-unqueryable` too
//
// So the gate asks tan. After the checks above it runs the same argv with
// `--dry-run --format json` and reads each entry's RESOLVED backend off the
// envelope (`@alp-sdk/core/flash/arming`) — it does NOT re-implement
// `select_flash_method`. Then:
//
//   - `--confirm` is added only when every entry that has a confirm gate
//     resolves to Flow D. A yocto or xspi entry is never armed; beside a Flow D
//     entry it refuses the whole run, with nothing written.
//   - A Flow D write replaces the WHOLE ATOC boot table and delists every
//     resident entry the new one does not name, and nothing can enumerate
//     what is resident. That is a second consent, on its own modal, shown after
//     the first accept and never implied by it; tan's own replacement text is
//     printed verbatim. `--atoc-unqueryable` is added only after it.
//   - A per-slice (`--core`) Flow D flash is refused when the preview shows a
//     sibling it would delist; the whole-board Flash is the way to flash it.
//   - An ARMED Flow D run is `--format json`, because its verdict has to come
//     from the envelope: at 0.7.0 "every entry planned" exits 1 and a mixed run
//     exits 0, so the exit code cannot say whether anything was written. Every
//     other scope keeps the text-mode streamed run and the exit-code path, so
//     west's and cmake's own output still reaches the log.
//   - A manifest that already carries `flash_args.confirm` or
//     `flash_args.atoc_unqueryable` is refused: tan arms on `--confirm` OR that
//     key, and a dry-run cannot reveal it.
//   - Allow-lists, not deny-lists: a backend that is not one of the two
//     verified `writes` backends (or Flow D / yocto / xspi) refuses, and so
//     does any `tan flash` option outside `FLASH_ALLOWED_OPTIONS` — read the way
//     Click reads it, so `--core --confirm` is `--core` with a suspect value,
//     not an armed flash.
//   - An unarmed scope that leaves a yocto/xspi entry unwritten beside one that
//     writes is also read from its envelope, so the toast names that entry.
//
// `ALP_FLASH_FORCE=1` and `flash_args.confirm`/`flash_args.atoc_unqueryable`
// are the other ways to arm tan's gate. NONE is used: the first would put the
// consent in an environment variable that outlives the click, the others in a
// generated file the next `tan build` rewrites. The runner also strips
// `ALP_FLASH_FORCE` from a flash dispatch's environment, so a profile that
// exports it cannot arm tan behind a modal that was never shown.
//
// SETOOLS: a confirmed Flow D write signs with an install the OPERATOR named
// (`--setools-dir`, then `SETOOLS_DIR`); one named only by the manifest is
// refused (`flash.setools-untrusted-source`). The gate passes `SETOOLS_DIR`
// from the extension host's environment as `--setools-dir`; a `SETOOLS_DIR`
// exported only by the login profile still reaches tan, because the run goes
// through that shell. With neither, the preview fails with tan's message. With
// a manifest-only install the preview succeeds but reports `signSkipped` (it
// will not run a tool the project chose), which the arming rule refuses.
//
// ── DO-NOT-MERGE-WITHOUT-A-BENCH ──────────────────────────────────────────
//
// Nothing in this repo programs silicon, and the arming above turns a button
// that has only ever previewed into one that rewrites an Alif boot table. The
// unit tests prove the rule against real tan 0.7.0 captures and the argv the
// gate emits; they cannot prove a write lands. Merge only after the AEN E8
// bench checklist in the PR has been run on hardware.

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import {
  acknowledgeAtocReplacement,
  armFlashArgv,
  FLASH_COMMAND,
  isFlashArgv,
  jsonFlashArgv,
  previewFlashArgv,
  readFlashArgv,
  withoutCore,
  withSetoolsDir,
} from "@alp-sdk/core/flash/argv";
import { decideFlashArming } from "@alp-sdk/core/flash/arming";
import { planFlashConsent } from "@alp-sdk/core/flash/consent";
import {
  atocReplacementMessage,
  describeAtocReplacement,
  describeFlashConsent,
  describeFlashPreview,
  flashConsentMessage,
} from "@alp-sdk/core/flash/describe";
import {
  classifyBackend,
  parseFlashEnvelope,
  type FlashEnvelope,
} from "@alp-sdk/core/flash/envelope";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";

import type { NotifyAction } from "../notify/models";
import { planConfirm, planFailure, planSuccess } from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { log } from "../util";

/** The manifest's name as the customer knows it, relative to the build root.
 *  Kept out of the toast text as an absolute path on purpose — `planFailure`
 *  demotes a `cause` carrying one into the channel-only `detail` and replaces
 *  the sentence with "<operation> failed.", which is the exact claim this
 *  change exists to stop making. */
const MANIFEST_FILE = "system-manifest.yaml";

/** `tan run --flash` — a device write that is not the `flash` command. */
const RUN_FLASH_FLAG = "--flash";

/**
 * Where `tan flash` reads its manifest from.
 *
 * MEASURED, on the 0.7.0 binary (unchanged from 0.6.0), `tan flash --help`:
 *
 *   APP_PATH      <str>  Application source directory (default: the current
 *                        directory). `build_root` defaults to <APP_PATH>/build.
 *   --build-root  PATH   Override the build root holding system-manifest.yaml
 *                        (default: <APP_PATH>/build).
 *
 * `--project` is NOT modelled here, and the reason is not that it has been
 * measured irrelevant — it has not. Its own help line is `--project PATH
 * Project root (defaults to '.')`, and the one MEASURED sentence this repo
 * vendors about where the four device commands look is
 * `test/golden/tan-contract/envelope-contract.json`'s
 * `build.unsupported-build-root` note: flash/size/image/renode "all four
 * anchor on `<project>/build/system-manifest.yaml`". That sentence says
 * `<project>`, this function derives from APP_PATH, and nothing in the repo
 * settles which wins when the two differ. A truthful-looking dialog about
 * `cwd`'s manifest while tan acts on another project is precisely the
 * dialog-names-one-thing-spawn-writes-another failure, so `gateFlashDispatch`
 * REFUSES a `--project` flash outright instead of guessing (tan-cli question,
 * not a shape this repo can resolve). No call site builds one today.
 */
export function flashManifestPath(
  args: readonly string[],
  cwd: string,
): string {
  const argv = readFlashArgv(args);

  if (argv.buildRoot !== null) {
    return path.resolve(cwd, argv.buildRoot, MANIFEST_FILE);
  }
  const appPath = argv.appPath ?? ".";
  return path.resolve(cwd, appPath, "build", MANIFEST_FILE);
}

/** Refuse, without ever using the word "failed": nothing ran. */
function refuse(
  cause: string,
  detail?: string,
  actions?: NotifyAction[],
): null {
  notifyAsync(
    planFailure({
      severity: "warning",
      operation: "Alp Flash",
      cause,
      detail,
      actions,
    }),
  );
  return null;
}

/** The manifest's exact bytes, fingerprinted. Content, not mtime+size: a
 *  rebuild that lands in the same second and produces the same byte count is
 *  the case a stat-based check misses, and it is not exotic — `tan build`
 *  rewrites this file every run. */
function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** What the gate needs from the runner that it cannot do itself. */
export interface FlashGateDeps {
  /**
   * Run `tan <args>` (the caller prepends `--sdk-root` and resolves the
   * binary) in `cwd` and return its stdout, or null when tan could not be
   * run at all. The exit status is deliberately not returned: a `--dry-run`
   * preview that found a problem exits non-zero and still prints the envelope
   * the gate needs to read.
   */
  runTan(
    args: readonly string[],
    cwd: string,
  ): Promise<string | null | { cancelled: true }>;
}

/** A dispatch the gate let through. */
export interface FlashApproval {
  /** The argv to spawn. */
  argv: string[];
  /**
   * The run's stdout is a `tan flash --format json` envelope and the verdict
   * is to be read from it (`@alp-sdk/core/flash/outcome`), not from the exit
   * status. False for every argv that is not a gated flash.
   */
  readEnvelope: boolean;
}

const passThrough = (args: readonly string[]): FlashApproval => ({
  argv: [...args],
  readEnvelope: false,
});

/** `SETOOLS_DIR` from the extension host's environment, or null. */
function setoolsDirFromEnv(): string | null {
  const value = process.env.SETOOLS_DIR?.trim();
  return value ? value : null;
}

/** Ask tan to preview `args` and read what it says. Null when it cannot;
 *  `"cancelled"` when the customer cancelled the preview. */
async function previewOf(
  deps: FlashGateDeps,
  args: readonly string[],
  cwd: string,
): Promise<FlashEnvelope | null | "cancelled"> {
  const stdout = await deps.runTan(previewFlashArgv(args), cwd);
  if (stdout === null) return null;
  if (typeof stdout === "object") return "cancelled";
  return parseFlashEnvelope(stdout);
}

/**
 * Gate a dispatch. Returns what to spawn — `--confirm` (and, after its own
 * modal, `--atoc-unqueryable`) added when, and only when, tan's preview says
 * the flag applies and a human accepted — or `null` when nothing may be
 * spawned at all.
 *
 * A non-flash argv is returned unchanged after one left-to-right scan of the
 * argv (`isFlashArgv`), which is what lets the caller apply this to every
 * streamed run rather than remembering which ones write hardware.
 */
export async function gateFlashDispatch(
  args: readonly string[],
  cwd: string | undefined,
  deps?: FlashGateDeps,
): Promise<FlashApproval | null> {
  if (!isFlashArgv(args)) {
    // The command reader could not resolve this argv to `flash`, yet the word
    // is in it. The one way that happens is a root-position flag whose arity
    // this pin does not know, swallowing (or failing to swallow) a token and
    // shifting the command slot. Refusing costs a command nobody builds today;
    // spawning would send an unrecognised flash past the gate — and with
    // `ALP_FLASH_FORCE=1` in the inherited environment tan arms itself.
    if (args.includes(FLASH_COMMAND)) {
      return refuse(
        "Alp could not tell which tan command this would run, and it mentions " +
          "flash — so nothing was run. Report this with the Alp SDK log.",
        args.join(" "),
      );
    }
    // `tan run --flash` writes a device WITHOUT being the `flash` command, so
    // neither `isFlashArgv` nor the `FLASH_COMMAND` token test above sees it.
    // Its help on the pinned CLI: "Program the board after building (hardware
    // targets only)."
    //
    // No call site builds it today — `src/west.ts` sends a bare `["run"]`,
    // which never flashes — and `test/flash.dispatch.test.js` filters the
    // extractor on `site.command === "flash"`, so a future `run --flash` site
    // would stay green while writing a board unasked. Refused rather than
    // gated: this repo has no manifest-shaped consent for a run that also
    // builds, and refusing costs a command nobody has written yet. It could
    // not be gated honestly even with one: `tan run` rebuilds the project
    // before it flashes, so the manifest a modal described is not the one the
    // write would use, and the preview that arming depends on would describe a
    // build that has not happened yet.
    if (args.includes(RUN_FLASH_FLAG)) {
      return refuse(
        "Alp does not flash from `tan run`. `--flash` programs the board as a " +
          "side effect of a run, which is not something this extension asks " +
          "about — use Flash, which shows what is about to be written.",
        args.join(" "),
      );
    }
    return passThrough(args);
  }

  const argv = readFlashArgv(args);

  // An allow-list of options, checked BEFORE anything else — the `--dry-run`
  // pass-through included. Raw and RAM writes, ATOC replacement, reset
  // suppression, an unknown or abbreviated flag: the consent screen and the
  // preview describe a plain flash, and a flag this build has not modelled can
  // desynchronise its reading of the argv from tan's (Click has no
  // abbreviation, lets a value-taking option swallow the next token even if it
  // starts with `--`, and hoists globals written after the subcommand).
  if (argv.hasRootEndOfOptions) {
    return refuse(
      "Alp did not run this flash: it has `--` before the command, and tan " +
        "starts reading the subcommand's options afresh after it. Nothing was " +
        "written.",
      args.join(" "),
    );
  }
  if (argv.unmodelledFlags.length > 0) {
    return refuse(
      `Alp does not run a flash with ${argv.unmodelledFlags.join(", ")}: what ` +
        "that does is not something the confirmation can describe, so " +
        "nothing was written.",
      args.join(" "),
    );
  }
  if (argv.suspectValues.length > 0) {
    return refuse(
      `Alp did not run this flash: the value given to ${argv.suspectValues.join(", ")} ` +
        "starts with a dash, so tan would read it as that option's value " +
        "rather than as a flag — and nothing here can be sure that is what " +
        "was meant. Nothing was written.",
      args.join(" "),
    );
  }

  // Writes nothing by tan's own contract, so there is nothing to consent to —
  // and arming it would turn a preview into a write.
  if (argv.isDryRun) {
    log("[flash] --dry-run: previewing only, the confirm gate is not armed");
    return passThrough(args);
  }

  // Alp adds these two itself, each after the modal that earns it. A call site
  // that wrote either has consented on the customer's behalf.
  if (argv.isArmed || argv.hasAtocUnqueryable) {
    return refuse(
      "Alp did not run this flash: it already carries --confirm or " +
        "--atoc-unqueryable. Alp adds those itself, after asking, so nothing " +
        "was written.",
      args.join(" "),
    );
  }

  if (argv.isRecovery) {
    return refuse(
      "Alp does not run recovery flashes. --recover authorises writing a " +
        "helper MCU that Alp Lab programs in production, for a bricked " +
        "device only and with Alp Lab-supplied binaries — ask Alp Lab " +
        "support rather than running it from the IDE.",
    );
  }

  if (argv.hasProjectFlag) {
    return refuse(
      "Alp does not run a flash with --project, so nothing was written. Alp " +
        "reads the manifest from the application path, tan's own contract " +
        "anchors these commands on the project root, and when the two differ " +
        "nothing here can say which one would actually be programmed.",
      args.join(" "),
    );
  }

  // tan parses before it does anything, and these two shapes never get past
  // it: exit 2 with `Option '--core' requires an argument`, or with `Got
  // unexpected extra argument` past `maxPositionals: 1`. Asking first would
  // collect consent for a write that cannot happen, and the non-zero exit
  // afterwards renders as "did not complete … read the log before
  // re-flashing" — a partial-write warning about a run that never started.
  if (argv.danglingFlags.length > 0) {
    return refuse(
      `Alp did not run this flash: ${argv.danglingFlags.join(", ")} needs a ` +
        "value and none was given, so tan would refuse the command before " +
        "touching the device.",
      args.join(" "),
    );
  }
  if (argv.extraPositionals.length > 0) {
    return refuse(
      "Alp did not run this flash: tan flash takes one application path and " +
        `this asked for ${argv.extraPositionals.length + 1} ` +
        `(${argv.extraPositionals.join(", ")}), so tan would refuse the ` +
        "command before touching the device.",
      args.join(" "),
    );
  }

  if (!cwd) {
    return refuse(
      "Alp cannot tell which project would be flashed, so nothing was " +
        "written. Open the project folder and try again.",
    );
  }

  const manifestPath = flashManifestPath(args, cwd);
  let text: string;
  try {
    text = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    return refuse(
      `No ${MANIFEST_FILE} for this project yet, so Alp cannot say what ` +
        "would be programmed and nothing was written. Build the project " +
        "first, then flash.",
      `${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let plan;
  try {
    plan = planFlashConsent(parseSystemManifest(text), {
      coreId: argv.coreId,
      helperName: argv.helperName,
    });
  } catch (error) {
    return refuse(
      `This project's ${MANIFEST_FILE} could not be read, so Alp cannot say ` +
        "what would be programmed and nothing was written. Rebuild the " +
        "project, then flash.",
      `${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Consent to nothing is not consent. A scope that selects no entry means a
  // stale core id in the UI or an unbuilt project — either way the run would
  // write nothing, and asking would train the customer to click through a
  // dialog that does not matter.
  if (plan.targets.length === 0) {
    return refuse(
      "Nothing in this project's manifest matches what was asked to be " +
        "flashed, so nothing was written." +
        (plan.warnings.length > 0 ? ` ${plan.warnings.join("; ")}` : ""),
      manifestPath,
    );
  }

  // tan arms a backend when `--confirm` OR the manifest's own
  // `flash_args.confirm` says so, and a `--dry-run` preview cannot reveal which
  // (it never writes either way). A manifest that already holds the key would
  // arm a yocto `dd` or a Flow D write behind a modal that says "NOT written",
  // so it is refused by name instead.
  for (const target of plan.targets) {
    const args2 = target.flashArgs;
    if (typeof args2 !== "object" || args2 === null) continue;
    for (const key of ["confirm", "atoc_unqueryable"]) {
      const value = args2[key];
      if (value !== undefined && value !== false && value !== "false") {
        return refuse(
          `${target.id} already carries flash_args.${key} in ${MANIFEST_FILE}, ` +
            "which arms tan's write gate without asking — so nothing was " +
            "written. Remove the key (the next build rewrites it) and flash " +
            "again.",
          manifestPath,
        );
      }
    }
  }

  // A Flow D slice that brings its own ATOC (`atoc`, `atoc_map`,
  // `atoc_address`) is written as a boot table of its own and is not folded
  // into the one this flow describes and asks about.
  for (const target of plan.targets) {
    const targetArgs = target.flashArgs;
    if (typeof targetArgs !== "object" || targetArgs === null) continue;
    const isFlowD =
      target.flashMethod === "alif_mram_jlink" ||
      targetArgs["jlink_flash_device"] !== undefined;
    if (!isFlowD) continue;
    for (const key of ["atoc", "atoc_map", "atoc_address"]) {
      if (targetArgs[key] !== undefined && targetArgs[key] !== null) {
        return refuse(
          `${target.id} supplies its own ATOC (${key}) in ${MANIFEST_FILE}, ` +
            "which tan writes as a separate boot table that this confirmation " +
            "does not describe — so nothing was written.",
          manifestPath,
        );
      }
    }
  }

  const digest = digestOf(text);

  // Everything below needs tan's own account of what this argv would do, and
  // the runner that can supply it. A caller that offers none cannot arm and
  // cannot be shown a truthful modal either.
  if (!deps) {
    return refuse(
      "Alp cannot preview this flash, so nothing was written. Flash again " +
        "from the Alp panel.",
    );
  }

  // The SETOOLS install tan will be pointed at. An operator-named source is
  // the only kind tan executes for a write; the extension host's
  // `SETOOLS_DIR` is one, so it is forwarded as the flag, which also outranks
  // whatever the login shell's profile exports.
  const setools = argv.setoolsDir ?? setoolsDirFromEnv();
  const baseArgs =
    setools !== null && argv.setoolsDir === null
      ? withSetoolsDir(args, setools)
      : [...args];

  const preview = await previewOf(deps, baseArgs, cwd);
  if (preview === "cancelled") return cancelled("preview cancelled");
  if (preview === null) {
    return refuse(
      "tan returned no preview for this flash, so Alp cannot say what it " +
        "would write and nothing was written.",
      args.join(" "),
    );
  }

  // `--core` leaves the other slices out of the ATOC a Flow D write signs, and
  // tan reports that only in prose. Ask for the whole board too, so the gate
  // can compare structured entry lists rather than parse a sentence.
  const isScoped = argv.coreId !== null;
  const needsWholeBoard =
    isScoped &&
    preview.entries.some((e) => classifyBackend(e.method) === "flow-d");
  const wholePreview = needsWholeBoard
    ? await previewOf(deps, withoutCore(baseArgs), cwd)
    : null;
  if (wholePreview === "cancelled") return cancelled("preview cancelled");
  const wholeBoard = wholePreview;

  // The previews take a while (they sign an ATOC); the manifest they described
  // has to be the one still on disk before anything is shown about it.
  if (!manifestUnchanged(manifestPath, digest)) return null;

  const decision = decideFlashArming(preview, {
    scoped: isScoped,
    wholeBoard,
  });
  if (decision.kind === "refuse") {
    log(`[flash] refused (${decision.reason}): ${decision.detail ?? ""}`);
    return refuse(
      decision.message,
      decision.detail,
      decision.detail === undefined ? undefined : [{ id: "showOutput" }],
    );
  }

  // ONE action, so "Write to Device" is the first button and therefore the
  // Enter-key default of the modal — a deliberate decision, not an inherited
  // one. VS Code's modal API gives no way to focus Cancel: `MessageItem`'s
  // `isCloseAffordance` only picks which item a DISMISS returns, and items are
  // rendered ahead of the Cancel VS Code appends. The alternatives were a
  // decoy first button (a control that does nothing is worse than a default
  // that does something) or a typed-confirmation QuickPick (which is not a
  // blocking modal at all and can be dismissed by clicking away). So the
  // default stays on the destructive verb, matching this extension's other
  // destructive confirms, and the mitigations are structural: the modal is
  // blocking, the button says the CONSEQUENCE ("Write to Device", not
  // "Flash"), and `describeFlashConsent` puts the irreversibility sentence
  // LAST, immediately above the buttons, rather than at the top where a long
  // manifest scrolls it away.
  const picked = await notify(
    planConfirm({
      message: flashConsentMessage(plan),
      modalDetail: describeFlashConsent(
        plan,
        { projectDir: cwd, manifestPath },
        describeFlashPreview(preview, decision),
      ),
      confirm: { id: "flashDevice" },
    }),
  );
  if (picked !== "flashDevice") return cancelled("consent declined");

  // Consent is a SNAPSHOT, and the modal can sit open for as long as the
  // customer leaves it open. tan re-reads this file at spawn, and the run-name
  // reservation only blocks a second dispatch under the same name — an
  // external `tan build`, a second VS Code window, or a colleague's script can
  // rewrite `build/` in between. Accepting then would program slices the
  // dialog never showed. So the bytes are proved unchanged before the flag
  // goes on; anything else (including the file having vanished) is refused
  // with an instruction to re-open the dialog, never silently re-planned
  // against the new contents.
  if (!manifestUnchanged(manifestPath, digest)) return null;

  let argvOut: string[] = [...args];
  if (decision.kind === "arm-flow-d") {
    // The SECOND consent, on its own modal and never implied by the first.
    // The first said "write these slices"; this one says "and the boot table
    // those slices live in is replaced, so anything resident that the new
    // table does not name is delisted" — a different act, with a different
    // button, and one tan itself refuses without a separate acknowledgement.
    // There is no "don't ask again": the resident table differs per board and
    // per day.
    const replace = await notify(
      planConfirm({
        message: atocReplacementMessage(plan.sku),
        modalDetail: describeAtocReplacement(decision),
        confirm: { id: "replaceBootTable" },
      }),
    );
    if (replace !== "replaceBootTable") {
      return cancelled("boot-table replacement declined");
    }
    // Proved again: the second modal can sit open as long as the first.
    if (!manifestUnchanged(manifestPath, digest)) return null;

    argvOut = acknowledgeAtocReplacement(armFlashArgv(baseArgs));
  }

  log(
    `[flash] consent granted for ${plan.targets.length} target(s) in ${manifestPath}` +
      (decision.kind === "arm-flow-d" ? " (Flow D armed)" : " (not armed)"),
  );
  // Only an ARMED Flow D run is read back as JSON: its verdict (refused vs
  // partly written) cannot come from an exit status. Every other scope keeps
  // the text-mode streamed run, so west's and cmake's own output still reaches
  // the log live and the exit-code path is unchanged.
  if (decision.kind === "arm-flow-d") {
    return { argv: jsonFlashArgv(argvOut), readEnvelope: true };
  }
  // Unarmed, but with entries tan only previews (yocto, xspi) beside ones it
  // writes: the exit status is 0 and a text-mode "finished" toast would say the
  // board was flashed. Read the envelope so the toast names what was not
  // written. Purely-writing scopes keep the text stream.
  if (decision.previewOnly.length > 0) {
    return { argv: jsonFlashArgv(args), readEnvelope: true };
  }
  return passThrough(args);

  /** Decline: say so, spawn nothing. "Cancelled", never a failure. */
  function cancelled(why: string): null {
    log(`[flash] ${why} — nothing spawned, nothing written`);
    notifyAsync(
      planSuccess("Alp Flash cancelled — nothing was written to the device."),
    );
    return null;
  }

  /** The manifest the modal described is still the manifest on disk. */
  function manifestUnchanged(file: string, expected: string): boolean {
    let after: string;
    try {
      after = fs.readFileSync(file, "utf8");
    } catch (error) {
      refuse(
        `This project's ${MANIFEST_FILE} disappeared while the confirmation ` +
          "was open, so nothing was written. Build the project again, then " +
          "flash.",
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (digestOf(after) !== expected) {
      refuse(
        `This project's ${MANIFEST_FILE} changed while the confirmation was ` +
          "open, so nothing was written — what you approved is not what would " +
          "have been programmed. Run the flash again to see the current list.",
        file,
      );
      return false;
    }
    return true;
  }
}
