// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the Models panel: merging a `tan model list` + `tan model
// doctor` envelope pair into the webview's payload. No `vscode`, `fs`, or
// `child_process` here — that's the adapter (panel.ts), which shells `tan`
// and posts the result this module shapes.

import type { AlpIssue, CliOutcome } from "../alpCli/models";
import type { ModelsDataMessage } from "../ideHub/messages";

/**
 * Classify a `CliOutcome` into the message the user should see. A `null`
 * envelope has two different causes that need different messages:
 *  - `exitCode !== -1`: the command actually ran and returned a real process
 *    exit code, it just didn't emit a parseable envelope — the resolved `tan`
 *    doesn't understand `model --format json` at all (a genuinely old
 *    binary), so an actionable "update tan" message beats `outcome.message`'s
 *    generic exit-code-based fallback.
 *  - otherwise (real envelope, or `exitCode === -1` meaning the command never
 *    ran at all — binary unresolved, spawn ENOENT, spawn timeout):
 *    `outcome.message` already carries the real cause (see
 *    spawnAlpAsync/runAlpCommand/summarize), so surface THAT instead of
 *    misdiagnosing every such failure as "update tan".
 *
 * Shared by `toModelsData` (the refresh path) and `buildModel` (panel.ts) so
 * the same old-tan root cause reads the same way from both entry points.
 */
export function cliFailureMessage(outcome: CliOutcome): string {
  if (outcome.envelope === null && outcome.exitCode !== -1) {
    return "Update tan to a version with `tan model --format json` support.";
  }
  return outcome.message;
}

/**
 * Merge a `tan model list` + `tan model doctor` outcome pair into the
 * webview's `ModelsDataMessage`. Either outcome's envelope being `null` (CLI
 * didn't produce one) or `!ok` (validation/runtime failure) surfaces as
 * `ok:false` with an empty model/toolchain list.
 */
export function toModelsData(
  list: CliOutcome,
  doctor: CliOutcome,
): ModelsDataMessage {
  const listOk = list.envelope !== null && list.envelope.ok;
  const doctorOk = doctor.envelope !== null && doctor.envelope.ok;
  if (!listOk || !doctorOk) {
    const issues: AlpIssue[] = [
      ...(list.envelope?.issues ?? []),
      ...(doctor.envelope?.issues ?? []),
    ];
    let outdated: CliOutcome | undefined;
    for (const outcome of [list, doctor]) {
      if (outcome.envelope !== null) continue; // ok, or its issues are merged above
      if (outcome.exitCode !== -1) {
        outdated = outcome;
      } else {
        issues.push({
          code: "models.cli-error",
          severity: "error",
          message: cliFailureMessage(outcome),
        });
      }
    }
    if (outdated) {
      issues.push({
        code: "models.tan-outdated",
        severity: "error",
        message: cliFailureMessage(outdated),
      });
    }
    return {
      type: "modelsData",
      ok: false,
      models: [],
      toolchains: [],
      issues,
    };
  }
  const models = (list.envelope!.data as { models?: unknown[] }).models ?? [];
  const toolchains =
    (doctor.envelope!.data as { toolchains?: unknown[] }).toolchains ?? [];
  return {
    type: "modelsData",
    ok: true,
    models,
    toolchains,
    issues: [...list.envelope!.issues, ...doctor.envelope!.issues],
  };
}
