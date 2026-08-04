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
  fixCommand,
  type ToolchainFixId,
} from "../toolchain/bootstrapPlan";
import type {
  DoctorCheckEnvelope,
  DoctorEnvelopeData,
  MissingPrerequisite,
} from "../cli/doctorEnvelope";

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
 * What a row's button does. `null` (no action) is a first-class outcome.
 *
 * `effect` is the verb the label must use and `title` the tooltip: every kind
 * carries both, so a customer can read what a button will do before pressing it.
 */
export type DependencyAction =
  | {
      kind: "command";
      command: string;
      effect: "install";
      title: string;
    }
  | {
      kind: "fix";
      fixId: ToolchainFixId;
      effect: DependencyActionEffect;
      title: string;
    };

export interface DependencyRow {
  /** tan's `check.name`, verbatim — the row's identity. */
  name: string;
  label: string;
  /** VERBATIM `check.status`. Never recomputed, never inferred from a probe. */
  status: DependencyStatus;
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
  zephyrSdkHost: "Zephyr SDK (host support)",
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
 * Reached in TWO situations, and the pinned tan v0.4.0 is in both:
 *
 *  - the whole key is absent (v0.3.1 and earlier, still reachable through
 *    `alpSdk.cliPath`);
 *  - the key is present but names no entry for this check AT ALL. That list is
 *    built inside tan's `push_tool`, and `zephyrSdk` is pushed as a plain
 *    struct literal that never goes through it (v0.4.0
 *    `crates/tan-core/src/build_readiness.rs:384` vs `:553`, `missing.push` at
 *    `:573`). So on a real Windows install the Zephyr SDK row arrived
 *    `status: "warn"` with tan's prose and NO button — the customer was left to
 *    discover `west sdk install` on their own. tan-cli must route it through
 *    `push_tool`; until it does, "tan named no prerequisite for this check" is
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

/** This process's platform, narrowed to what `fixCommand` answers for. */
const DEFAULT_HOST: BootstrapHost =
  process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";

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

  /** The action for one check row. tan's answer first, ours only where tan gave
   *  none — see `FIX_IDS` for the two ways that happens. */
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
            command: entry.command,
            // tan's own command line, run verbatim in a terminal — an install,
            // and the tooltip is the command it will run.
            effect: "install",
            title: entry.command,
          }
        : null;
    }
    // tan named no prerequisite for this check. Fall back to what this
    // extension knows how to remedy — never to parsing `check.fix`, prose.
    const fixId = FIX_IDS[check.name];
    return fixId && check.status !== "pass"
      ? { kind: "fix", fixId, ...fixPresentation(fixId, host) }
      : null;
  };

  const rows: DependencyRow[] = data.checks.map((check) => ({
    name: check.name,
    label: LABELS[check.name] ?? humanise(check.name),
    status: check.status,
    detail: check.detail,
    // tan's prose, carried whole. Displayed, never read.
    hint: check.fix ?? null,
    // tan reports no per-check version, and inventing one from `detail` would
    // be a fabrication. Null renders as a dash until tan emits it.
    installed: null,
    latest: null,
    updateAvailable: false,
    action: actionFor(check),
  }));

  // tan cannot check `tan`, so the host answers for it. Its status is a plain
  // statement of whether the binary resolved — not a readiness verdict — and it
  // does NOT feed `counts`, which stay tan's summary verbatim.
  rows.push({
    name: TAN_ROW_NAME,
    label: "tan CLI",
    status: cli.installed === null ? "fail" : "pass",
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

  // A prerequisite tan lists for a tool that has NO check (tan reports no
  // `git` / `python` / `dtc` / `gperf` check) is intentionally dropped rather
  // than synthesised into a row: the fix is a check upstream in tan-cli, which
  // then lands here for free.
  return {
    rows,
    counts: data.summary,
    prerequisiteDataUnavailable,
  };
}
