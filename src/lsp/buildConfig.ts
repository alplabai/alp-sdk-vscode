// SPDX-License-Identifier: Apache-2.0
//
// Phase 2 of prj.conf support: compare what you wrote against what the build
// actually resolved. PURE — no LSP types; the server maps the results onto
// Diagnostic, exactly as it does for kconfig.ts.
//
// Why the build output rather than the SDK's generated alp.conf: `.config` is
// the RESULT of the whole merge (board defconfig + generated fragments +
// prj.conf), so it settles "who won" without this module having to model the
// merge order at all. That matters, because the orchestrator materialises
// build/<core>-<os>/alp.conf but its emitted `west build` command never points
// at it — no OVERLAY_CONFIG/EXTRA_CONF_FILE/CONF_FILE anywhere in
// scripts/alp_orchestrate/ — while the apps wire in a *separate* alp.conf that
// alp_project.py generates at CMake time. Reading .config sidesteps that
// unresolved question entirely.
//
// EVERYTHING HERE IS GATED ON FRESHNESS. Comparing against a stale build
// produces confident wrong answers, which is worse than staying quiet, so a
// .config older than any of its inputs suppresses all diagnostics rather than
// downgrading them.

import * as fs from "fs";
import * as path from "path";

import yaml from "js-yaml";

import type { KconfigCompletion, KconfigDiagnostic } from "./kconfig";

/** A prj.conf resolved to the build slice it belongs to. */
export interface SliceContext {
  coreId: string;
  os: string;
  /** `<board.yaml dir>/build/<core>-<os>/` — the orchestrator's slice dir. */
  sliceDir: string;
  /** `<sliceDir>/build/zephyr/.config` — west nests its own build/ in there. */
  configPath: string;
  boardYamlPath: string;
}

/**
 * Parse a Zephyr `.config` (or any Kconfig fragment) into name -> value, with
 * the name stripped of its `CONFIG_` prefix.
 *
 * `# CONFIG_X is not set` is an ASSIGNMENT of n, not a comment: 579 of the 833
 * symbols in a real m55_hp .config take that form, so treating it as a comment
 * would blind every comparison to the majority case.
 */
export function parseDotConfig(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const assigned = /^CONFIG_([A-Z0-9_]+)=(.*)$/.exec(raw);
    if (assigned) {
      out.set(assigned[1], assigned[2].trim());
      continue;
    }
    const unset = /^# CONFIG_([A-Z0-9_]+) is not set$/.exec(raw);
    if (unset) out.set(unset[1], "n");
  }
  return out;
}

/** Values that mean the same thing on both sides of a comparison. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  // A quoted string in .config vs the same text unquoted in prj.conf.
  const unquote = (s: string) => s.replace(/^"(.*)"$/, "$1");
  return unquote(a) === unquote(b);
}

function readIfFile(p: string): string | null {
  try {
    return fs.statSync(p).isFile() ? fs.readFileSync(p, "utf-8") : null;
  } catch {
    return null;
  }
}

function mtimeMs(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Nearest board.yaml at or above `dir`, else null.
 *
 * Bounded: without a limit this ascends to the filesystem root, so a file
 * opened from outside any project could bind to an unrelated ancestor
 * board.yaml and then read that tree's `.config` into the hover UI. A project
 * root is a handful of levels up at most; 24 is far past any real layout while
 * still terminating well below `/`.
 */
const MAX_BOARD_YAML_ASCENT = 24;

function findBoardYaml(dir: string): string | null {
  let current = dir;
  for (let depth = 0; depth < MAX_BOARD_YAML_ASCENT; depth++) {
    const candidate = path.join(current, "board.yaml");
    if (mtimeMs(candidate) !== null) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Resolve which build slice a prj.conf belongs to, or null when that cannot be
 * decided. Null is a normal outcome — a prj.conf outside any `cores[].app`
 * directory has no slice, and guessing one would attribute another core's
 * build results to this file.
 */
export function resolveSlice(prjConfPath: string): SliceContext | null {
  const prjDir = path.dirname(path.resolve(prjConfPath));
  const boardYamlPath = findBoardYaml(prjDir);
  if (!boardYamlPath) return null;

  const text = readIfFile(boardYamlPath);
  if (text === null) return null;

  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return null; // a board.yaml mid-edit is not an error worth reporting here
  }
  const cores = (doc as { cores?: Record<string, unknown> } | null)?.cores;
  if (!cores || typeof cores !== "object") return null;

  const boardDir = path.dirname(boardYamlPath);
  for (const [coreId, value] of Object.entries(cores)) {
    const core = value as { os?: string; app?: string } | null;
    // Only Zephyr slices produce a .config; yocto/baremetal have no Kconfig.
    if (!core || core.os !== "zephyr") continue;
    // A core may omit `app` (E1M-AEN801's m55_he does). Without it there is
    // nothing to match this file against, so skip rather than guess.
    if (typeof core.app !== "string") continue;

    if (path.resolve(boardDir, core.app) !== prjDir) continue;

    const sliceDir = path.join(boardDir, "build", `${coreId}-${core.os}`);
    return {
      coreId,
      os: core.os,
      sliceDir,
      configPath: path.join(sliceDir, "build", "zephyr", ".config"),
      boardYamlPath,
    };
  }
  return null;
}

/**
 * Whether the build output is newer than every input that feeds it. A stale
 * .config describes a build the current sources would not reproduce, so its
 * verdicts must not be shown.
 */
export function isBuildFresh(
  slice: SliceContext,
  prjConfPath: string,
): boolean {
  const built = mtimeMs(slice.configPath);
  if (built === null) return false;

  const inputs = [
    prjConfPath,
    slice.boardYamlPath,
    // The SDK's generated per-slice fragment; regenerated on every plan run.
    path.join(slice.sliceDir, "alp.conf"),
  ];
  for (const input of inputs) {
    const t = mtimeMs(input);
    if (t !== null && t > built) return false;
  }
  return true;
}

/**
 * Read a build sibling of `.config` (the trace, the missing-deps file) only
 * when it is at least as new as `.config` itself. kconfig.py writes both
 * siblings AFTER `.config` in the same run, so a completed build always leaves
 * them `>=` `.config`; an older one is from an interrupted run or an earlier
 * solve and its contents may no longer match the resolved `.config` — reading
 * it would risk a stale attribution, the one thing this module must never do.
 * Returns null when the sibling is missing, `.config` is gone, or the sibling
 * is older (fail-closed). `>=`, not `>`: a completed run writes both files in
 * the same coarse-granularity granule, and `>` would falsely drop that.
 */
function readFreshSibling(
  siblingPath: string,
  configPath: string,
): string | null {
  const sib = mtimeMs(siblingPath);
  const cfg = mtimeMs(configPath);
  if (sib === null || cfg === null || sib < cfg) return null;
  return readIfFile(siblingPath);
}

/**
 * Diagnose a prj.conf against a resolved `.config`.
 *
 * Two distinct failures, both invisible today:
 *   1. the symbol resolved to a different value — the assignment lost;
 *   2. the symbol is absent from .config entirely — it does not exist in this
 *      build's Kconfig tree, so the line can never do anything. Zephyr writes
 *      `# CONFIG_X is not set` for a known-but-disabled symbol, so absence
 *      means "not defined", not "off". This is the case that fires on real
 *      data: alp-sample's src/prj.conf sets CONFIG_NEWLIB_LIBC=y and the
 *      symbol never appears in the m55_hp build.
 */
export function diagnoseAgainstBuild(
  prjText: string,
  resolved: Map<string, string>,
  trace?: Map<string, TracedSymbol>,
  missingDeps?: Map<string, string[]>,
): KconfigDiagnostic[] {
  const out: KconfigDiagnostic[] = [];

  prjText.split(/\r?\n/).forEach((line, i) => {
    const assigned = /^(\s*)(CONFIG_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!assigned) return;
    const [, indent, prefixed, rawValue] = assigned;
    const value = rawValue.trim();
    if (value === "") return; // lintPrjConf already reports the empty value

    const name = prefixed.slice("CONFIG_".length);
    const span = {
      line: i,
      startCol: indent.length,
      endCol: line.length,
      severity: "warning" as const,
    };

    if (!resolved.has(name)) {
      out.push({
        ...span,
        message:
          `\`${prefixed}\` is not defined in this build's Kconfig tree, so ` +
          "this line has no effect. Zephyr writes `# … is not set` for a " +
          "symbol that exists but is off — absence means it was never " +
          "declared for this slice's board target or toolchain.",
      });
      return;
    }

    const built = resolved.get(name) as string;
    if (!sameValue(built, value)) {
      // Three tiers, sharpest first — each names as much of the reason as the
      // build actually recorded, and never more (the never-lie rule):
      //   1. `.config-missing-deps.json` listed the exact unmet direct
      //      dependencies (`missing_deps()` from the same build) — name them.
      //   2. the trace says the symbol was not user-settable (visibility n)
      //      but no concrete deps were recorded — the "no prompt / unmet deps"
      //      disjunction, sharper than "resolved to X" but without guessing
      //      which dependency.
      //   3. nothing attributive — some other assignment simply beat this one.
      const deps = missingDeps?.get(name);
      const notSettable = trace?.get(name)?.visibility === "n";
      let message: string;
      if (deps && deps.length > 0) {
        // The dep strings are rendered by the build's kconfig.py, e.g.
        // `DEP (=n)` or `(FOO || BAR) (=n)` — shown verbatim.
        const word = deps.length === 1 ? "dependency" : "dependencies";
        const isAre = deps.length === 1 ? "is" : "are";
        message =
          `\`${prefixed}\` is ignored here — its ${word} ` +
          `${deps.join(", ")} ${isAre} unmet in this build target, so the ` +
          `symbol is not settable (the build resolved it to \`${built}\`).`;
      } else if (notSettable) {
        message =
          `\`${prefixed}\` is not user-settable in this build target — it ` +
          "has no prompt, or its prompt's dependencies are unmet — so this " +
          `line is ignored (the build resolved it to \`${built}\`).`;
      } else {
        message =
          `\`${prefixed}\` is set to \`${value}\` here, but the last build ` +
          `resolved it to \`${built}\` — the assignment did not take effect.`;
      }
      out.push({ ...span, message });
    }
  });

  return out;
}

/** One symbol as the build resolved it, from `.config-trace.json`. */
export interface TracedSymbol {
  /** Resolved value, e.g. `y`, `n`, `1024`, `"a string"`. */
  value: string;
  /** `bool` | `int` | `hex` | `string` | `tristate`, as the build saw it. */
  type: string;
  /** How it got that value: `assign`, `default`, `select`, … */
  kind: string;
  /**
   * The symbol's Kconfig visibility, `n` | `m` | `y` — the maximum a user could
   * set it to. `n` means the symbol is NOT user-settable in this target (no
   * prompt, or its prompt's dependencies are unmet), so a `prj.conf`
   * assignment to it is ignored. It does NOT say WHICH dependency is unmet —
   * that needs a live kconfiglib evaluation, which this does not have.
   */
  visibility?: string;
  /** Kconfig file that decided it, and the line within it. */
  file?: string;
  line?: number;
}

/**
 * Parse `.config-trace.json` — an array of positional tuples:
 *   [name, visibility, type, value, kind, [file, line]]
 *
 * TOLERANT BY CONTRACT. Zephyr's own kconfig.py warns that this format is
 * coupled to traceconfig.py and tests/kconfig/tracing, and positional tuples
 * shift silently when a field is inserted. So every entry is shape-checked and
 * a bad one is skipped rather than throwing: losing hover detail is a
 * degradation, but a parse error would take the whole diagnostic pass with it.
 */
export function parseConfigTrace(text: string): Map<string, TracedSymbol> {
  const out = new Map<string, TracedSymbol>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;

  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length < 5) continue;
    const [name, visibility, type, value, kind, location] = entry as unknown[];
    if (typeof name !== "string" || !name.startsWith("CONFIG_")) continue;
    if (typeof type !== "string" || typeof value !== "string") continue;
    if (typeof kind !== "string") continue;

    const traced: TracedSymbol = { value, type, kind };
    if (typeof visibility === "string") traced.visibility = visibility;
    if (Array.isArray(location) && typeof location[0] === "string") {
      traced.file = location[0];
      if (typeof location[1] === "number") traced.line = location[1];
    }
    out.set(name.slice("CONFIG_".length), traced);
  }
  return out;
}

/**
 * Parse `.config-missing-deps.json` — a map from prefixed symbol name to the
 * rendered unsatisfied direct dependencies that blocked its assignment:
 *   { "CONFIG_FOO": ["DEP (=n)", "(A || B) (=n)"] }
 *
 * Written by the same build's kconfig.py (`collect_missing_deps`) as a sibling
 * of `.config-trace.json`, so it shares the trace's freshness. Keyed here by
 * UNPREFIXED name to match the `.config` and trace maps. Tolerant by the same
 * contract as parseConfigTrace: a malformed or unexpected shape yields an empty
 * map rather than throwing, so a bad sibling never takes the diagnostic pass
 * down with it.
 */
export function parseMissingDeps(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return out;
  }

  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!key.startsWith("CONFIG_")) continue;
    if (!Array.isArray(value)) continue;
    const deps = value.filter((d): d is string => typeof d === "string");
    if (deps.length === 0) continue;
    out.set(key.slice("CONFIG_".length), deps);
  }
  return out;
}

/**
 * Markdown describing how the last build resolved `symbolName`, or null when
 * there is nothing trustworthy to say.
 *
 * Gated on the same freshness rule as the diagnostics: a stale trace reports
 * values the current sources would not produce, and a hover asserting them
 * reads as authoritative.
 */
export function buildInfoMarkdown(
  prjConfPath: string,
  symbolName: string,
): string | null {
  const slice = resolveSlice(prjConfPath);
  if (!slice || !isBuildFresh(slice, prjConfPath)) return null;

  const name = symbolName.startsWith("CONFIG_")
    ? symbolName.slice("CONFIG_".length)
    : symbolName;

  const tracePath = path.join(
    path.dirname(slice.configPath),
    ".config-trace.json",
  );
  const traceText = readIfFile(tracePath);
  const traced = traceText ? parseConfigTrace(traceText).get(name) : undefined;

  if (traced) {
    const lines = [
      `**In the last \`${slice.coreId}\` build:** \`${traced.value}\` ` +
        `_(${traced.type}, ${traced.kind})_`,
    ];
    // `select` is the one users misread most: the symbol is on because
    // something else selected it, not because they set it.
    if (traced.kind === "select") {
      lines.push("Enabled by another symbol's `select`, not by this file.");
    }
    if (traced.file) {
      const at =
        traced.line !== undefined
          ? `${traced.file}:${traced.line}`
          : traced.file;
      lines.push(`Decided at \`${at}\`.`);
    }
    return lines.join("\n\n");
  }

  // No trace (older Zephyr, or the file was not written) — .config alone still
  // gives the resolved value, just not its provenance.
  const configText = readIfFile(slice.configPath);
  if (configText === null) return null;
  const resolved = parseDotConfig(configText).get(name);
  if (resolved === undefined) return null;

  return `**In the last \`${slice.coreId}\` build:** \`${resolved}\``;
}

/**
 * Completions for every symbol the last build actually resolved.
 *
 * SCOPE IS THE POINT. Zephyr's Kconfig tree carries ~26k symbols even for a
 * single build, because arch/Kconfig osources all 11 architectures and
 * soc/Kconfig.soc all 126 SoC folders — offering that set would suggest
 * symbols that do nothing on this SoM, which is the lying-IDE failure this
 * whole surface is built to avoid. The build's own `.config` is the honest
 * set: every name in it is declared and reachable for THIS slice's board
 * target (derived from `som.sku` + core), and nothing else is.
 *
 * Returns [] when there is no slice or no fresh build — the caller keeps its
 * static catalogue in that case.
 */
export function buildCompletions(
  prjConfPath: string,
  linePrefix: string,
): KconfigCompletion[] {
  // Same guard completePrjConf applies: past the `=` the cursor is in the
  // VALUE position, where a symbol name is never valid. Without this, a fresh
  // slice pops all 833 of its names the moment you type `CONFIG_SERIAL=`.
  if (linePrefix.includes("=")) return [];

  const slice = resolveSlice(prjConfPath);
  if (!slice || !isBuildFresh(slice, prjConfPath)) return [];

  const configText = readIfFile(slice.configPath);
  if (configText === null) return [];
  const resolved = parseDotConfig(configText);

  const traceText = readIfFile(
    path.join(path.dirname(slice.configPath), ".config-trace.json"),
  );
  const trace = traceText ? parseConfigTrace(traceText) : new Map();

  const out: KconfigCompletion[] = [];
  for (const [name, value] of resolved) {
    const traced = trace.get(name);
    const type = traced?.type;
    out.push({
      label: `CONFIG_${name}`,
      detail: type ? `${type} — currently ${value}` : `currently ${value}`,
      doc:
        `Resolved by the last \`${slice.coreId}\` build to \`${value}\`` +
        (traced ? ` (${traced.kind}).` : "."),
      // The CURRENT value is not the insert default: completing `=n` because
      // the symbol happens to be off today would be an odd suggestion. Fall
      // back to the type hint, exactly as the static catalogue does.
      insertText: `CONFIG_${name}=${type === "bool" ? "y" : ""}`,
    });
  }
  return out;
}

/**
 * The whole phase-2 pass for one prj.conf: resolve the slice, check freshness,
 * compare. Returns [] whenever any precondition is missing — no slice, no
 * build yet, or a stale build — so the feature is silent rather than wrong.
 */
export function diagnosePrjConfAgainstBuild(
  prjConfPath: string,
  prjText: string,
): KconfigDiagnostic[] {
  const slice = resolveSlice(prjConfPath);
  if (!slice) return [];

  const configText = readIfFile(slice.configPath);
  if (configText === null) return []; // never built — nothing to say

  // The editor re-validates on every keystroke with the IN-MEMORY buffer,
  // while isBuildFresh() stats the file ON DISK. A dirty buffer therefore
  // reads as "fresh" and every unsaved line gets judged against a build that
  // never saw it — an unprovable verdict, which is the one thing this module
  // must not produce. Disk mtime cannot detect this; comparing the text can.
  const onDisk = readIfFile(prjConfPath);
  if (onDisk !== null && onDisk !== prjText) {
    return [
      {
        line: 0,
        startCol: 0,
        endCol: 0,
        severity: "information",
        message:
          "Unsaved changes — build-output checks describe the file as it was " +
          "last built. Save and rebuild to check the current text.",
      },
    ];
  }

  if (!isBuildFresh(slice, prjConfPath)) {
    // Say why the check is off instead of going quiet. A silent feature is
    // indistinguishable from a broken one, and this is not a rare state: on
    // the first real project this was pointed at, `alp.conf` had been
    // regenerated three hours after the last Zephyr build, so the comparison
    // was correctly suppressed and looked like nothing had happened.
    return [
      {
        line: 0,
        startCol: 0,
        endCol: 0,
        severity: "information",
        message:
          `Build-output checks are off for slice \`${slice.coreId}\`: its ` +
          "`.config` is older than this file, `board.yaml`, or the generated " +
          "`alp.conf`. Rebuild to compare against what the build resolves.",
      },
    ];
  }

  const configDir = path.dirname(slice.configPath);

  // The trace and its missing-deps sibling both attribute an ignored
  // assignment — the trace to "not user-settable" (visibility), the sibling to
  // the exact unmet dependency. Both are optional: without them the value
  // comparison still works off `.config` alone. Each is read only when it is at
  // least as new as `.config` (readFreshSibling), so an interrupted or
  // left-over write can never drive a stale attribution. (A non-handwritten
  // reload rewrites the sibling to `{}` in the same run, which the empty-map
  // parse drops anyway.)
  const traceText = readFreshSibling(
    path.join(configDir, ".config-trace.json"),
    slice.configPath,
  );
  const trace = traceText ? parseConfigTrace(traceText) : undefined;

  const missingDepsText = readFreshSibling(
    path.join(configDir, ".config-missing-deps.json"),
    slice.configPath,
  );
  const missingDeps = missingDepsText
    ? parseMissingDeps(missingDepsText)
    : undefined;

  return diagnoseAgainstBuild(
    prjText,
    parseDotConfig(configText),
    trace,
    missingDeps,
  );
}
