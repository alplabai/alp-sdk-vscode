// SPDX-License-Identifier: Apache-2.0
//
// The dependency table's PURE planner. No vscode / fs / child_process: it takes
// a parsed `tan doctor --build` envelope `data` plus the few facts only the host
// knows (is a bootstrap running, which `tan` resolved) and returns rows.
//
// The one rule this file exists to enforce: **tan owns the facts**. Rows are
// DERIVED from `data.checks[]` — there is no allowlist, no status filter, and no
// gate on the label or fix tables, so a check tan adds tomorrow lights up a row
// here with zero change in this extension. Anything tan does not report is a
// `null` cell (the UI renders a dash) or an issue against tan-cli. It is never a
// TypeScript re-derivation — that is how tan-cli#104/#105 happened.

import {
  type BootstrapHost,
  bootstrapHost,
  fixCommand,
  type ToolchainFixId,
} from "../toolchain/bootstrapPlan";
import type {
  DoctorCheckEnvelope,
  DoctorEnvelopeData,
  MissingPrerequisite,
} from "../cli/doctorEnvelope";
import { type DependencyState, dependencyState } from "./state";

// ── The envelope slice this planner reads (see docs/CLI.md) ──────────────────
//
// The check/envelope shapes themselves live in `../cli/doctorEnvelope` (#376)
// so the debug slice's doctor consumers can read them without importing this
// (deps) slice. Re-exported here so every existing import of this module
// keeps working unchanged.

export type { DoctorCheckEnvelope, DoctorEnvelopeData, MissingPrerequisite };

/**
 * A row's status, VERBATIM from tan. Deliberately `string`, not a union: the
 * planner passes it through untouched, so a status tan adds later must survive
 * the trip instead of being coerced into today's vocabulary. Same underlying
 * concept as `DoctorCheckStatus` (`../cli/doctorEnvelope`), named for this
 * slice's own row shape rather than re-exported, since `DependencyRow` is
 * deps-panel presentation, not the envelope itself.
 */
export type DependencyStatus = string;

// ── Version skew (injected — this repo has exactly one comparator) ───────────

/** The result vocabulary of `cliSkew` (src/alpCli/service.ts). */
export type VersionSkew =
  | "behind"
  | "same"
  | "ahead-minor"
  | "ahead-patch"
  | "unknown";

/**
 * Injected version comparator, shaped to `cliSkew(installed, supported)`. Core
 * must not grow a second SemVer compare — the repo holds exactly one, and two
 * would drift.
 */
export type VersionComparator = (
  installed: string | null,
  target: string,
) => VersionSkew;

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * What "latest" MEANS for a row, spelled out rather than implied.
 *
 * - `"release"` — the thing chases latest, so a newer version genuinely is an
 *   update to offer.
 * - `"pin"` — this extension requires exactly this version. A customer sitting
 *   on a NEWER build must never be told to "update" to an older one, so a pin
 *   never produces `updateAvailable`.
 */
export interface DependencyLatest {
  version: string;
  kind: "release" | "pin";
}

/**
 * What pressing the button ACTUALLY does, so the label can say it.
 *
 * The verb is read off the host's own dispatch (`fixCommand` → `runToolchainFix`
 * / a terminal), never off the row's status:
 *
 * - `"install"` — a command runs on this machine and the tool ends up installed.
 * - `"open-docs"` — a web page opens and NOTHING is installed. The `build-tools`
 *   and `zephyr-sdk` fixes are exactly this, and a button over them labelled
 *   "Install" is the dead-Fix-button bug wearing a stronger verb.
 * - `"bootstrap"` — a whole `tan bootstrap` run starts (venv + west + Zephyr
 *   Python deps), which is a much bigger thing than "install one tool".
 */
export type DependencyActionEffect = "install" | "open-docs" | "bootstrap";

/**
 * One dispatch inside a `command` action: the tool it installs, and the exact
 * shell command LINE tan reported for it.
 *
 * `tool` is carried alongside `command` (not just the bare string) because a
 * multi-tool row (the `hostPrerequisites` rollup, #603) has to say WHICH tool
 * each line is for — in the tooltip, on the consent screen, and in a Fix-all
 * failure's "installed cmake; `brew install ninja` exited 1" report. tan's own
 * `MissingPrerequisite`, narrowed to the one case that reaches here:
 * `command` is never `null` in this array — a `null` entry contributes no
 * step at all (see `actionFor`).
 */
export interface DependencyCommandStep {
  tool: string;
  command: string;
}

/**
 * A `command`-kind `DependencyAction` — a NAMED interface rather than an
 * inline union member (#603, third review, major 4) specifically so
 * `test/webview.payloadMirror.test.js`'s field-diff walk can reach it:
 * that gate's `MODELS` list and its "every `export interface` is gated"
 * backstop both key off `export interface`, and `DependencyAction` is an
 * `export type` union, which is invisible to both. Adding `omittedTools`
 * to the inline literal reached no gate at all — deleting the mirror's copy
 * of the field left the mirror test, the typecheck, and the full suite all
 * green. See `DependencyFixAction` for the sibling variant, extracted for
 * the same reason before it grows an ungated field of its own.
 */
export interface DependencyCommandAction {
  kind: "command";
  /**
   * One dispatch per entry, run in THIS order, never joined into one
   * shell line (#600: `&&` breaks Windows PowerShell 5.1, `;` runs a
   * later step after an earlier one failed and hides its exit code).
   * Non-empty — a row with nothing left to install after `command: null`
   * entries are dropped gets no `command` action at all, see `actionFor`.
   * A single-command row is a list of one; there is no separate
   * single-command shape.
   */
  commands: readonly DependencyCommandStep[];
  /**
   * Tool names tan named for this row's install with a `command: null`
   * — a real answer ("no confirmed install command"), never a gap this
   * button fills. Always `[]` for a per-tool bound action (a single
   * `MissingPrerequisite` entry cannot be partial by itself); non-empty
   * only on the `hostPrerequisites` rollup when some of its leftover
   * entries are null and others are not (#603 design item 5, second
   * review minor 7).
   *
   * STRUCTURED, not re-derived from `title`'s prose: this is what lets
   * the consent screen (`consent.ts` / `consentPick`) state the omission
   * as its OWN short clause instead of appending the whole tooltip
   * sentence, which for a non-partial row (this array empty) duplicated
   * `Runs:` under a second separator, and for a `fix`/`guide` row read as
   * two competing claims about what the button does.
   */
  omittedTools: readonly string[];
  effect: "install";
  title: string;
}

/** A `fix`-kind `DependencyAction` — see `DependencyCommandAction`'s own doc
 *  for why this is a named interface rather than an inline union member. */
export interface DependencyFixAction {
  kind: "fix";
  fixId: ToolchainFixId;
  effect: DependencyActionEffect;
  title: string;
}

/**
 * What a row's button does. `null` (no action) is a first-class outcome.
 *
 * `effect` is the verb the label must use and `title` the tooltip: every kind
 * carries both, so a customer can read what a button will do before pressing it.
 */
export type DependencyAction = DependencyCommandAction | DependencyFixAction;

export interface DependencyRow {
  /** tan's `check.name`, verbatim — the row's identity. */
  name: string;
  label: string;
  /** VERBATIM `check.status`. Never recomputed, never inferred from a probe. */
  status: DependencyStatus;
  /**
   * The state WORD the panel leads with — Ready / Will install / Needs you —
   * derived from the (`status`, `action.effect`) PAIR and nothing else (#466
   * §1, `./state`). An extra field, never a replacement: `status` above stays
   * tan's word, so a status this mapping does not recognise is still on screen
   * verbatim while `state` says `unknown` rather than guessing.
   */
  state: DependencyState;
  detail: string;
  /**
   * tan's own `check.fix` PROSE, verbatim, or `null` when tan gave none.
   *
   * DISPLAY ONLY — it is rendered under the detail and never parsed, matched,
   * or turned into a button (#347). It is the only guidance a check tan adds
   * tomorrow arrives with, so dropping it would silently lose the remedy on
   * every row this extension has no fix for (`vendorToolchain`, `yoctoHost`).
   */
  hint: string | null;
  /** `null` whenever tan does not report a version — never fabricated. */
  installed: string | null;
  latest: DependencyLatest | null;
  updateAvailable: boolean;
  action: DependencyAction | null;
}

export interface DependencyReport {
  rows: DependencyRow[];
  /**
   * tan's own `data.summary`, verbatim, and NOTHING derived from it.
   *
   * There is deliberately no `ok` / `ready` boolean. tan-cli#103 has since
   * landed (in v0.4.0, the pin), so `counts.fail` is now truthful — an absent
   * `ninja` rates `fail`, not `warn`. As that comment predicted, it needed no
   * change here: this type forwards tan's verdict and derives nothing, which is
   * exactly why the producer fix arrived for free. An older binary reached
   * through `alpSdk.cliPath` still caps at `warn`, and inventing an `ok` here
   * would misreport it.
   */
  counts: { pass: number; warn: number; fail: number };
  /**
   * True when the envelope carried NO `missingPrerequisites` key at all, so
   * actions fell back to the local fix map and the UI says so rather than
   * implying tan looked and found nothing. The pinned tan v0.4.0 emits the key,
   * so this is now the OLD-BINARY path (`alpSdk.cliPath` at v0.3.1 or earlier),
   * not the default one.
   */
  prerequisiteDataUnavailable: boolean;
  /**
   * Prerequisites tan reported with a NON-null command that bound to no row at
   * all — neither a per-tool check (a `cmake` / `ninja` check, if tan ever adds
   * one back) nor the `hostPrerequisites` rollup this extension currently binds
   * every leftover entry to (#603).
   *
   * Empty in the ordinary case, and the whole point of the field: tan has
   * already renamed this rollup once (`zephyrSdkHost` -> `zephyrSdkAvailableForHost`,
   * a sibling check — see `LABELS`), and #603 itself was exactly this failure
   * one field over — `missingPrerequisites` stayed tool-keyed while the check
   * it used to match was rolled into `hostPrerequisites`, and the mismatch
   * produced a silent `action: null` nobody noticed until this was measured
   * against the pin. A prerequisite tan hands us a real command for is either
   * OFFERED or SURFACED here — never silently dropped a second time.
   *
   * `command: null` entries never appear here: tan's own answer for those is
   * "no confirmed install command", which is not a row failing to carry
   * something — there is nothing to carry.
   */
  orphanedPrerequisites: readonly MissingPrerequisite[];
}

export interface DependencyPlanInput {
  data: DoctorEnvelopeData;
  /** A bootstrap is already changing this machine — every action is suppressed. */
  bootstrapRunning: boolean;
  /** The `tan` binary itself, which tan cannot check because it IS tan. */
  cli: {
    installed: string | null;
    /** The extension passes `kind: "pin"` — SUPPORTED_CLI_VERSION is a pin. */
    latest: DependencyLatest;
  };
  compareVersions: VersionComparator;
  /**
   * The platform whose fix dispatch these buttons describe. `fixCommand` answers
   * per host — `west` is a pip command on Windows and a whole bootstrap run
   * everywhere else — so the verb on the button is only true once the host is
   * known.
   *
   * Defaults to this process's platform, the same escape hatch
   * `sdk/service.ts` uses for its `platform` argument: injectable for tests,
   * and no caller has to remember to pass it to get a truthful label.
   */
  host?: BootstrapHost;
}

// ── Presentation tables. NEITHER may gate whether a row exists. ──────────────

/** Human labels for tan's terse check ids. A miss humanises the id instead. */
const LABELS: Readonly<Record<string, string>> = {
  sdk: "alp-sdk",
  boardYaml: "board.yaml",
  workspace: "Zephyr workspace",
  westResolved: "west (workspace)",
  west: "west",
  cmake: "CMake",
  ninja: "Ninja",
  zephyrSdk: "Zephyr SDK",
  // Plain `tan doctor`'s host-environment half (src/deps/vscodeAdapter.ts's
  // PLAIN_DOCTOR_HOST_CHECKS). `humanise` would render these "Zephyr sdk host"
  // and "Lldb"; the acronyms are the whole point of the row.
  // Both spellings on purpose (#472). tan renamed this check
  // `zephyrSdkHost` -> `zephyrSdkAvailableForHost` between v0.4.0 and 0.5.1, and
  // on the current pin the row arrives through the `--build` envelope whether or
  // not the allowlist names it — so with only the old key here, a row that IS on
  // screen today renders as `humanise`'s "Zephyr sdk available for host". A
  // stale LABELS key is free; a missing one is visible to the customer.
  zephyrSdkHost: "Zephyr SDK (host support)",
  zephyrSdkAvailableForHost: "Zephyr SDK (host support)",
  hostPrerequisites: "Bootstrap prerequisites",
  longPaths: "Windows long paths",
  homePath: "Home directory",
  lldb: "LLDB",
  yoctoHost: "Yocto host",
  bitbake: "BitBake",
  dd: "dd",
  vendorToolchain: "Vendor toolchain",
  sdkProvenance: "SDK provenance",
};

/**
 * Actions for a check tan's `missingPrerequisites` does not speak for. Only
 * names whose fix this extension actually knows appear; a miss means no button,
 * never a missing row.
 *
 * Reached in TWO situations:
 *
 *  - the whole key is absent (v0.3.1 and earlier, still reachable through
 *    `alpSdk.cliPath`);
 *  - the key is present but names no entry for this check AT ALL. On the
 *    v0.4.0 Rust CLI that list was built inside tan's `push_tool`, and
 *    `zephyrSdk` was pushed as a plain struct literal that never went through
 *    it (`crates/tan-core/src/build_readiness.rs:384` vs `:553`,
 *    `missing.push` at `:573`) — that citation is the now-RETIRED Rust build
 *    and this repo has not re-measured whether the Python port at the pinned
 *    0.6.0 routes `zephyrSdk` through its own equivalent. So on a real
 *    Windows install the Zephyr SDK row COULD arrive `status: "warn"` with
 *    tan's prose and no button — the customer left to discover
 *    `west sdk install` on their own. This entry is harmless if tan's gap
 *    already closed (an entry tan DOES emit always wins, below) and stays the
 *    fallback if it has not: "tan named no prerequisite for this check" is
 *    not the same statement as "there is nothing to offer".
 *
 * An entry tan DID emit is never overridden here — `command: null` is tan's
 * answer, not an invitation to look somewhere else.
 */
const FIX_IDS: Readonly<Record<string, ToolchainFixId>> = {
  west: "west",
  // NOT `west`: that id installs west with `pip --user` on win32, and this
  // check asks whether west resolves inside the WORKSPACE VENV — a global
  // install cannot flip it, which is the same PATH-vs-venv confusion
  // `src/deps/vscodeAdapter.ts` already refuses to render in the version cell.
  // tan's own prose for this check is "tan bootstrap", on every host.
  westResolved: "west-workspace",
  cmake: "build-tools",
  ninja: "build-tools",
  zephyrSdk: "zephyr-sdk",
};

/** The host-owned row id for the `tan` CLI itself. */
export const TAN_ROW_NAME = "tan";

/**
 * The row every LEFTOVER prerequisite binds to (#603) — a prerequisite whose
 * `tool` matches no check's `name` at all, so no per-tool row can claim it.
 *
 * A CONSTANT, not a derivation: nothing else in the envelope ties a
 * prerequisite entry to this particular check. `scope: "host"` plus
 * `status: "fail"` is ambiguous (`hostPython`, `pythonFloor` and `west` all
 * qualify on a real failing envelope) and `detail`/`fix` are prose this repo
 * already refused to parse once (#347). tan's own naming is the only signal:
 * at the pinned 0.6.0 `hostPrerequisites` is the ONE check that rolls up
 * every PATH-missing prerequisite tan does not give its own check
 * (`detail: "missing from PATH: cmake, ninja …"`), so every leftover entry —
 * not just cmake/ninja, whatever tan puts in `missingPrerequisites` for a tool
 * with no dedicated check — is this row's to carry.
 *
 * If tan renames this check, leftover entries bind to NOTHING and
 * `orphanedPrerequisites` says so rather than the action silently going back
 * to `null` — see `planDependencyReport`.
 */
const PREREQUISITE_ROLLUP_ROW = "hostPrerequisites";

/** This process's platform, narrowed to what `fixCommand` answers for. */
const DEFAULT_HOST: BootstrapHost = bootstrapHost();

/**
 * The verb and the tooltip for a fix, taken from `fixCommand` ITSELF — the same
 * call the host will make when the button is pressed — so the label cannot
 * promise something the dispatch does not do.
 */
function fixPresentation(
  fixId: ToolchainFixId,
  host: BootstrapHost,
): { effect: DependencyActionEffect; title: string } {
  const result = fixCommand(fixId, host);
  switch (result.kind) {
    case "command":
      // The exact command, shown rather than hidden.
      return { effect: "install", title: result.step.command };
    case "pointer": {
      // A pointer installs nothing, so the tooltip is the only place the row
      // can SAY what the customer has to do after the page opens. `note` is
      // absent for a pointer that has nothing further to add.
      const base = `Opens ${result.pointer.name} (${result.pointer.url}) in your browser — nothing is installed`;
      return {
        effect: "open-docs",
        title: result.pointer.note ? `${base}. ${result.pointer.note}` : base,
      };
    }
    case "bootstrap":
      return {
        effect: "bootstrap",
        title:
          "Runs the Alp SDK bootstrap in a terminal — installs west and the Zephyr Python dependencies into the workspace venv",
      };
    case "guide":
      return {
        effect: "install",
        title: `Shows an install command for each OS (${result.guide.title})`,
      };
  }
}

function humanise(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function updateAvailable(
  installed: string | null,
  latest: DependencyLatest | null,
  compareVersions: VersionComparator,
): boolean {
  // A pin is not an upgrade path. Asking a customer on a newer tan to "update"
  // to the older pinned one is worse than saying nothing.
  if (!latest || latest.kind !== "release") return false;
  return compareVersions(installed, latest.version) === "behind";
}

/**
 * The `hostPrerequisites` rollup's own tooltip/consent-screen text (#603 design
 * item 5). One sentence, reused verbatim on BOTH surfaces: it becomes
 * `action.title`, which `DependenciesView.tsx`'s `ActionCell` renders as the
 * button's native tooltip AND `src/deps/vscodeAdapter.ts`'s `consentPick`
 * appends to the QuickPick `detail` line — so the two never describe the same
 * button two different ways.
 *
 * `omittedTools` is never empty on a partial row — tan named a tool's command
 * as `null`, which is a real answer ("no confirmed install command for this
 * host") and not a gap this button can fill. The row's `state` still reads
 * "Will install" (derived from `effect: "install"`, same as any other command
 * row — see `./state`), which is why this SAYS the row can stay failing after
 * a clean press: a customer who presses this and refreshes to see the row
 * still red with no explanation would read the button as broken rather than
 * partial.
 */
function rollupActionTitle(
  bound: readonly DependencyCommandStep[],
  omittedTools: readonly string[],
): string {
  const verb =
    bound.length === 1
      ? `Installs ${bound[0].tool}: ${bound[0].command}`
      : `Installs ${bound.map((s) => s.tool).join(", ")}: ${bound
          .map((s) => s.command)
          .join("; ")}`;
  if (omittedTools.length === 0) return verb;
  return (
    `${verb}. tan reported no install command for ` +
    `${omittedTools.join(", ")} — this row can still read failing for ` +
    `${omittedTools.length === 1 ? "it" : "those"} after a clean install ` +
    "of everything above."
  );
}

/**
 * The `hostPrerequisites` row's own DETAIL-column fallback for the case
 * `rollupActionTitle` never runs for at all (#603, round 5, major 5): when
 * `command: null` for EVERY leftover entry, `leftoverBound` is empty, no
 * `command` action exists (an empty `commands[]` is never valid — see
 * `planDependencyReport`), and `rollupActionTitle` — the only place that
 * would otherwise say "tan reported no install command for X" — is never
 * called, because there is no action for it to be that action's title.
 * `leftoverOmitted` was computed either way and simply discarded: partial
 * omission (SOME tools bound) reached the customer via the button's own
 * tooltip; total omission (NO tools bound) reached nobody. "When ONE tool is
 * unbindable the panel says so; when ALL of them are, it says nothing" is
 * the exact asymmetry this closes — the row's own `detail` is the only
 * channel left once there is no action to carry `omittedTools`.
 *
 * `tanDetail` unchanged when there is nothing to add (the ordinary case:
 * `omitted` empty means either every leftover entry bound to a real command,
 * or there were no leftover entries at all).
 */
function rollupOmissionDetail(
  tanDetail: string,
  omitted: readonly string[],
): string {
  if (omitted.length === 0) return tanDetail;
  return `${tanDetail} — tan reported no install command for ${omitted.join(", ")}.`;
}

/**
 * Plan the dependency table from one `tan doctor --build` envelope.
 *
 * Row set = one per `data.checks[]` entry (keyed on `check.name`, in tan's
 * order) plus exactly one host-owned `tan` row. Every other cell is either
 * tan's own value or `null`.
 */
export function planDependencyReport(
  input: DependencyPlanInput,
): DependencyReport {
  const { data, bootstrapRunning, cli, compareVersions } = input;
  const host = input.host ?? DEFAULT_HOST;
  const prerequisites = data.missingPrerequisites;
  const prerequisiteDataUnavailable = prerequisites === undefined;

  // Pass 1 / pass 2 partition (#603). A prerequisite whose `tool` matches some
  // check's `name` binds to THAT check, exactly as before (`entry` in
  // `actionFor` below) — this also prevents double-offering the day tan gives
  // `cmake`/`ninja` their own checks again: that entry is drained here before
  // the rollup below ever sees it. Everything left over — a tool with no
  // dedicated check at all — is what the ROLLUP row (`PREREQUISITE_ROLLUP_ROW`)
  // carries, never a per-check `find`.
  const checkNames = new Set(data.checks.map((check) => check.name));
  const leftover = (prerequisites ?? []).filter((p) => !checkNames.has(p.tool));
  const leftoverBound: DependencyCommandStep[] = leftover
    .filter((p): p is { tool: string; command: string } => p.command !== null)
    .map((p) => ({ tool: p.tool, command: p.command }));
  const leftoverOmitted = leftover
    .filter((p) => p.command === null)
    .map((p) => p.tool);
  // Bound to the rollup row ONLY if that row exists in this envelope AND there
  // is at least one command to offer — an empty `commands[]` is not a valid
  // `command` action (see `DependencyAction`'s own doc), and a rollup row every
  // one of whose leftover entries is `command: null` legitimately offers
  // nothing, same as any other tool tan named no command for.
  const rollupExists = checkNames.has(PREREQUISITE_ROLLUP_ROW);
  const rollupAction: DependencyAction | null =
    rollupExists && leftoverBound.length > 0
      ? {
          kind: "command",
          commands: leftoverBound,
          omittedTools: leftoverOmitted,
          effect: "install",
          title: rollupActionTitle(leftoverBound, leftoverOmitted),
        }
      : null;
  // The orphan invariant (#603 design item 2): a non-null command that bound
  // to NEITHER pass is a defect this report must SURFACE, not a silent
  // `action: null` indistinguishable from "nothing was missing". This is what
  // turns tan's NEXT rename of `hostPrerequisites` into a visible signal
  // instead of a repeat of this exact bug.
  const orphanedPrerequisites: MissingPrerequisite[] = rollupExists
    ? []
    : leftoverBound.map((step) => ({ tool: step.tool, command: step.command }));

  /** The action for one check row. tan's per-tool answer first, then the
   *  rollup (if this IS the rollup row), then this extension's own fix map —
   *  see `FIX_IDS` for when that last one fires. */
  const actionFor = (check: DoctorCheckEnvelope): DependencyAction | null => {
    // A bootstrap is mid-flight and already mutating the toolchain; a second
    // installer racing it is how half-written workspaces happen.
    if (bootstrapRunning) return null;
    const entry = (prerequisites ?? []).find((p) => p.tool === check.name);
    if (entry) {
      // tan spoke for this tool and its answer is FINAL. `command: null` means
      // tan knows no command — show the row, offer nothing.
      return entry.command !== null
        ? {
            kind: "command",
            commands: [{ tool: entry.tool, command: entry.command }],
            // A per-tool match is never partial — one `MissingPrerequisite`
            // entry cannot omit part of itself.
            omittedTools: [],
            // tan's own command line, run verbatim in a terminal — an install,
            // and the tooltip is the command it will run.
            effect: "install",
            title: entry.command,
          }
        : null;
    }
    if (check.name === PREREQUISITE_ROLLUP_ROW && rollupAction) {
      return rollupAction;
    }
    // tan named no prerequisite for this check. Fall back to what this
    // extension knows how to remedy — never to parsing `check.fix`, prose.
    const fixId = FIX_IDS[check.name];
    return fixId && check.status !== "pass"
      ? { kind: "fix", fixId, ...fixPresentation(fixId, host) }
      : null;
  };

  const rows: DependencyRow[] = data.checks.map((check) => {
    // Resolved once and passed to BOTH the row and the state word: computing
    // the action twice would let the two disagree, and a row labelled "Will
    // install" with no button is worse than either answer alone.
    const action = actionFor(check);
    return {
      name: check.name,
      label: LABELS[check.name] ?? humanise(check.name),
      status: check.status,
      state: dependencyState(check.status, action?.effect ?? null),
      // `rollupOmissionDetail` is a no-op for every row but the rollup one
      // with nothing bindable at all — see its own doc for why THAT case has
      // no other channel left to say tan named these tools.
      detail:
        check.name === PREREQUISITE_ROLLUP_ROW && leftoverBound.length === 0
          ? rollupOmissionDetail(check.detail, leftoverOmitted)
          : check.detail,
      // tan's prose, carried whole. Displayed, never read.
      hint: check.fix ?? null,
      // tan reports no per-check version, and inventing one from `detail` would
      // be a fabrication. Null renders as a dash until tan emits it.
      installed: null,
      latest: null,
      updateAvailable: false,
      action,
    };
  });

  // tan cannot check `tan`, so the host answers for it. Its status is a plain
  // statement of whether the binary resolved — not a readiness verdict — and it
  // does NOT feed `counts`, which stay tan's summary verbatim.
  rows.push({
    name: TAN_ROW_NAME,
    label: "tan CLI",
    status: cli.installed === null ? "fail" : "pass",
    // Same mapping as every other row, deliberately not special-cased. The row
    // carries no action (the resolver owns this binary, not a button), so an
    // unresolved tan lands on "Needs you" — which is correct: the resolver has
    // already run by the time this panel paints, so a tan still missing means
    // something outside it (offline, a proxy, a refused download) needs the
    // user. Labelling it "Will install" would promise a fetch nobody is about
    // to make.
    state: dependencyState(cli.installed === null ? "fail" : "pass", null),
    detail:
      cli.installed === null
        ? "not resolved"
        : cli.latest.kind === "pin"
          ? `pinned to ${cli.latest.version}`
          : "resolved",
    // No tan check, so no tan prose.
    hint: null,
    installed: cli.installed,
    latest: cli.latest,
    updateAvailable: updateAvailable(
      cli.installed,
      cli.latest,
      compareVersions,
    ),
    // The CLI's own install/update path is the resolver's (src/alpCli/), not a
    // row button — two places fetching the same binary would race.
    action: null,
  });

  // A prerequisite tan lists for a tool with NO dedicated check (tan reports
  // no `git` / `python` / `dtc` / `gperf` check) no longer falls out of the
  // table silently (#603 — that WAS this bug, one field over, for
  // `cmake`/`ninja` specifically): it binds to `hostPrerequisites` above with
  // every other leftover entry. Only when that rollup row is itself absent
  // does a non-null command go unbound, and `orphanedPrerequisites` says so.
  return {
    rows,
    counts: data.summary,
    prerequisiteDataUnavailable,
    orphanedPrerequisites,
  };
}
