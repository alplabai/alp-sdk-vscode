// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
  collectRuntimeCapabilitiesFromCommands,
  createDebugWorkspaceContext,
} from "../../../debug/adapterCore";
import {
  DebugServerKind,
  DebugTargetKind,
  DoctorCheck,
  DoctorReport,
} from "../../../debug/models";
import { buildDoctorReport, serverChoicesForTarget } from "../../../debug/service";
import { ProjectSettings } from "../../../project/models";
import { resolveProjectContext } from "../../../project/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
  CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

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
    const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
    const settings: ProjectSettings = {
      sdkPath: flags.sdkRoot ?? "",
      pythonPath: "",
      boardYamlPath: flags.boardYamlPath ?? "board.yaml",
      westCwd: "",
    };
    const projectContext = resolveProjectContext(
      {
        workspaceFolders: [workspaceRoot],
        settings,
        platform: input.platform,
      },
      input.pathExists,
    );

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

    const generatedAt = new Date().toISOString();
    const debugContext = createDebugWorkspaceContext(projectContext, {
      generatedAt,
      boardYamlExists: input.pathExists,
      debuggerExtensions: {
        cortexDebug: true,
        cppTools: true,
        codeLLDB: true,
      },
    });
    const runtime = collectRuntimeCapabilitiesFromCommands(
      projectContext,
      (command) => commandExistsOnPath(input, command),
    );
    const report = buildDoctorReport(
      debugContext,
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
          root: projectContext.workspaceRoot,
          boardYaml: projectContext.boardYamlPath,
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

function parseTargetKind(raw: string | null): DebugTargetKind {
  if (!raw) {
    return "native-host";
  }

  if (
    raw === "zephyr-mcu" ||
    raw === "baremetal-mcu" ||
    raw === "yocto-userspace" ||
    raw === "native-host"
  ) {
    return raw;
  }

  throw new Error(
    `Unsupported --target-kind '${raw}'. Allowed values: zephyr-mcu, baremetal-mcu, yocto-userspace, native-host.`,
  );
}

function parseServerKind(raw: string | null): DebugServerKind {
  if (!raw) {
    return "none";
  }

  if (
    raw === "jlink" ||
    raw === "openocd" ||
    raw === "pyocd" ||
    raw === "gdbserver" ||
    raw === "none"
  ) {
    return raw;
  }

  throw new Error(
    `Unsupported --server '${raw}'. Allowed values: jlink, openocd, pyocd, gdbserver, none.`,
  );
}

function isServerSupportedForTarget(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
): boolean {
  return serverChoicesForTarget(targetKind).some(
    (choice) => choice.server === server,
  );
}

function commandExistsOnPath(
  input: Omit<CliExecutionInput, "argv">,
  command: string,
): boolean {
  const resolver = input.platform === "win32" ? "where" : "which";
  const result = input.spawnSync(resolver, [command], { encoding: "utf8" });
  return result.status === 0;
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
