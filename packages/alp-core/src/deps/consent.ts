// SPDX-License-Identifier: Apache-2.0
//
// The ITEMS behind ADR 0021 §3's one consent screen (#467). Pure: the screen
// itself is `confirmDependencyInstalls` (`src/deps/vscodeAdapter.ts`).
//
// ADR 0021 §3 asks for one screen listing **artifact, source, size and licence**
// per item, over three tiers.
//
// `size`, `licence` and `tier` come from the PRODUCER and nowhere else: the
// artifact provenance tan 0.7.0-rc1 (tan-cli#1066) flattens onto each
// `missingPrerequisites[]` entry, which the planner carries on the very
// `DependencyCommandStep` that will run (`./provenance`). There is no table
// keyed on tool name here — a LICENSING claim (Tier C exists because of
// Segger's J-Link and the vendor NPU compilers) needs an authority, and this
// module is not one.
//
// MEASURED, alp-sdk v0.16.0 through v0.17.0-rc2: 8 entries, every one tier
// `"A"`, `sizeBytes` null on all 8, `licence` null for `xz` and `7zip`. So
// today `size` still reads "not reported" everywhere, `licence` is real for
// cmake/ninja/git/python/wget, and rows whose tool has no entry — `west`,
// `zephyrSdk`, `setools`, `jlink`, and every `fix` row — say "not reported"
// for all three. A `B` or `C` tier is wired through (`elevationTier`,
// `licenceGated`) and has no producer instance yet.
//
// `needsElevation` is still derived from the PRODUCER's own command text —
// does the line tan emitted invoke `sudo` — never from the tool's name.

import { type BootstrapHost, fixCommand } from "../toolchain/bootstrapPlan";
import type {
  DependencyActionEffect,
  DependencyCommandStep,
  DependencyRow,
} from "./planner";
import { formatByteCount, type PrerequisiteProvenance } from "./provenance";

/** What a cell says when the producer reports nothing for it. */
export const NOT_REPORTED = "not reported";

/** ADR 0021 §3's tier words this module acts on — producer values, compared
 *  verbatim. `B` installs with elevation; `C` is licence-gated. */
const ELEVATION_TIER = "B";
const LICENCE_GATED_TIER = "C";

/**
 * One line of the consent screen.
 *
 * `name` is tan's check name, verbatim — the row identity the dispatch uses, so
 * a caller can match an item back to the row it consented to without a second
 * lookup that could drift.
 */
export interface ConsentItem {
  name: string;
  /** The row's human label — what the customer is being asked to install. */
  artifact: string;
  /**
   * What will actually run — one line per dispatch, in dispatch order — or
   * open (a URL, as the array's one entry), or `null` when the row carries no
   * action at all. Never paraphrased and never truncated: a `command` row now
   * carries one or more lines (#603), and a consent screen that drops or
   * summarises any of them is a screen a security team cannot use.
   */
  source: readonly string[] | null;
  /**
   * Producer-reported download size, human-formatted, or `null` when no step
   * reports one (every row today — alp-sdk declares `sizeBytes: null`). On a
   * multi-step row whose steps disagree it is per tool:
   * `cmake: 4 MiB; ninja: not reported`.
   */
  size: string | null;
  /** Producer-reported licence, same per-tool rule as `size`. */
  licence: string | null;
  /** Producer-reported tier word, same per-tool rule as `size`. */
  tier: string | null;
  /** True when ANY step's producer tier is `B`: it installs with elevation. */
  elevationTier: boolean;
  /**
   * True when ANY step's producer tier is `C`, licence-gated. Such a line
   * starts UNCHECKED on the consent screen, so it is never fetched without an
   * explicit action of its own.
   */
  licenceGated: boolean;
  /** True when the PRODUCER's command text asks for elevation. */
  needsElevation: boolean;
  /** The action's own effect, unchanged — `install`, `open-docs`, `bootstrap`. */
  effect: DependencyActionEffect | null;
  /**
   * Tool names tan named a NULL command for on this row — carried structurally
   * so the consent screen can say the omission as its own short clause rather
   * than appending the row's whole tooltip sentence, which for a non-partial
   * `command` row duplicated `source` under a second separator and, for a
   * `fix`/`open-docs`/`bootstrap` row, read as a second, competing claim about
   * what pressing the button does (#603, second review, minor 7). Always `[]`
   * outside a partial `command` row.
   */
  omittedTools: readonly string[];
}

/**
 * Command prefixes that ask the operating system for elevated rights.
 *
 * Matched as WORDS, at a command position — after the start of the line, a
 * pipe, a `;`, or an `&&`. A substring match would fire on `apt-get install -y
 * sudoku` and on any path containing "runas", and a consent screen that cries
 * elevation over an ordinary install teaches the customer to ignore the flag.
 */
const ELEVATION_COMMANDS =
  /(?:^|[|;&]\s*|\s&&\s*)\s*(?:sudo|pkexec|doas|runas)(?:\s|$)/i;

/** PowerShell's elevation form, which is a FLAG rather than a command word. */
const ELEVATION_VERB = /-Verb\s+RunAs\b/i;

/** Whether the given command line asks for elevation. */
export function commandNeedsElevation(command: string): boolean {
  return ELEVATION_COMMANDS.test(command) || ELEVATION_VERB.test(command);
}

/**
 * What a row's action will run or open, one line per entry, verbatim.
 *
 * A `fix` row is resolved through `fixCommand` for the SAME host the dispatch
 * uses, because the answer genuinely differs: `west` is a pip command on win32
 * and a whole `tan bootstrap` run everywhere else. Describing the wrong one
 * would make the consent screen name something other than what runs.
 *
 * A `command` row (#603) can carry more than one dispatch — the
 * `hostPrerequisites` rollup names cmake AND ninja — and every one of them
 * reaches this screen; there is no truncation to "the first command".
 */
function sourceFor(
  row: DependencyRow,
  host: BootstrapHost,
): readonly string[] | null {
  if (!row.action) return null;
  if (row.action.kind === "command") {
    return row.action.commands.map((step) => step.command);
  }
  const result = fixCommand(row.action.fixId, host);
  switch (result.kind) {
    case "command":
      return [result.step.command];
    // The resolved binary is a host fact (`alpSdk.cliPath`, the managed cache,
    // or a global `tan`), so the command is named by its argv rather than by a
    // path this module cannot know.
    case "bootstrap":
      return ["tan bootstrap"];
    case "pointer":
      return [result.pointer.url];
    case "guide":
      return [result.guide.docUrl];
  }
}

/** The row's command steps, or `[]` for a `fix` row or no action — those
 *  carry no producer provenance at all. */
function stepsOf(row: DependencyRow): readonly DependencyCommandStep[] {
  return row.action?.kind === "command" ? row.action.commands : [];
}

/**
 * One provenance field across a row's steps. The single value when every step
 * agrees (all `null` stays `null`), else one `tool: value` clause per step in
 * dispatch order, so a rollup row never pins one tool's licence on another.
 * `?? {}` and the optional reads tolerate a step built before `provenance`
 * existed — the row crosses a JS boundary at every call site.
 */
function perTool(
  steps: readonly DependencyCommandStep[],
  read: (provenance: Partial<PrerequisiteProvenance>) => string | null,
): string | null {
  if (steps.length === 0) return null;
  const values = steps.map((step) => read(step.provenance ?? {}));
  if (values.every((value) => value === values[0])) return values[0];
  return steps
    .map((step, index) => `${step.tool}: ${values[index] ?? NOT_REPORTED}`)
    .join("; ");
}

/** Whether any step's producer tier is exactly `tier`. */
function anyTier(
  steps: readonly DependencyCommandStep[],
  tier: string,
): boolean {
  return steps.some((step) => step.provenance?.tier === tier);
}

/**
 * Build one consent item per row, in the caller's order.
 *
 * EVERY row handed in produces an item — there is no filter, no allowlist and
 * no status gate, the same rule `planner.ts` states for rows themselves. The
 * caller passes exactly the rows it is about to dispatch, so item N and
 * dispatch N are the same row; a filter here would let the screen consent to a
 * set the dispatch does not run, which is the failure #467's structural
 * guarantee exists to make impossible.
 */
export function planInstallConsent(
  rows: readonly DependencyRow[],
  host: BootstrapHost,
): ConsentItem[] {
  return rows.map((row) => {
    const source = sourceFor(row, host);
    const steps = stepsOf(row);
    return {
      name: row.name,
      artifact: row.label,
      source,
      size: perTool(steps, (p) =>
        typeof p.sizeBytes === "number" ? formatByteCount(p.sizeBytes) : null,
      ),
      licence: perTool(steps, (p) => p.licence ?? null),
      tier: perTool(steps, (p) => p.tier ?? null),
      elevationTier: anyTier(steps, ELEVATION_TIER),
      licenceGated: anyTier(steps, LICENCE_GATED_TIER),
      // ANY line, not just the first: a multi-step `command` row (#603) whose
      // SECOND line is `sudo apt-get install -y ninja-build` still needs to
      // flag elevation even though its first line does not.
      needsElevation: source !== null && source.some(commandNeedsElevation),
      effect: row.action?.effect ?? null,
      // `?? []` is defensive, not decorative: `row` crosses a JS boundary at
      // every call site in this repo (the webview message pump, a hand-built
      // test fixture), so a caller one version behind this field's own
      // addition must not throw here — an absent array degrades to "nothing
      // omitted" rather than crashing the consent screen.
      omittedTools:
        row.action?.kind === "command" ? (row.action.omittedTools ?? []) : [],
    };
  });
}
