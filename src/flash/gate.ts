// SPDX-License-Identifier: Apache-2.0
//
// The consent gate every `tan flash` dispatch passes through (#540).
//
// ── WHY IT LIVES INSIDE THE RUNNER AND NOT AT THE CALL SITES ───────────────
//
// `runAlpStreamed` calls `armFlashDispatch` unconditionally, on every argv,
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
//   2. `--dry-run`?               returned unchanged and UNARMED. tan's own
//                                 help says a dry run prints what each backend
//                                 would do "without spawning", so there is no
//                                 write to consent to.
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
//      scope and what the scope skips, and a BLOCKING modal asks. Only its
//      accept adds `--confirm` — and only after the manifest is re-read and
//      proved BYTE-IDENTICAL to the one the dialog described.
//
// `ALP_FLASH_FORCE=1` and `flash_args.confirm: true` are the two other ways to
// arm tan's gate. NEITHER is used, here or anywhere: the first would put the
// consent in an environment variable that outlives the click, and the second
// would write it into a generated file the next `tan build` rewrites.

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import {
  armFlashArgv,
  FLASH_COMMAND,
  isFlashArgv,
  readFlashArgv,
} from "@alp-sdk/core/flash/argv";
import { planFlashConsent } from "@alp-sdk/core/flash/consent";
import {
  describeFlashConsent,
  flashConsentMessage,
} from "@alp-sdk/core/flash/describe";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";

import { planConfirm, planFailure, planSuccess } from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { log } from "../util";

/** The manifest's name as the customer knows it, relative to the build root.
 *  Kept out of the toast text as an absolute path on purpose — `planFailure`
 *  demotes a `cause` carrying one into the channel-only `detail` and replaces
 *  the sentence with "<operation> failed.", which is the exact claim this
 *  change exists to stop making. */
const MANIFEST_FILE = "system-manifest.yaml";

/**
 * Where `tan flash` reads its manifest from.
 *
 * MEASURED, on the pinned 0.6.0-rc1 binary, `tan flash --help` verbatim:
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
 * dialog-names-one-thing-spawn-writes-another failure, so `armFlashDispatch`
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
function refuse(cause: string, detail?: string): null {
  notifyAsync(
    planFailure({
      severity: "warning",
      operation: "Alp Flash",
      cause,
      detail,
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

/**
 * Gate a dispatch. Returns the argv to spawn — `--confirm` added when, and
 * only when, a human accepted the modal — or `null` when nothing may be
 * spawned at all.
 *
 * A non-flash argv is returned unchanged after one left-to-right scan of the
 * argv (`isFlashArgv`), which is what lets the caller apply this to every
 * streamed run rather than remembering which ones write hardware.
 */
export async function armFlashDispatch(
  args: readonly string[],
  cwd: string | undefined,
): Promise<string[] | null> {
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
    return [...args];
  }

  const argv = readFlashArgv(args);

  // Writes nothing by tan's own contract, so there is nothing to consent to —
  // and arming it would turn a preview into a write.
  if (argv.isDryRun) {
    log("[flash] --dry-run: previewing only, the confirm gate is not armed");
    return [...args];
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

  const digest = digestOf(text);
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
      modalDetail: describeFlashConsent(plan, {
        projectDir: cwd,
        manifestPath,
      }),
      confirm: { id: "flashDevice" },
    }),
  );
  if (picked !== "flashDevice") {
    log("[flash] consent declined — nothing spawned, nothing written");
    notifyAsync(
      planSuccess("Alp Flash cancelled — nothing was written to the device."),
    );
    return null;
  }

  // Consent is a SNAPSHOT, and the modal can sit open for as long as the
  // customer leaves it open. tan re-reads this file at spawn, and the run-name
  // reservation only blocks a second dispatch under the same name — an
  // external `tan build`, a second VS Code window, or a colleague's script can
  // rewrite `build/` in between. Accepting then would program slices the
  // dialog never showed. So the bytes are proved unchanged before the flag
  // goes on; anything else (including the file having vanished) is refused
  // with an instruction to re-open the dialog, never silently re-planned
  // against the new contents.
  let after: string;
  try {
    after = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    return refuse(
      `This project's ${MANIFEST_FILE} disappeared while the confirmation ` +
        "was open, so nothing was written. Build the project again, then " +
        "flash.",
      `${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (digestOf(after) !== digest) {
    return refuse(
      `This project's ${MANIFEST_FILE} changed while the confirmation was ` +
        "open, so nothing was written — what you approved is not what would " +
        "have been programmed. Run the flash again to see the current list.",
      manifestPath,
    );
  }

  log(
    `[flash] consent granted for ${plan.targets.length} target(s) in ${manifestPath} — arming --confirm`,
  );
  return armFlashArgv(args);
}
