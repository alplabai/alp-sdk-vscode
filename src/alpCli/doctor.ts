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
import type { CliOutcome } from "./models";
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
  // #474: `fix` and `nextSteps` are now RENDERED, not merely carried, so they
  // have to be narrowed here too. Before that they were dead weight in the
  // type and an unexpected shape cost nothing; now the troubleshooting panel
  // calls `escapeHtml` on `fix` and `.map` on `nextSteps`, and a tan that
  // restructured either one — `fix` as the `{command}` object #347 debated,
  // say — would throw mid-render. `openDebugTroubleshootingPanel` creates the
  // webview BEFORE assigning its html, so that throw leaves an EMPTY panel
  // open behind a generic toast naming no field. Refusing the payload here
  // turns it into `tanPayloadShape`'s explained message instead.
  if (
    data.nextSteps !== undefined &&
    data.nextSteps !== null &&
    (!Array.isArray(data.nextSteps) ||
      !data.nextSteps.every((step) => typeof step === "string"))
  ) {
    return false;
  }
  return data.checks.every((check) => {
    const entry = check as Record<string, unknown> | null;
    return (
      typeof entry?.name === "string" &&
      typeof entry.status === "string" &&
      typeof entry.detail === "string" &&
      (entry.fix === undefined ||
        entry.fix === null ||
        typeof entry.fix === "string")
    );
  });
}

/**
 * Run one doctor invocation (`tan doctor` or `tan doctor --build`) and return
 * its `data`, or `null` when it produced nothing a consumer can read.
 *
 * Returns the full `outcome` alongside the convenience fields — a caller that
 * needs to TOAST the failure (`alp.debugDoctor`'s degraded path) must route it
 * through `planCliOutcome` (`src/notify/service.ts`) like every other CLI
 * consumer in this repo, rather than build a bare, buttonless `planFailure`
 * off `message` alone: `planCliOutcome` is what splits "tan was never
 * installed" (an Install action) from "tan is there but broken" (Settings/
 * Doctor actions) and offers Retry, none of which a plain sentence can.
 *
 * `message` / `detail` are pulled out as a convenience for callers that do
 * NOT toast — the support bundle (a FILE) and the troubleshooting panel
 * (channel-grade text, not a toast). `detail` is `outcome.unavailable.detail`
 * — the raw errno / resolver text (`src/alpCli/models.ts`'s own doc: "MUST
 * NOT be interpolated into anything the customer sees", i.e. never a toast,
 * which is exactly why a toasting caller must use `planCliOutcome(outcome,
 * …)` and never read `detail` directly). It is set ONLY on the unavailable
 * path (`outcome.unavailable` exists only when no envelope exists because the
 * binary itself failed to resolve or run), and it is carried here rather than
 * dropped so a bundle exported precisely when things are broken keeps the
 * actual diagnosis rather than a generic "tan CLI unavailable." with nothing
 * behind it.
 *
 * Exit 4 (`docs/CLI.md`'s doctor exit code) is a FAILING REPORT, not a failed
 * retrieval: `classifyOutcome` (`src/alpCli/service.ts`) still parses and
 * attaches `outcome.envelope` on a nonzero exit, and this reads `data` off
 * that envelope the same as on exit 0 — only a genuinely missing or
 * unparsable envelope returns `data: null`. A caller must render a failing
 * report, never treat exit 4 as "tan unavailable". Verified against the
 * pinned binary: a real failing run exits 4 with a full `data` payload, 14
 * checks, `summary {pass:9, warn:3, fail:1}` — tan's own count is 13, one
 * short of `checks.length`, because tan excludes an `unknown` check
 * (`setools`, unrunnable on this host) from the tally exactly the way this
 * repo's own never-recount rule requires; nothing here may add that check
 * back into a count tan itself left it out of.
 */
export async function runDoctor(
  context: vscode.ExtensionContext,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  interactive: boolean,
): Promise<{
  data: DoctorEnvelopeData | null;
  message: string;
  detail?: string;
  outcome: CliOutcome;
}> {
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
    return {
      data: null,
      message: outcome.message,
      detail: outcome.unavailable?.detail,
      outcome,
    };
  }
  return { data, message: outcome.message, outcome };
}
