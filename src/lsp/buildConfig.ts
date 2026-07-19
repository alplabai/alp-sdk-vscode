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

import type { KconfigDiagnostic } from "./kconfig";

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

/** Nearest board.yaml at or above `dir`, else null. */
function findBoardYaml(dir: string): string | null {
  let current = dir;
  for (;;) {
    const candidate = path.join(current, "board.yaml");
    if (mtimeMs(candidate) !== null) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
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
          "symbol that exists but is off — absence means the symbol was " +
          "never declared for this board/toolchain.",
      });
      return;
    }

    const built = resolved.get(name) as string;
    if (!sameValue(built, value)) {
      out.push({
        ...span,
        message:
          `\`${prefixed}\` is set to \`${value}\` here, but the last build ` +
          `resolved it to \`${built}\` — the assignment did not take effect.`,
      });
    }
  });

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

  return diagnoseAgainstBuild(prjText, parseDotConfig(configText));
}
