// SPDX-License-Identifier: Apache-2.0

import {
    CLI_EXIT_CODE,
    CliCommand,
    CliExecutionInput,
    CliExecutionResult,
} from "./models";
import { parseCliArgs } from "./services/args";
import {
  runCompletionCommand,
    runDiffCommand,
    runDoctorCommand,
    runExplainCommand,
    runGenerateCommand,
    runInitCommand,
    runPresetsCommand,
    runScaffoldCommand,
    runValidateCommand,
} from "./services/commands/index";
import { createEnvelope, createFailureResult } from "./services/envelope";
import { createHelpResult } from "./services/help";

const KNOWN_COMMANDS: readonly CliCommand[] = [
  "validate",
  "generate",
  "explain",
  "presets",
  "init",
  "scaffold",
  "diff",
  "completion",
  "inspect",
  "trace",
  "doctor",
  "support-bundle",
  "debug-config",
];

const IMPLEMENTED_COMMANDS = new Set<CliCommand>([
  "validate",
  "generate",
  "explain",
  "presets",
  "init",
  "scaffold",
  "diff",
  "completion",
  "doctor",
]);

export { createEnvelope, parseCliArgs, runValidateCommand };

export function executeCli(input: CliExecutionInput): CliExecutionResult {
  const parsed = parseCliArgs(input.argv);

  if (parsed.flags.help) {
    return createHelpResult(parsed.flags.format, KNOWN_COMMANDS);
  }

  if (parsed.errors.length > 0) {
    const message = [
      "Invalid arguments:",
      ...parsed.errors.map((error) => `- ${error}`),
      "Run alp --help for usage.",
    ].join("\n");
    return createFailureResult(
      "cli",
      parsed.flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      ["Invalid arguments.", ...parsed.errors],
      [
        {
          code: "cli.invalid-arguments",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
      },
    );
  }

  if (!parsed.command) {
    return createFailureResult(
      "cli",
      parsed.flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      ["Missing command.", "Run alp --help for usage."],
      [
        {
          code: "cli.missing-command",
          severity: "error",
          message: "A command is required.",
        },
      ],
      {
        schemaVersion: "1",
      },
    );
  }

  if (!isKnownCommand(parsed.command)) {
    return createFailureResult(
      parsed.command,
      parsed.flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [
        `Unsupported command: ${parsed.command}`,
        "Run alp --help for supported commands.",
      ],
      [
        {
          code: "cli.unsupported-command",
          severity: "error",
          message: `Unsupported command: ${parsed.command}`,
        },
      ],
      {
        schemaVersion: "1",
      },
    );
  }

  if (!IMPLEMENTED_COMMANDS.has(parsed.command)) {
    return createFailureResult(
      parsed.command,
      parsed.flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [
        `${parsed.command}: not implemented yet.`,
        `Use one of implemented commands: ${[...IMPLEMENTED_COMMANDS].join(", ")}.`,
      ],
      [
        {
          code: "cli.not-implemented",
          severity: "error",
          message: `Command '${parsed.command}' is not implemented yet.`,
        },
      ],
      {
        schemaVersion: "1",
      },
    );
  }

  switch (parsed.command) {
    case "validate":
      return runValidateCommand(parsed.flags, input);
    case "generate":
      return runGenerateCommand(parsed.flags, input);
    case "explain":
      return runExplainCommand(parsed.flags, input);
    case "presets":
      return runPresetsCommand(parsed.flags, input);
    case "init":
      return runInitCommand(parsed.flags, input);
    case "scaffold":
      return runScaffoldCommand(parsed.flags, input);
    case "diff":
      return runDiffCommand(parsed.flags, input);
    case "completion":
      return runCompletionCommand(parsed.flags, input);
    case "doctor":
      return runDoctorCommand(parsed.flags, input);
    default:
      return createFailureResult(
        parsed.command,
        parsed.flags.format,
        CLI_EXIT_CODE.internalFailure,
        ["cli: internal failure", "Implemented command dispatch failed."],
        [
          {
            code: "cli.internal-dispatch",
            severity: "error",
            message: "Implemented command dispatch failed.",
          },
        ],
        {
          schemaVersion: "1",
        },
      );
  }
}

function isKnownCommand(command: string): command is CliCommand {
  return (KNOWN_COMMANDS as readonly string[]).includes(command);
}
