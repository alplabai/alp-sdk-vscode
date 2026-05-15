// SPDX-License-Identifier: Apache-2.0

import {
    DebugServerKind,
    DebugTargetKind,
    DoctorCheck,
    DoctorReport,
} from "@alp-sdk/core/debug/models";
import { buildDoctorReport } from "@alp-sdk/core/debug/service";
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

interface DoctorCommandData {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  summary: DoctorReport["summary"];
  checks: DoctorCheck[];
  nextSteps: string[];
}

export function runDoctorCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<DoctorCommandData> {
  try {
    const resolved = resolveCliDebugContext(flags, input);

    const targetKind = parseTargetKind(flags.targetKind);
    const server = parseServerKind(flags.server);

    if (!isServerSupportedForTarget(targetKind, server)) {
      return createFailureResult(
        "doctor",
        flags.format,
        CLI_EXIT_CODE.doctorFailure,
        [
          `doctor: server '${server}' is not supported for target '${targetKind}'.`,
        ],
        [
          {
            code: "doctor.server-compatibility",
            severity: "error",
            message: `Server '${server}' is not supported for target '${targetKind}'.`,
          },
        ],
        {
          generatedAt: new Date().toISOString(),
          targetKind,
          server,
          summary: { pass: 0, warn: 0, fail: 1 },
          checks: [],
          nextSteps: [
            "Choose a supported server for the selected target-kind.",
          ],
        },
      );
    }

    const runtime = collectRuntimeCapabilitiesForCli(
      resolved.projectContext,
      input,
    );
    const report = buildDoctorReport(
      resolved.debugContext,
      {
        targetKind,
        server,
      },
      runtime,
    );

    const issues = doctorChecksToIssues(report.checks);
    const exitCode =
      report.summary.fail > 0
        ? CLI_EXIT_CODE.doctorFailure
        : CLI_EXIT_CODE.success;

    return {
      format: flags.format,
      exitCode,
      textLines: formatDoctorText(report, flags),
      envelope: createEnvelope(
        "doctor",
        {
          root: resolved.projectContext.workspaceRoot,
          boardYaml: resolved.projectContext.boardYamlPath,
        },
        {
          generatedAt: report.generatedAt,
          targetKind: report.targetKind,
          server: report.server,
          summary: report.summary,
          checks: report.checks,
          nextSteps: report.nextSteps,
        },
        issues,
        exitCode,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI doctor failure.";
    return createFailureResult(
      "doctor",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["doctor: internal failure", message],
      [
        {
          code: "doctor.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        generatedAt: new Date().toISOString(),
        targetKind: "native-host",
        server: "none",
        summary: { pass: 0, warn: 0, fail: 1 },
        checks: [],
        nextSteps: [],
      },
    );
  }
}

function doctorChecksToIssues(checks: readonly DoctorCheck[]): CliIssue[] {
  const issues: CliIssue[] = [];
  for (const check of checks) {
    if (check.status === "pass") {
      continue;
    }

    issues.push({
      code: `doctor.${check.name}`,
      severity: check.status === "fail" ? "error" : "warning",
      message: check.detail,
    });
  }

  return issues;
}

function formatDoctorText(
  report: DoctorReport,
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines: string[] = [
    `doctor: pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`,
    `target=${report.targetKind} server=${report.server}`,
  ];

  if (!flags.quiet) {
    for (const check of report.checks) {
      lines.push(`[${check.status}] ${check.name}: ${check.detail}`);
    }
  }

  if (flags.verbose && report.nextSteps.length > 0) {
    lines.push("next-steps:");
    for (const nextStep of report.nextSteps) {
      lines.push(`- ${nextStep}`);
    }
  }

  return lines;
}
