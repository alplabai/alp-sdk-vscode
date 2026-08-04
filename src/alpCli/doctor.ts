// SPDX-License-Identifier: Apache-2.0
//
// The one `tan doctor` spawn path, shared by the dependency panel
// (`src/deps/vscodeAdapter.ts`) and the debug-doctor consumers
// (`src/debug/vscodeAdapter.ts`, #376) — extracted out of
// `src/deps/vscodeAdapter.ts` so the two slices spawn `tan doctor` exactly
// once rather than drifting into two ways of running the same command. That
// drift, in TypeScript re-deriving what a check MEANT rather than reading
// it, is how tan-cli#104/#105 happened; this file never interprets a check,
// only fetches and validates the envelope shape.

import type { DoctorEnvelopeData } from "@alp-sdk/core/cli/doctorEnvelope";
import * as vscode from "vscode";

import { runAlpCommand } from "./vscodeAdapter";
import { log } from "../util";

/**
 * Boundary check on the untrusted `data` payload before a consumer (the deps
 * planner, or a debug-doctor caller) reads it.
 *
 * Deliberately does NOT look at `missingPrerequisites`: this narrows the
 * value, it never rebuilds it, so the key's ABSENCE survives into a planner
 * that feature-detects on it (see `DoctorEnvelopeData`'s own doc).
 */
export function isDoctorEnvelopeData(
  value: unknown,
): value is DoctorEnvelopeData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown> | undefined;
  if (!Array.isArray(data.checks) || !summary) return false;
  if (
    typeof summary.pass !== "number" ||
    typeof summary.warn !== "number" ||
    typeof summary.fail !== "number"
  ) {
    return false;
  }
  return data.checks.every((check) => {
    const entry = check as Record<string, unknown> | null;
    return (
      typeof entry?.name === "string" &&
      typeof entry.status === "string" &&
      typeof entry.detail === "string"
    );
  });
}

/**
 * Run one doctor invocation (`tan doctor` or `tan doctor --build`) and return
 * its `data`, or `null` when it produced nothing a consumer can read. The
 * failure is already in the "Alp SDK" channel (`runAlpCommand` logs the exit
 * code and stderr); `message` is the sentence a caller shows when NOTHING
 * usable came back at all.
 *
 * Exit 4 (`docs/CLI.md`'s doctor exit code) is a FAILING REPORT, not a failed
 * retrieval: `classifyOutcome` (`src/alpCli/service.ts`) still parses and
 * attaches `outcome.envelope` on a nonzero exit, and this reads `data` off
 * that envelope the same as on exit 0 — only a genuinely missing or
 * unparsable envelope returns `data: null`. A caller must render a failing
 * report, never treat exit 4 as "tan unavailable".
 */
export async function runDoctor(
  context: vscode.ExtensionContext,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  interactive: boolean,
): Promise<{ data: DoctorEnvelopeData | null; message: string }> {
  const { outcome } = await runAlpCommand(context, args, cwd, {
    signal,
    interactive,
  });
  const data = outcome.envelope?.data;
  if (!outcome.envelope || !isDoctorEnvelopeData(data)) {
    log(
      `[cli] \`tan ${args.join(" ")}\` produced no usable envelope: ` +
        outcome.message,
    );
    return { data: null, message: outcome.message };
  }
  return { data, message: outcome.message };
}
