// SPDX-License-Identifier: Apache-2.0

import {
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
} from "./models";

/**
 * argv for `tan validate --format diagnostic-v1`.
 *
 * `--sdk-root` goes BEFORE the subcommand on purpose: that pre-subcommand
 * position is the one tan's own reorder shim supports, and it is the shape the
 * rest of this extension already uses (`alpCli/vscodeAdapter.ts:withSdkRoot`).
 *
 * `--offline` is deliberately never passed. It runs only the structural checks
 * that ship inside tan, and measured against the pinned 0.6.0 those accept
 * an unknown top-level key (`not_a_key: 3`) at exit 0 with an EMPTY diagnostics
 * list — the SDK-backed path reports the same file as `ALP-B002`. Falling back
 * to offline would weaken validation without saying so.
 */
export function createTanValidateArgs(
  sdkRoot: string | null,
  boardYamlPath: string,
): string[] {
  const sdkRootFlag = sdkRoot ? ["--sdk-root", sdkRoot] : [];
  return [
    ...sdkRootFlag,
    "validate",
    "--format",
    "diagnostic-v1",
    "--board-yaml",
    boardYamlPath,
  ];
}

/**
 * Parse a `diagnostic-v1` payload into the same `ValidationResult` the Python
 * validator's stderr is parsed into, so the diagnostic builder does not care
 * which validator ran.
 *
 * This format breaks three rules the rest of tan follows, all measured:
 *
 *  1. It does NOT emit the envelope — the top level is
 *     `{schemaVersion, tool, diagnostics}`, with no `command`/`ok`/`exitCode`/
 *     `data`/`issues`. Envelope-parsing code pointed here finds nothing.
 *  2. `schemaVersion` is the NUMBER 1, while the json envelope's
 *     `data.schemaVersion` is the STRING "1".
 *  3. Codes come in two spellings: tan's own structural checks report
 *     `validate-schema-violation`, the SDK-backed validator reports the
 *     diagnostic catalogue's `ALP-B002`. Both are kept verbatim — a classifier
 *     that rewrites one into the other would match neither.
 *
 * Ranges are 0-based (LSP convention) and `ValidationIssue.line`/`col` are
 * 1-based (they were defined for the `--> board.yaml:LINE:COL` arrow), so the
 * conversion happens here rather than at the call site.
 */
export function parseDiagnosticV1(
  stdout: string,
  status: number | null,
): ValidationResult {
  const payload = parseJsonObject(stdout);
  const raw = payload && payload.diagnostics;
  if (!Array.isArray(raw)) {
    // Unparseable output is an INFRASTRUCTURE failure, never a clean file: a
    // crashed validator must not read as "board.yaml is fine".
    return { outcome: "failed", issues: [] };
  }

  const issues = raw.filter(isRecord).map(toIssue).filter(isPresent);

  if (issues.length === 0) {
    return { outcome: status === 0 ? "clean" : "failed", issues: [] };
  }
  return { outcome: "schema-violation", issues };
}

function toIssue(diagnostic: Record<string, unknown>): ValidationIssue | null {
  const message = diagnostic.message;
  if (typeof message !== "string") return null;

  const issue: ValidationIssue = {
    message,
    severity: toSeverity(diagnostic.severity),
  };
  if (typeof diagnostic.code === "string" && diagnostic.code.length > 0) {
    issue.code = diagnostic.code;
  }

  const location = toLocation(diagnostic.range);
  if (location) {
    issue.line = location.line;
    issue.col = location.col;
  }
  return issue;
}

/**
 * The 1-based location a `range` names, or null when it names none.
 *
 * A zero-width range AT THE ORIGIN is tan saying "I have no location", not
 * "line 1": `--offline` returns `0,0 -> 0,0` for every failure it reports,
 * including a missing file, where no line exists to point at. Treating it as a
 * real position would pin every such diagnostic to the first line and displace
 * the prose scan that can still find the offending key. A range that starts at
 * the origin but has WIDTH is a genuine first-line hit and is kept.
 */
function toLocation(range: unknown): { line: number; col: number } | null {
  if (!isRecord(range)) return null;
  const start = range.start;
  if (!isRecord(start)) return null;

  const line = toInteger(start.line);
  const character = toInteger(start.character);
  if (line === null || character === null) return null;

  const end = isRecord(range.end) ? range.end : null;
  const isOriginStub =
    line === 0 &&
    character === 0 &&
    toInteger(end?.line) === 0 &&
    toInteger(end?.character) === 0;
  if (isOriginStub) return null;

  return { line: line + 1, col: character + 1 };
}

function toSeverity(severity: unknown): ValidationSeverity {
  if (severity === "warning") return "warning";
  if (severity === "note" || severity === "info") return "suggestion";
  // Anything unrecognised is treated as an error rather than downgraded: a
  // severity this build does not know must not silently become advisory.
  return "error";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
