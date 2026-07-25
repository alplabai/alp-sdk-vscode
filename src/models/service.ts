// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the Models panel: merging a `tan model list` + `tan model
// doctor` envelope pair into the webview's payload. No `vscode`, `fs`, or
// `child_process` here — that's the adapter (panel.ts), which shells `tan`
// and posts the result this module shapes.

import type { AlpIssue, CliOutcome } from "../alpCli/models";
import type {
  ModelAbResultMessage,
  ModelEnergyMeasurement,
  ModelFitDataMessage,
  ModelPrepResultMessage,
  ModelRunResultMessage,
  ModelsDataMessage,
  ZooAddResultMessage,
  ZooDataMessage,
} from "../ideHub/messages";

/**
 * Structurally validate a raw `energy` value (from `tan model run`/`tan model
 * ab`'s JSON) into a `ModelEnergyMeasurement`, or `undefined` if it isn't one.
 * `energy` is `null` on the overwhelmingly common host-only run — that, a
 * missing key, and a malformed/partial object (wrong field type, a dropped
 * field) must all degrade to "no energy" here rather than throwing or
 * handing the webview a half-populated object to render.
 */
function shapeEnergy(raw: unknown): ModelEnergyMeasurement | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  if (
    typeof e.source !== "string" ||
    typeof e.scope !== "string" ||
    typeof e.value_mj_per_inference !== "number" ||
    !Array.isArray(e.rails) ||
    !e.rails.every((r) => typeof r === "string") ||
    typeof e.n_inferences !== "number" ||
    typeof e.window_ms !== "number" ||
    typeof e.sample_count !== "number" ||
    !(e.spread_mj === null || typeof e.spread_mj === "number")
  ) {
    return undefined;
  }
  return {
    source: e.source,
    scope: e.scope,
    value_mj_per_inference: e.value_mj_per_inference,
    rails: e.rails as string[],
    n_inferences: e.n_inferences,
    window_ms: e.window_ms,
    sample_count: e.sample_count,
    spread_mj: e.spread_mj as number | null,
  };
}

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

/**
 * Shape a `tan model check --board` outcome into the webview's fit payload.
 * A `null` envelope (command never produced one) or `!ok` (validation/runtime
 * failure) surfaces as `ok:false` with an empty model list; the real cause is
 * `cliFailureMessage(outcome)` (a `null` envelope with a real exit code =
 * "update tan"; otherwise the outcome's own message) plus any envelope issues
 * (e.g. tan's `model.failed` carrying the alp stderr).
 */
export function toModelFitData(outcome: CliOutcome): ModelFitDataMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "modelFit.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "modelFitData", ok: false, models: [], issues };
  }
  const data = env.data as { sku?: string; models?: unknown[] };
  return {
    type: "modelFitData",
    ok: true,
    sku: data.sku,
    models: data.models ?? [],
    issues: env.issues,
  };
}

/**
 * Shape a `tan model prep` outcome into the webview's prep-result message.
 * A `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues (tan's `model.failed`).
 */
export function toModelPrepResult(outcome: CliOutcome): ModelPrepResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "modelPrep.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "modelPrepResult", ok: false, issues };
  }
  const data = env.data as {
    quantized?: string;
    accuracy?: ModelPrepResultMessage["accuracy"];
  };
  return {
    type: "modelPrepResult",
    ok: true,
    quantized: data.quantized,
    accuracy: data.accuracy,
    issues: env.issues,
  };
}

/**
 * Shape a `tan model run` outcome into the webview's run-result message. A
 * `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues (tan's `model.failed`).
 */
export function toModelRunResult(outcome: CliOutcome): ModelRunResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "modelRun.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "modelRunResult", ok: false, issues };
  }
  const run = env.data as NonNullable<ModelRunResultMessage["run"]>;
  const rawEnergy = (env.data as { energy?: unknown }).energy;
  return {
    type: "modelRunResult",
    ok: true,
    run: { ...run, energy: shapeEnergy(rawEnergy) },
    issues: env.issues,
  };
}

/**
 * Shape a `tan model ab` outcome into the webview's A/B-result message. A
 * `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues (tan's `model.failed`).
 */
export function toModelAbResult(outcome: CliOutcome): ModelAbResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "modelAb.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "modelAbResult", ok: false, issues };
  }
  const ab = env.data as NonNullable<ModelAbResultMessage["ab"]>;
  const rawA = (env.data as { a?: { energy?: unknown } }).a;
  const rawB = (env.data as { b?: { energy?: unknown } }).b;
  const rawDelta = (
    env.data as {
      comparison?: { energy_delta_mj_per_inference?: unknown };
    }
  ).comparison?.energy_delta_mj_per_inference;
  const energyA = shapeEnergy(rawA?.energy);
  const energyB = shapeEnergy(rawB?.energy);
  return {
    type: "modelAbResult",
    ok: true,
    ab: {
      ...ab,
      a: { ...ab.a, energy: energyA },
      b: { ...ab.b, energy: energyB },
      comparison: {
        ...ab.comparison,
        // Both sides must carry a real (validated) energy object — mirrors
        // the CLI, which only computes this delta when neither side is None.
        energy_delta_mj_per_inference:
          energyA !== undefined &&
          energyB !== undefined &&
          typeof rawDelta === "number"
            ? rawDelta
            : undefined,
      },
    },
    issues: env.issues,
  };
}

/**
 * Shape a `tan model zoo --board` outcome into the webview's gallery payload.
 * A `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues.
 */
export function toZooData(outcome: CliOutcome): ZooDataMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "zoo.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "zooData", ok: false, entries: [], issues };
  }
  const data = env.data as { entries?: ZooDataMessage["entries"] };
  return {
    type: "zooData",
    ok: true,
    entries: data.entries ?? [],
    issues: env.issues,
  };
}

/**
 * Shape a `tan model add <id> --board` outcome into the webview's add-result
 * message. A `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues (tan's `model.failed`).
 */
export function toZooAddResult(outcome: CliOutcome): ZooAddResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "zooAdd.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "zooAddResult", ok: false, issues };
  }
  const data = env.data as { added?: string };
  return {
    type: "zooAddResult",
    ok: true,
    added: data.added,
    issues: env.issues,
  };
}
