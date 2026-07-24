// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the Models panel: merging a `tan model list` + `tan model
// doctor` envelope pair into the webview's payload. No `vscode`, `fs`, or
// `child_process` here — that's the adapter (panel.ts), which shells `tan`
// and posts the result this module shapes.

import type { AlpEnvelope, AlpIssue } from "../alpCli/models";
import type { ModelsDataMessage } from "../ideHub/messages";

/**
 * Merge a `tan model list` + `tan model doctor` envelope pair into the
 * webview's `ModelsDataMessage`. Either envelope being `null` (CLI resolution
 * failed) or `!ok` (validation/runtime failure) surfaces as `ok:false` with
 * an empty model/toolchain list; a `null` envelope additionally means the
 * resolved `tan` doesn't understand `model` at all, so it gets a synthesized,
 * actionable issue instead of the panel just going blank.
 */
export function toModelsData(
  listEnv: AlpEnvelope | null,
  doctorEnv: AlpEnvelope | null,
): ModelsDataMessage {
  const listOk = listEnv !== null && listEnv.ok;
  const doctorOk = doctorEnv !== null && doctorEnv.ok;
  if (!listOk || !doctorOk) {
    const issues: AlpIssue[] = [
      ...(listEnv?.issues ?? []),
      ...(doctorEnv?.issues ?? []),
    ];
    if (listEnv === null || doctorEnv === null) {
      issues.push({
        code: "models.tan-outdated",
        severity: "error",
        message:
          "Update tan to a version with `tan model --format json` support.",
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
  const models = (listEnv.data as { models?: unknown[] }).models ?? [];
  const toolchains =
    (doctorEnv.data as { toolchains?: unknown[] }).toolchains ?? [];
  return {
    type: "modelsData",
    ok: true,
    models,
    toolchains,
    issues: [...listEnv.issues, ...doctorEnv.issues],
  };
}
