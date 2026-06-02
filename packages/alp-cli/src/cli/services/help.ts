// SPDX-License-Identifier: Apache-2.0

import {
  CLI_EXIT_CODE,
  CliCommand,
  CliExecutionResult,
  CliFormat,
} from "../models";
import { createEnvelope } from "./envelope";

export function createHelpResult(
  format: CliFormat,
  knownCommands: readonly CliCommand[],
): CliExecutionResult {
  const commands = knownCommands.join(", ");
  const textLines = [
    "ALP CLI",
    "Usage: alp <command> [options]",
    `Commands: ${commands}`,
    "Global flags: --project --board-yaml --sdk-root --format text|json --verbose --quiet --no-color --non-interactive --ci --help",
    "Generate flags: --target <emit-mode> --all",
    "Explain flags: --template <id> | --target <emit-mode>",
    "Presets flags: --project <path> --sdk-root <path>",
    "Init flags: --template <id> --name <project-name> --destination <path> --preview --force",
    "Scaffold flags: --template <id> --name <module-name> --destination <path> --preview --force",
    "Diff flags: --project <path> --board-yaml <path>",
    "Completion flags: --shell <bash|zsh|fish>",
    "Doctor flags: --target-kind <zephyr-mcu|baremetal-mcu|yocto-userspace|native-host> --server <jlink|openocd|pyocd|gdbserver|none>",
    "Inspect flags: --path <field-path> --show-origin",
    "Trace flags: --target <emit-mode> --path <field-path>",
    "Support-bundle flags: --destination <path> --target-kind <...> --server <...>",
    "Sdk flags: sdk list | sdk install <version> | sdk current | sdk switch <version|path> [--destination <cache-root>] [--sdk-root <path>]",
  ];

  return {
    format,
    exitCode: CLI_EXIT_CODE.success,
    textLines,
    envelope: createEnvelope(
      "help",
      {
        root: null,
        boardYaml: null,
      },
      {
        schemaVersion: "1",
        commands: [...knownCommands],
      },
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}
