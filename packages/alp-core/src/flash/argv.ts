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
 * Options of `tan flash` that CONSUME the next token, at the 0.7.0 pin.
 *
 * Exactly the entries of `commands.flash.options` carrying a `metavar` in the
 * vendored surface. Six of them — `--jlink PATH`, `--probe-serial SN`,
 * `--probe-usb-path BUS-PORT`, `--raw FILE@ADDR`, `--wait SECONDS` and
 * `--watch ADDR[:WORDS][@PERIOD-MS]` — arrived in 0.7.0-rc1 and were carried
 * here ahead of the pin (#701) until it moved onto them. The booleans
 * (`--confirm`, `--dry-run`, `--recover`, `--ram`, `--ram-console`, …) are
 * deliberately absent: these lists are consulted only to decide whether to
 * skip a token.
 */
const PINNED_FLASH_VALUE_TAKING_FLAGS = [
  "--board-yaml",
  "--build-root",
  "--core",
  "--format",
  "--helper",
  "--jlink",
  "--probe-serial",
  "--probe-usb-path",
  "--project",
  "--raw",
  "--sdk-root",
  "--setools-dir",
  "--wait",
  "--watch",
] as const;

/**
 * Value-taking `tan flash` options known from a tan NEWER than the pin.
 *
 * Empty at 0.7.0: the six #701 added here moved into the pinned list above
 * with the re-pin. Kept as a slot because `alpSdk.cliPath` can point the
 * extension at a newer tan than the pin, and a value-taker this file does not
 * know reads as boolean, leaving its value to be taken for APP_PATH.
 *
 * `test/flash.consent.test.js` asserts that no entry here is in the vendored
 * surface, so the re-pin that vendors one reds the gate until it moves.
 */
export const FLASH_VALUE_TAKING_FLAGS_AHEAD_OF_PIN: ReadonlySet<string> =
  new Set<string>();

/** Every `tan flash` option that consumes the next token: the pinned surface
 *  plus any known to be coming. */
export const FLASH_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
  ...PINNED_FLASH_VALUE_TAKING_FLAGS,
  ...FLASH_VALUE_TAKING_FLAGS_AHEAD_OF_PIN,
]);

/**
 * ROOT-position options that consume the next token, at the 0.7.0 pin.
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

/**
 * The ONLY `tan flash` options the gate lets through, mapped to whether each
 * takes a value. Everything else is refused, so a flag this build has not
 * modelled can neither change what is written nor desynchronise the gate's
 * reading of the argv from tan's (Typer/Click).
 *
 * - used by the extension: `--core`, `--dry-run`, `--sdk-root` (the runner adds
 *   it), `--format` (the gate adds it);
 * - safely tolerated, and carried through to the preview and the write:
 *   `--setools-dir`, `--probe-serial`, `--probe-usb-path`, `--jlink`;
 * - recognised only so a dedicated, clearer refusal can fire: `--confirm` and
 *   `--atoc-unqueryable` (the gate adds both itself), `--recover`, `--project`.
 *
 * `test/flash.options.test.js` walks this table against the recorded surface,
 * so a rename or an arity change in a future pin goes red.
 *
 * Click rules this reader mirrors: no long-option abbreviation (`--cor` is not
 * `--core`); a value-taking option consumes the NEXT token unconditionally —
 * even one that starts with `--`; `--opt=value` is one token; `--` ends
 * options. tan's `cli.py` also hoists global options written after the
 * subcommand, which is why `--sdk-root` and `--format` are read in either
 * position with the same arity.
 */
export const FLASH_ALLOWED_OPTIONS: Readonly<Record<string, boolean>> = {
  "--core": true,
  "--setools-dir": true,
  "--probe-serial": true,
  "--probe-usb-path": true,
  "--jlink": true,
  "--format": true,
  "--sdk-root": true,
  "--dry-run": false,
  "--confirm": false,
  "--atoc-unqueryable": false,
  "--recover": false,
  "--project": true,
};

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
  /** `--atoc-unqueryable` already written at the call site. The gate adds it itself, after its own modal. */
  hasAtocUnqueryable: boolean;
  /** `--setools-dir`'s value, or null. */
  setoolsDir: string | null;
  /**
   * Option tokens that are not in `FLASH_ALLOWED_OPTIONS`: raw and RAM writes,
   * ATOC replacement, reset suppression, an unknown or abbreviated flag, a
   * short option. Refused like `--recover`: the consent screen and the preview
   * describe a plain flash.
   */
  unmodelledFlags: readonly string[];
  /**
   * Allowed value-taking options whose value starts with `-` (`--core
   * --confirm`). Click hands that token to the option as its value, and this
   * reader does the same — but nothing legitimate looks like that, so the gate
   * refuses it rather than trust the two parsers to agree.
   */
  suspectValues: readonly string[];
  /** A `--` appeared before the command. Refused by the gate: no call site
   *  writes one, and the two parsers must not be left to agree about it. */
  hasRootEndOfOptions: boolean;
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
  let hasAtocUnqueryable = false;
  let setoolsDir: string | null = null;
  const unmodelledFlags: string[] = [];
  let hasRootEndOfOptions = false;
  const suspectValues: string[] = [];
  let hasProjectFlag = false;
  const danglingFlags: string[] = [];
  const positionals: string[] = [];
  let endOfOptions = false;

  for (let i = 0; i < args.length; i++) {
    // The command names itself; it is never a positional OF itself.
    if (i === commandIndex) continue;
    const token = args[i];
    if (!endOfOptions && token === "--") {
      // A `--` BEFORE the command ends only the root's options: Click starts
      // the subcommand's option parsing fresh, so `-- flash --confirm` arms.
      // Carrying it past the command read `--confirm` as a positional here
      // while tan read it as the flag. Recorded and refused by the gate.
      if (commandIndex < 0 || i < commandIndex) {
        hasRootEndOfOptions = true;
        continue;
      }
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
      if (!Object.hasOwn(FLASH_ALLOWED_OPTIONS, name)) {
        unmodelledFlags.push(name);
      } else if (takesValue && value !== undefined && value.startsWith("-")) {
        suspectValues.push(name);
      }
      if (beforeCommand) continue;
      if (name === "--core") coreId = value ?? null;
      else if (name === "--helper") helperName = value ?? null;
      else if (name === "--build-root") buildRoot = value ?? null;
      else if (name === "--dry-run") isDryRun = true;
      else if (name === FLASH_CONFIRM_FLAG) isArmed = true;
      else if (name === "--recover") isRecovery = true;
      else if (name === "--atoc-unqueryable") hasAtocUnqueryable = true;
      else if (name === "--setools-dir") setoolsDir = value ?? null;
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
    hasAtocUnqueryable,
    setoolsDir,
    unmodelledFlags,
    hasRootEndOfOptions,
    suspectValues,
    hasProjectFlag,
    danglingFlags,
    extraPositionals: positionals.slice(1),
  };
}

/**
 * Return a copy of `args` with `flags` inserted immediately after the command.
 *
 * IMMUTABLE — the caller's array is never touched, so a refused consent leaves
 * nothing armed behind it.
 *
 * Position matters: appending at the END would put an option after the
 * APP_PATH positional. Directly after the command is the one placement no
 * parser can read as anything else — and "after the command" means after the
 * command WHEREVER IT SITS, not after argv[0], so a root flag in front of it
 * (`["--sdk-root", p, "flash"]`) does not turn an inserted flag into that
 * flag's value. An argv with no command is returned unchanged.
 */
function insertAfterCommand(
  args: readonly string[],
  flags: readonly string[],
): string[] {
  const at = commandIndexOf(args);
  if (at < 0) return [...args];
  return [...args.slice(0, at + 1), ...flags, ...args.slice(at + 1)];
}

/**
 * Return a copy of `args` carrying `--confirm`. An argv that already carries it
 * is returned unchanged rather than given a second copy — the flag is a
 * boolean, and consent has already been obtained by the time this is called.
 */
export function armFlashArgv(args: readonly string[]): string[] {
  if (readFlashArgv(args).isArmed) return [...args];
  return insertAfterCommand(args, [FLASH_CONFIRM_FLAG]);
}

/** The acknowledgement tan's Flow D write demands (tan-cli#1252). */
export const ATOC_UNQUERYABLE_FLAG = "--atoc-unqueryable";

/** Add `--atoc-unqueryable`. Only after the customer has said yes to the
 *  boot-table replacement on its own modal. */
export function acknowledgeAtocReplacement(args: readonly string[]): string[] {
  if (readFlashArgv(args).hasAtocUnqueryable) return [...args];
  return insertAfterCommand(args, [ATOC_UNQUERYABLE_FLAG]);
}

/** Name the SETOOLS install to sign with. `--setools-dir` outranks the
 *  environment and the manifest, and is the only source tan will EXECUTE for a
 *  confirmed write that the operator did not name. */
export function withSetoolsDir(args: readonly string[], dir: string): string[] {
  if (readFlashArgv(args).setoolsDir !== null) return [...args];
  return insertAfterCommand(args, ["--setools-dir", dir]);
}

/** The preview of `args`: the same run, `--dry-run`, as a JSON envelope. */
export function previewFlashArgv(args: readonly string[]): string[] {
  return insertAfterCommand(args, ["--dry-run", "--format", "json"]);
}

/** The real run of `args`, read back as a JSON envelope. */
export function jsonFlashArgv(args: readonly string[]): string[] {
  return insertAfterCommand(args, ["--format", "json"]);
}

/** `args` without `--core` (either spelling): the whole-board form of a
 *  per-slice flash. */
export function withoutCore(args: readonly string[]): string[] {
  const commandIndex = commandIndexOf(args);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (commandIndex >= 0 && i > commandIndex && isFlagToken(token)) {
      const { name, inline } = splitFlag(token);
      if (name === "--core") {
        if (inline === undefined) i += 1;
        continue;
      }
      if (inline === undefined && FLASH_VALUE_TAKING_FLAGS.has(name)) {
        out.push(token);
        if (i + 1 < args.length) out.push(args[i + 1]);
        i += 1;
        continue;
      }
    }
    out.push(token);
  }
  return out;
}
