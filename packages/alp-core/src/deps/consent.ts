// SPDX-License-Identifier: Apache-2.0
//
// The ITEMS behind ADR 0021 §3's one consent screen (#467). Pure: the screen
// itself is `confirmDependencyInstalls` (`src/deps/vscodeAdapter.ts`).
//
// ADR 0021 §3 asks for one screen listing **artifact, source, size and licence**
// per item, over three tiers. This module builds the first half of that and
// deliberately does NOT build the second, for a measured reason:
//
//   No producer can express a tier, a licence or a size today. Measured on
//   alp-sdk `metadata/bootstrap.json` at the vendored v0.15.0 pin (top-level
//   keys: `_comment`, `schemaVersion`, `zephyr`, `venv`, `prerequisites`,
//   `west`, `pip`, `verdict`, `env`, `nativeLibHints`, `manualInstallHints`)
//   and on `tan doctor --format json` at the 0.6.0-rc1 pin (check rows are
//   `name` / `status` / `scope` / `detail` / `fix`). Neither side carries
//   `tier`, `licence`, `source` or `size`. Filed as alp-sdk#1574.
//
// #467 states the constraint this creates: a tier "should arrive with the
// install data ... not be hardcoded as a TypeScript allowlist keyed on tool
// name". So `size` and `licence` are `null` and the screen renders "not
// reported", and there is no tier field here at all. The alternative — a local
// table — would put a LICENSING claim (Tier C exists because of Segger's J-Link
// and the vendor NPU compilers) in a module with no authority to make one, and
// would go stale the first time tan adds a check.
//
// The one derived field is `needsElevation`, and it is derived from the
// PRODUCER's own command text — does the line tan emitted invoke `sudo` — never
// from the tool's name. Reading what a command does is not the same act as
// opining about what an artifact is, which is why this one is allowed and a
// tier table is not.

import { type BootstrapHost, fixCommand } from "../toolchain/bootstrapPlan";
import type { DependencyActionEffect, DependencyRow } from "./planner";

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
   * What will actually run (a command line, verbatim) or open (a URL), or
   * `null` when the row carries no action at all. Never paraphrased: a consent
   * screen that summarises the command is a screen a security team cannot use.
   */
  source: string | null;
  /** Producer-reported download size. `null` today — nothing reports one. */
  size: string | null;
  /** Producer-reported licence. `null` today — nothing reports one. */
  licence: string | null;
  /** True when the PRODUCER's command text asks for elevation. */
  needsElevation: boolean;
  /** The action's own effect, unchanged — `install`, `open-docs`, `bootstrap`. */
  effect: DependencyActionEffect | null;
  /** The action's own tooltip, unchanged. */
  title: string | null;
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
 * What a row's action will run or open, verbatim.
 *
 * A `fix` row is resolved through `fixCommand` for the SAME host the dispatch
 * uses, because the answer genuinely differs: `west` is a pip command on win32
 * and a whole `tan bootstrap` run everywhere else. Describing the wrong one
 * would make the consent screen name something other than what runs.
 */
function sourceFor(row: DependencyRow, host: BootstrapHost): string | null {
  if (!row.action) return null;
  if (row.action.kind === "command") return row.action.command;
  const result = fixCommand(row.action.fixId, host);
  switch (result.kind) {
    case "command":
      return result.step.command;
    // The resolved binary is a host fact (`alpSdk.cliPath`, the managed cache,
    // or a global `tan`), so the command is named by its argv rather than by a
    // path this module cannot know.
    case "bootstrap":
      return "tan bootstrap";
    case "pointer":
      return result.pointer.url;
    case "guide":
      return result.guide.docUrl;
  }
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
    return {
      name: row.name,
      artifact: row.label,
      source,
      size: null,
      licence: null,
      needsElevation: source !== null && commandNeedsElevation(source),
      effect: row.action?.effect ?? null,
      title: row.action?.title ?? null,
    };
  });
}
