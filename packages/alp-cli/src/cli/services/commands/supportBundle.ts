// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import {
  DebugGenerationTraceDecision,
  DebugServerKind,
  DebugTargetKind,
  DoctorCheck,
} from "@alp-sdk/core/debug/models";
import {
  buildDoctorReport,
  createGenerationTraceReport,
  createInspectReport,
  createSupportBundlePayload,
  serializeSupportBundlePayload,
} from "@alp-sdk/core/debug/service";
import { EmitMode } from "@alp-sdk/core/loader/models";
import { ALL_EMIT_MODES, createLoaderPlan } from "@alp-sdk/core/loader/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
  CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";
import {
  collectRuntimeCapabilitiesForCli,
  isServerSupportedForTarget,
  parseServerKind,
  parseTargetKind,
  resolveCliDebugContext,
} from "./debugShared";

interface SupportBundleCommandData {
  schemaVersion: "1";
  generatedAt: string;
  outputPath: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  decisionCount: number;
}

export function runSupportBundleCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<SupportBundleCommandData> {
  try {
    const resolved = resolveCliDebugContext(flags, input);
    const targetKind = parseTargetKind(flags.targetKind);
    const server = parseServerKind(flags.server);

    if (!isServerSupportedForTarget(targetKind, server)) {
      return createFailureResult(
        "support-bundle",
        flags.format,
        CLI_EXIT_CODE.doctorFailure,
        [
          `support-bundle: server '${server}' is not supported for target '${targetKind}'.`,
        ],
        [
          {
            code: "support-bundle.server-compatibility",
            severity: "error",
            message: `Server '${server}' is not supported for target '${targetKind}'.`,
          },
        ],
        {
          schemaVersion: "1",
          generatedAt: resolved.generatedAt,
          outputPath: "",
          targetKind,
          server,
          decisionCount: 0,
        },
      );
    }

    const runtime = collectRuntimeCapabilitiesForCli(
      resolved.projectContext,
      input,
    );
    const inspect = createInspectReport(resolved.debugContext);
    const traceDecisions = createBundleTraceDecisions(
      resolved.projectContext,
      flags.target,
      flags.inspectPath,
    );
    const trace = createGenerationTraceReport(
      resolved.generatedAt,
      "cli.support-bundle",
      traceDecisions,
    );
    const doctor = buildDoctorReport(
      resolved.debugContext,
      { targetKind, server },
      runtime,
    );

    const bundle = createSupportBundlePayload({
      generatedAt: resolved.generatedAt,
      inspect,
      trace,
      doctor,
      notes: [
        `targetKind=${targetKind}`,
        `server=${server}`,
        `workspaceRoot=${resolved.workspaceRoot}`,
      ],
    });

    const outputPath = writeBundle(
      flags.destination,
      resolved.workspaceRoot,
      resolved.generatedAt,
      serializeSupportBundlePayload(bundle),
      input.cwd,
    );

    const issues = doctorChecksToIssues(doctor.checks);
    const exitCode =
      doctor.summary.fail > 0
        ? CLI_EXIT_CODE.doctorFailure
        : CLI_EXIT_CODE.success;

    return {
      format: flags.format,
      exitCode,
      textLines: formatSupportBundleTextLines(
        outputPath,
        traceDecisions.length,
        flags,
      ),
      envelope: createEnvelope(
        "support-bundle",
        {
          root: resolved.projectContext.workspaceRoot,
          boardYaml: resolved.projectContext.boardYamlPath,
        },
        {
          schemaVersion: "1",
          generatedAt: resolved.generatedAt,
          outputPath,
          targetKind,
          server,
          decisionCount: traceDecisions.length,
        },
        issues,
        exitCode,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI support-bundle failure.";
    return createFailureResult(
      "support-bundle",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["support-bundle: internal failure", message],
      [
        {
          code: "support-bundle.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        outputPath: "",
        targetKind: "native-host",
        server: "none",
        decisionCount: 0,
      },
    );
  }
}

function createBundleTraceDecisions(
  context: {
    workspaceRoot: string | null;
    sdkRoot: string | null;
    boardYamlPath: string | null;
    westCwd: string | null;
    pythonBinary: string;
  },
  target: string | null,
  focusPath: string | null,
): DebugGenerationTraceDecision[] {
  const decisions: DebugGenerationTraceDecision[] = [];

  if (context.workspaceRoot && context.sdkRoot && context.boardYamlPath) {
    const emits = resolveTargets(target);
    for (const emit of emits) {
      const plan = createLoaderPlan(context, emit);
      decisions.push({
        key: `generation.target.${emit}`,
        outcome: "planned",
        outputPath: plan.outputPath,
        detail: `Would run: ${plan.commandLine}`,
      });
    }
  } else {
    decisions.push({
      key: "generation.targets",
      outcome: "failed",
      detail:
        "Generation targets were not traced because project context is unresolved.",
    });
  }

  if (focusPath) {
    decisions.push({
      key: `config.path.${focusPath}`,
      outcome: "planned",
      detail:
        "Path-level trace was requested and captured as part of bundle metadata.",
    });
  }

  return decisions;
}

function resolveTargets(rawTarget: string | null): EmitMode[] {
  if (!rawTarget) {
    return [...ALL_EMIT_MODES];
  }

  if ((ALL_EMIT_MODES as readonly string[]).includes(rawTarget)) {
    return [rawTarget as EmitMode];
  }

  throw new Error(
    `Unsupported trace target '${rawTarget}'. Allowed values: ${ALL_EMIT_MODES.join(", ")}.`,
  );
}

function writeBundle(
  destination: string | null,
  workspaceRoot: string,
  generatedAt: string,
  content: string,
  cwd: string,
): string {
  const baseOutputDir = destination
    ? path.resolve(cwd, destination)
    : path.join(workspaceRoot, ".alp-support");
  const fileName = `debug-support-bundle-${timestampForFile(generatedAt)}.json`;
  const outputPath = path.join(baseOutputDir, fileName);

  fs.mkdirSync(baseOutputDir, { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

function timestampForFile(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}

function doctorChecksToIssues(checks: readonly DoctorCheck[]): CliIssue[] {
  const issues: CliIssue[] = [];
  for (const check of checks) {
    if (check.status === "pass") {
      continue;
    }

    issues.push({
      code: `support-bundle.${check.name}`,
      severity: check.status === "fail" ? "error" : "warning",
      message: check.detail,
    });
  }

  return issues;
}

function formatSupportBundleTextLines(
  outputPath: string,
  decisionCount: number,
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines = [
    `support-bundle: exported ${outputPath}`,
    `support-bundle: trace decisions=${decisionCount}`,
  ];

  if (flags.verbose) {
    lines.push(
      "support-bundle: include --format json for machine-readable envelopes.",
    );
  }

  return lines;
}
