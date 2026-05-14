// SPDX-License-Identifier: Apache-2.0

import { CliFormat, CliGlobalFlags, CliParseResult } from "../models";

function createDefaultFlags(): CliGlobalFlags {
  return {
    projectPath: null,
    boardYamlPath: null,
    sdkRoot: null,
    target: null,
    all: false,
    targetKind: null,
    server: null,
    template: null,
    name: null,
    destination: null,
    shell: null,
    preview: false,
    force: false,
    format: "text",
    verbose: false,
    quiet: false,
    noColor: false,
    nonInteractive: false,
    ci: false,
    help: false,
  };
}

export function parseCliArgs(argv: readonly string[]): CliParseResult {
  const flags = createDefaultFlags();
  const errors: string[] = [];
  const commandArgs: string[] = [];
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token.startsWith("--")) {
      const parsed = parseLongFlag(token, argv, index);
      index = parsed.nextIndex;
      if (parsed.error) {
        errors.push(parsed.error);
        continue;
      }

      switch (parsed.name) {
        case "project":
          flags.projectPath = parsed.value;
          break;
        case "board-yaml":
          flags.boardYamlPath = parsed.value;
          break;
        case "sdk-root":
          flags.sdkRoot = parsed.value;
          break;
        case "target":
          flags.target = parsed.value;
          break;
        case "target-kind":
          flags.targetKind = parsed.value;
          break;
        case "server":
          flags.server = parsed.value;
          break;
        case "template":
          flags.template = parsed.value;
          break;
        case "name":
          flags.name = parsed.value;
          break;
        case "destination":
          flags.destination = parsed.value;
          break;
        case "shell":
          flags.shell = parsed.value;
          break;
        case "all":
          flags.all = true;
          break;
        case "preview":
          flags.preview = true;
          break;
        case "force":
          flags.force = true;
          break;
        case "format": {
          const format = parseFormat(parsed.value);
          if (!format) {
            errors.push(
              "Unsupported value for --format. Allowed values: text, json.",
            );
          } else {
            flags.format = format;
          }
          break;
        }
        case "verbose":
          flags.verbose = true;
          break;
        case "quiet":
          flags.quiet = true;
          break;
        case "no-color":
          flags.noColor = true;
          break;
        case "non-interactive":
          flags.nonInteractive = true;
          break;
        case "ci":
          flags.ci = true;
          break;
        case "help":
          flags.help = true;
          break;
        default:
          errors.push(`Unknown flag: --${parsed.name}`);
          break;
      }

      continue;
    }

    if (token.startsWith("-")) {
      errors.push(`Unsupported short flag: ${token}`);
      continue;
    }

    if (!command) {
      command = token;
      continue;
    }

    commandArgs.push(token);
  }

  if (flags.ci) {
    flags.nonInteractive = true;
  }

  if (flags.verbose && flags.quiet) {
    errors.push("--verbose and --quiet cannot be used together.");
  }

  if (flags.all && flags.target) {
    errors.push("--all and --target cannot be used together.");
  }

  return {
    command,
    commandArgs,
    flags,
    errors,
  };
}

function parseLongFlag(
  token: string,
  argv: readonly string[],
  index: number,
): {
  name: string;
  value: string | null;
  nextIndex: number;
  error: string | null;
} {
  const trimmed = token.slice(2);
  const separatorIndex = trimmed.indexOf("=");
  const hasInlineValue = separatorIndex >= 0;
  const name = hasInlineValue ? trimmed.slice(0, separatorIndex) : trimmed;
  const inlineValue = hasInlineValue ? trimmed.slice(separatorIndex + 1) : null;

  const takesValue =
    name === "project" ||
    name === "board-yaml" ||
    name === "sdk-root" ||
    name === "target" ||
    name === "target-kind" ||
    name === "server" ||
    name === "template" ||
    name === "name" ||
    name === "destination" ||
    name === "shell" ||
    name === "format";

  if (!takesValue) {
    return {
      name,
      value: null,
      nextIndex: index,
      error:
        inlineValue !== null ? `Flag --${name} does not accept a value.` : null,
    };
  }

  if (inlineValue !== null) {
    if (!inlineValue.trim()) {
      return {
        name,
        value: null,
        nextIndex: index,
        error: `Flag --${name} requires a non-empty value.`,
      };
    }

    return {
      name,
      value: inlineValue,
      nextIndex: index,
      error: null,
    };
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("-")) {
    return {
      name,
      value: null,
      nextIndex: index,
      error: `Flag --${name} requires a value.`,
    };
  }

  return {
    name,
    value: next,
    nextIndex: index + 1,
    error: null,
  };
}

function parseFormat(value: string | null): CliFormat | null {
  if (value === "text" || value === "json") {
    return value;
  }

  return null;
}
