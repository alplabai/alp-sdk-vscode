// SPDX-License-Identifier: Apache-2.0
//
// Reading and arming a `tan flash` argv. Pure: no `vscode`, no `fs`, no
// `child_process`, and no path joining either — WHERE the manifest lives is
// resolved by the caller that has a filesystem (`src/flash/gate.ts`); this
// module only says which argv tokens the answer depends on.
//
// ── THE ARITY TABLES ARE NOT DECORATION ────────────────────────────────────
//
// `["flash", "--core", "m55_hp"]` has ZERO positionals because `--core`
// swallows its value, while the same token after a boolean flag is the
// APP_PATH positional — and APP_PATH is what decides where
// `build/system-manifest.yaml` is read from (`tan flash --help` at the
// 0.6.0 pin, verbatim: "`build_root` defaults to <APP_PATH>/build").
// Getting that wrong points the consent screen at a different project than the
// one being written.
//
// Both tables are transcribed from `test/golden/tan-surface/surface.json`, the
// vendored capture of the pinned CLI's real surface, and
// `test/flash.consent.test.js` re-derives BOTH from that file in BOTH
// directions on every run. That gate is load-bearing rather than tidy: a
// re-pin (0.6.0 GA is already planned) that adds, drops or re-arities one
// option would otherwise leave this file a stale hand copy, and the failure
// mode of a stale copy is the dialog naming one thing while the spawn writes
// another. #520 changed the pin under a feature once and nothing re-probed the
// surface; that is the lesson this pair of tables is answering.
//
// ── WHY THERE ARE TWO OF THEM ──────────────────────────────────────────────
//
// `tan` takes options in TWO positions, and they are different sets:
//
//   tan [ROOT OPTIONS] <command> [COMMAND OPTIONS] [POSITIONALS]
//
// The command is therefore NOT always argv[0]. `src/west.ts` already builds
// `["--project", <dir>, "build"]` for the Build command, and the runner itself
// prepends `["--sdk-root", <path>, …]` (`withSdkRoot`) to everything it
// spawns. Reading the command as argv[0] would classify `["--project", d,
// "flash"]` as "not a flash", skip the dialog entirely, and hand tan a bare
// unarmed flash — the original #540 symptom, except that with
// `ALP_FLASH_FORCE=1` in the user's environment (which the child inherits) tan
// arms itself and writes silicon with nothing on screen.
//
// So the command is found the way `scripts/tan-surface/extract.mjs` finds it:
// walk from the left, skip root-position flags HONOURING THEIR ARITY, and take
// the first token that is neither a flag nor some flag's value. Two readers
// disagreeing about what a flash is was finding #1 of the #540 review; they
// now share one rule, and `test/flash.dispatch.test.js` asserts that every
// site the extractor calls `flash` is a site `isFlashArgv` recognises.

/**
 * Options of `tan flash` that CONSUME the next token, at the 0.6.0 pin.
 *
 * Exactly the entries of `commands.flash.options` carrying a `metavar` in the
 * vendored surface (their metavars: PATH, PATH, CORE_ID, <text|json>, NAME,
 * PATH, PATH, PATH). The five booleans — `--confirm`, `--dry-run`, `--help`,
 * `--recover`, `--skip-missing-tools` — are deliberately absent: this set is
 * consulted only to decide whether to skip a token.
 */
export const FLASH_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
  "--board-yaml",
  "--build-root",
  "--core",
  "--format",
  "--helper",
  "--project",
  "--sdk-root",
  "--setools-dir",
]);

/**
 * ROOT-position options that consume the next token, at the 0.6.0 pin.
 *
 * Exactly the members of the surface's `globalOptions` that carry a `metavar`
 * in some command's option map. `globalOptions` is a bare name list with no
 * arity of its own, so the arity comes from the per-command declarations —
 * the same union `scripts/tan-surface/extract.mjs` builds, and for the same
 * reason. The seven boolean globals (`--all`, `--verbose`, `--quiet`,
 * `--no-color`, `--non-interactive`, `--ci`, `--help`) are absent.
 *
 * RESTRICTED TO THE GLOBALS ON PURPOSE, rather than reusing the whole union:
 * root position accepts only global options, and a non-global flag there makes
 * tan exit 2 with `No such option` before anything runs. Modelling it as
 * value-taking would only mean asking for consent to a run that cannot start.
 *
 * The residual hole is a FUTURE global option this pin does not know: an
 * unknown flag reads as boolean, so its value would be mistaken for the
 * command and a flash behind it would go unrecognised. Two things close it —
 * the drift gate above (a re-pin that adds a global reds the test), and
 * `src/flash/gate.ts`'s refusal of any argv that mentions `flash` without
 * resolving to it.
 */
export const ROOT_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
  "--board-yaml",
  "--format",
  "--project",
  "--sdk-root",
  "--target",
]);

/** The flag that arms tan's confirm gate. One spelling, named once. */
export const FLASH_CONFIRM_FLAG = "--confirm";

/** `tan`'s flash command name, so no call site re-types the string. */
export const FLASH_COMMAND = "flash";

/** Everything about a flash argv the consent gate has to know. */
export interface FlashArgv {
  /** Index of the command token in `args`, or -1 when the argv is all flags. */
  commandIndex: number;
  /** `--core`'s value, or null. */
  coreId: string | null;
  /** `--helper`'s value, or null. */
  helperName: string | null;
  /** The APP_PATH positional, or null. Relative paths are left as written. */
  appPath: string | null;
  /** `--build-root`'s value, or null. Overrides the APP_PATH derivation. */
  buildRoot: string | null;
  /** `--dry-run`: previews and writes nothing, so it needs no consent. */
  isDryRun: boolean;
  /** `--confirm` already written at the call site. */
  isArmed: boolean;
  /** `--recover`: a production helper-MCU recovery flash. Refused upstream of here. */
  isRecovery: boolean;
  /**
   * `--project` was written, in EITHER position. Refused rather than read:
   * this repo cannot say whether tan anchors the flash on it or on APP_PATH,
   * and the two can name different projects. See `src/flash/gate.ts`.
   */
  hasProjectFlag: boolean;
  /**
   * Value-taking flags with NOTHING after them — `["flash", "--core"]`. tan
   * exits 2 (`Option '--core' requires an argument`) without running, so a
   * dialog over one of these collects consent for a run that cannot happen.
   */
  danglingFlags: readonly string[];
  /** Positionals beyond APP_PATH — tan accepts at most one. */
  extraPositionals: readonly string[];
}

/** A `-`-leading token that is an OPTION, not a positional. `-` alone is the
 *  stdin convention and `--` is the end-of-options marker; neither is a flag.
 *  Same rule as the extractor's `isFlagToken`. */
function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token !== "-" && token !== "--";
}

/** Split `--core=m55_hp` into its name and its attached value. An `=` at index
 *  0 or 1 is not a separator (`-=x` is not a named option), matching the
 *  extractor's `eq > 1` test. */
function splitFlag(token: string): { name: string; inline?: string } {
  const eq = token.indexOf("=");
  return eq > 1
    ? { name: token.slice(0, eq), inline: token.slice(eq + 1) }
    : { name: token };
}

/**
 * Index of the COMMAND token — the first token that is neither a root-position
 * flag nor a root flag's value — or -1 when there is none.
 *
 * This is the whole of the "what is a flash" rule, in one place, so that
 * `isFlashArgv`, `readFlashArgv` and `armFlashArgv` cannot drift apart.
 */
function commandIndexOf(args: readonly string[]): number {
  let endOfOptions = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!endOfOptions && token === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && isFlagToken(token)) {
      const { name, inline } = splitFlag(token);
      if (inline === undefined && ROOT_VALUE_TAKING_FLAGS.has(name)) i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

/** True when this argv drives `tan flash` — wherever the command sits. Root
 *  flags before it (the runner's own `--sdk-root <path>`, a call site's
 *  `--project <dir>`) are skipped with their values, exactly as tan skips
 *  them. */
export function isFlashArgv(args: readonly string[]): boolean {
  const at = commandIndexOf(args);
  return at >= 0 && args[at] === FLASH_COMMAND;
}

/**
 * Reduce a flash argv to the facts the consent gate needs.
 *
 * Tolerant by design: an unknown flag is treated as a boolean (it consumes
 * nothing), which within the COMMAND segment can only ever mis-read a token as
 * a positional. That direction is the safe one — a spurious APP_PATH makes the
 * gate look for a manifest that is not there and REFUSE, where the opposite
 * error would let it consent against the wrong project's manifest.
 *
 * The ROOT segment is read far more narrowly, and deliberately: only
 * `--project` (refused) and a dangling value (refused) are taken from it.
 * `--dry-run`, `--confirm` and `--recover` are read ONLY after the command,
 * because they are not global options — honouring a root-position `--dry-run`
 * would let an argv tan rejects outright talk its way past the consent gate.
 */
export function readFlashArgv(args: readonly string[]): FlashArgv {
  const commandIndex = commandIndexOf(args);
  let coreId: string | null = null;
  let helperName: string | null = null;
  let buildRoot: string | null = null;
  let isDryRun = false;
  let isArmed = false;
  let isRecovery = false;
  let hasProjectFlag = false;
  const danglingFlags: string[] = [];
  const positionals: string[] = [];
  let endOfOptions = false;

  for (let i = 0; i < args.length; i++) {
    // The command names itself; it is never a positional OF itself.
    if (i === commandIndex) continue;
    const token = args[i];
    if (!endOfOptions && token === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && isFlagToken(token)) {
      const beforeCommand = commandIndex < 0 || i < commandIndex;
      const table = beforeCommand
        ? ROOT_VALUE_TAKING_FLAGS
        : FLASH_VALUE_TAKING_FLAGS;
      const { name, inline } = splitFlag(token);
      const takesValue = table.has(name);
      const value = inline ?? (takesValue ? args[i + 1] : undefined);
      if (inline === undefined && takesValue) {
        if (i + 1 >= args.length) danglingFlags.push(name);
        i += 1;
      }

      if (name === "--project") hasProjectFlag = true;
      if (beforeCommand) continue;
      if (name === "--core") coreId = value ?? null;
      else if (name === "--helper") helperName = value ?? null;
      else if (name === "--build-root") buildRoot = value ?? null;
      else if (name === "--dry-run") isDryRun = true;
      else if (name === FLASH_CONFIRM_FLAG) isArmed = true;
      else if (name === "--recover") isRecovery = true;
      continue;
    }
    positionals.push(token);
  }

  return {
    commandIndex,
    coreId,
    helperName,
    appPath: positionals[0] ?? null,
    buildRoot,
    isDryRun,
    isArmed,
    isRecovery,
    hasProjectFlag,
    danglingFlags,
    extraPositionals: positionals.slice(1),
  };
}

/**
 * Return a copy of `args` carrying `--confirm`, inserted immediately after the
 * command.
 *
 * IMMUTABLE — the caller's array is never touched, so a refused consent leaves
 * nothing armed behind it.
 *
 * Position matters: appending at the END would put an option after the
 * APP_PATH positional. Directly after the command is the one placement no
 * parser can read as anything else — and "after the command" means after the
 * command WHEREVER IT SITS, not after argv[0], so a root flag in front of it
 * (`["--sdk-root", p, "flash"]`) does not turn `--confirm` into that flag's
 * value. An argv that already carries `--confirm` is returned unchanged rather
 * than given a second copy — the flag is a boolean, and consent has already
 * been obtained by the time this is called.
 */
export function armFlashArgv(args: readonly string[]): string[] {
  const argv = readFlashArgv(args);
  if (argv.isArmed || argv.commandIndex < 0) return [...args];
  const at = argv.commandIndex;
  return [...args.slice(0, at + 1), FLASH_CONFIRM_FLAG, ...args.slice(at + 1)];
}
