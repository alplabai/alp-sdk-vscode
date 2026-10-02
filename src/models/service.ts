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
  ModelPowerData,
  ModelPowerResultMessage,
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
 * Shape a `tan model check --board` outcome into the webview's NPU-coverage
 * payload.
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

// ---------------------------------------------------------------------------
// Power measurement (`scripts/alp_power.py measure|replay --format json`)
// ---------------------------------------------------------------------------

/** Raw result of spawning `alp_power.py`: what the adapter saw, unparsed.
 *  `message` carries a spawn-level cause (ENOENT, timeout) when there is no
 *  usable stdout. */
export interface PowerOutcome {
  exitCode: number;
  stdout: string;
  stderr?: string;
  message?: string;
}

/** Last `n` non-empty lines of a process's stderr (tracebacks, argparse). */
export function stderrTail(stderr: string | undefined, n = 20): string {
  return (stderr ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-n)
    .join("\n");
}

export interface PowerSettings {
  monitors: string[];
  marker: string;
  seconds: number;
  idleSeconds: number;
  periodUs: number;
}

/** Raw `alpSdk.power.*` values as read from configuration (untrusted). */
export interface RawPowerSettings {
  monitors: unknown;
  marker: unknown;
  seconds: unknown;
  idleSeconds: unknown;
  periodUs: unknown;
}

export const POWER_PERIOD_US_MIN = 200;
export const POWER_PERIOD_US_MAX = 10_000_000;

/** Validate the settings before anything is spawned. Returns the first
 *  problem as a message instead of silently substituting a default. */
export function checkPowerSettings(
  raw: RawPowerSettings,
): { settings: PowerSettings } | { error: string } {
  const monitors = (Array.isArray(raw.monitors) ? raw.monitors : [])
    .map((m) => String(m).trim())
    .filter((m) => m !== "");
  if (monitors.length === 0) {
    return {
      error:
        "No power monitors configured. Set `alpSdk.power.monitors` " +
        "(e.g. NAME=ina236@0x4A,shunt=0.02) in Settings, then retry.",
    };
  }
  const { seconds, idleSeconds, periodUs } = raw;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) {
    return { error: "`alpSdk.power.seconds` must be a number >= 1." };
  }
  if (
    typeof idleSeconds !== "number" ||
    !Number.isFinite(idleSeconds) ||
    idleSeconds < 0
  ) {
    return { error: "`alpSdk.power.idleSeconds` must be a number >= 0." };
  }
  if (
    typeof periodUs !== "number" ||
    !Number.isInteger(periodUs) ||
    periodUs < POWER_PERIOD_US_MIN ||
    periodUs > POWER_PERIOD_US_MAX
  ) {
    return {
      error:
        "`alpSdk.power.periodUs` must be an integer between " +
        `${POWER_PERIOD_US_MIN} and ${POWER_PERIOD_US_MAX}.`,
    };
  }
  return {
    settings: {
      monitors,
      marker: typeof raw.marker === "string" ? raw.marker.trim() : "",
      seconds,
      idleSeconds,
      periodUs,
    },
  };
}

/** Margin on top of the capture window for probe handshake + analysis. */
const POWER_TIMEOUT_MARGIN_MS = 30_000;

export function powerTimeoutMs(s: PowerSettings): number {
  return (s.seconds + s.idleSeconds) * 1000 + POWER_TIMEOUT_MARGIN_MS;
}

/** Argv (after the interpreter) for `alp_power.py measure`. */
export function buildPowerMeasureArgs(
  script: string,
  s: PowerSettings,
): string[] {
  const args = [script, "measure"];
  for (const m of s.monitors) args.push("--monitor", m);
  if (s.marker) args.push("--marker", s.marker);
  args.push(
    "--seconds",
    String(s.seconds),
    "--idle-seconds",
    String(s.idleSeconds),
    "--period-us",
    String(s.periodUs),
    "--format",
    "json",
  );
  return args;
}

function powerFailure(
  code: string,
  message: string,
  extra: AlpIssue[] = [],
): ModelPowerResultMessage {
  return {
    type: "modelPowerResult",
    ok: false,
    issues: [...extra, { code, severity: "error", message }],
  };
}

function shapeIssues(raw: unknown): AlpIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i): AlpIssue[] => {
    if (i === null || typeof i !== "object") return [];
    const r = i as Record<string, unknown>;
    if (typeof r.message !== "string") return [];
    const sev = r.severity;
    return [
      {
        code: typeof r.code === "string" ? r.code : "power.issue",
        severity:
          sev === "error" || sev === "warning" || sev === "info"
            ? sev
            : "warning",
        message: r.message,
      },
    ];
  });
}

const numOrNull = (v: unknown): boolean =>
  v === null || (typeof v === "number" && Number.isFinite(v));
const isNum = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v);

/** First structural problem in an envelope's `data`, or undefined if the
 *  webview can render it. Null-or-number fields stay null (never coerced). */
function powerDataShapeError(data: unknown): string | undefined {
  const d = data as Record<string, unknown>;
  if (d.source !== "probe" && d.source !== "replay") return "bad source";
  for (const k of ["period_us", "duration_s", "inferences", "dropped"]) {
    if (!isNum(d[k])) return `${k} is not a number`;
  }
  const lat = d.latency_us as Record<string, unknown> | null;
  if (lat === null || typeof lat !== "object" || Array.isArray(lat)) {
    return "latency_us is not an object";
  }
  if (!numOrNull(lat.median) || !numOrNull(lat.p90)) {
    return "latency_us values must be numbers or null";
  }
  if (!Array.isArray(d.rails)) return "rails is not an array";
  for (const r of d.rails as unknown[]) {
    const rr = r as Record<string, unknown> | null;
    if (rr === null || typeof rr !== "object") return "a rail is not an object";
    for (const k of ["name", "part", "addr"]) {
      if (typeof rr[k] !== "string") return `rail ${k} is not a string`;
    }
    for (const k of [
      "avg_idle_mw",
      "avg_active_mw",
      "energy_per_inference_mj",
      "gross_energy_per_inference_mj",
    ]) {
      if (!numOrNull(rr[k])) return `rail ${k} must be a number or null`;
    }
    if (!isNum(rr.samples)) return "rail samples is not a number";
  }
  if (d.note !== undefined && typeof d.note !== "string") {
    return "note is not a string";
  }
  if (
    d.probe !== null &&
    d.probe !== undefined &&
    typeof d.probe !== "object"
  ) {
    return "probe is not an object";
  }
  return undefined;
}

/**
 * Shape an `alp_power.py` run into the webview's power-result message. Null
 * figures in `data` are passed through untouched (the view renders "n/a");
 * nothing is coerced to 0. A missing outcome, unparsable stdout, or an
 * envelope without a boolean `ok` all become an error issue — never silence.
 */
export function toPowerResult(
  outcome: PowerOutcome | null,
): ModelPowerResultMessage {
  if (outcome === null) {
    return powerFailure("power.cli-error", "Power measurement did not run.");
  }
  const tail = stderrTail(outcome.stderr);
  const cause =
    (outcome.message ?? `alp_power.py exited with code ${outcome.exitCode}.`) +
    (tail ? `\nstderr (last lines):\n${tail}` : "");
  let env: unknown;
  try {
    env = JSON.parse(outcome.stdout);
  } catch {
    return powerFailure(
      "power.malformed-output",
      `alp_power.py produced no JSON envelope. ${cause}`,
    );
  }
  const e = env as { ok?: unknown; data?: unknown; issues?: unknown } | null;
  if (e === null || typeof e !== "object" || typeof e.ok !== "boolean") {
    return powerFailure(
      "power.malformed-output",
      `alp_power.py output is not a valid envelope. ${cause}`,
    );
  }
  const issues = shapeIssues(e.issues);
  if (!e.ok) {
    return issues.length > 0
      ? { type: "modelPowerResult", ok: false, issues }
      : powerFailure("power.failed", `Power measurement failed. ${cause}`);
  }
  if (e.data === null || typeof e.data !== "object") {
    return powerFailure(
      "power.malformed-output",
      "alp_power.py reported success without data.",
      issues,
    );
  }
  const shapeError = powerDataShapeError(e.data);
  if (shapeError) {
    return powerFailure(
      "power.malformed-output",
      `alp_power.py data is malformed: ${shapeError}`,
      issues,
    );
  }
  return {
    type: "modelPowerResult",
    ok: true,
    power: e.data as ModelPowerData,
    issues,
  };
}
