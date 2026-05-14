// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { createDefaultBoardModel } from "../configurator/service";
import {
    collectRuntimeCapabilitiesFromCommands,
    createDebugWorkspaceContext,
} from "../debug/adapterCore";
import {
    DebugServerKind,
    DebugTargetKind,
    DoctorCheck,
    DoctorReport,
} from "../debug/models";
import { buildDoctorReport, serverChoicesForTarget } from "../debug/service";
import { executeLoaderPlanWithSpawn } from "../loader/adapterCore";
import { EmitMode } from "../loader/models";
import { ALL_EMIT_MODES, createLoaderPlan } from "../loader/service";
import { ProjectSettings } from "../project/models";
import { resolveProjectContext } from "../project/service";
import { executeValidatorPlanWithSpawn } from "../validation/adapterCore";
import { ValidationOutcome } from "../validation/models";
import {
    analyzeValidationResult,
    createValidatorPlan,
} from "../validation/service";
import { ModuleTemplateId, WizardTemplateId } from "../wizard/models";
import {
    createModuleScaffoldPlan,
    createWizardPlan,
    listModuleTemplates,
    listWizardTemplates,
} from "../wizard/service";
import {
    collectWizardFileChanges,
    writeWizardFiles,
} from "../wizard/vscodeAdapter";
import {
    CLI_EXIT_CODE,
    CliCommand,
    CliEnvelope,
    CliExecutionInput,
    CliExecutionResult,
    CliFormat,
    CliGlobalFlags,
    CliIssue,
    CliParseResult,
    ValidateCommandData,
    ValidateCommandResult,
} from "./models";

const KNOWN_COMMANDS: readonly CliCommand[] = [
  "validate",
  "generate",
  "init",
  "scaffold",
  "inspect",
  "trace",
  "doctor",
  "support-bundle",
  "debug-config",
];

const IMPLEMENTED_COMMANDS = new Set<CliCommand>([
  "validate",
  "generate",
  "init",
  "scaffold",
  "doctor",
]);

interface GenerateCommandData {
  schemaVersion: "1";
  targets: EmitMode[];
  written: string[];
  failed: EmitMode[];
}

interface DoctorCommandData {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  summary: DoctorReport["summary"];
  checks: DoctorCheck[];
  nextSteps: string[];
}

interface InitCommandData {
  schemaVersion: "1";
  templateId: WizardTemplateId;
  destination: string;
  preview: boolean;
  fileChanges: Array<{
    relativePath: string;
    kind: "new" | "update" | "unchanged";
  }>;
  written: string[];
  unchanged: string[];
}

interface ScaffoldCommandData {
  schemaVersion: "1";
  templateId: ModuleTemplateId;
  moduleName: string;
  normalizedModuleName: string;
  destination: string;
  preview: boolean;
  fileChanges: Array<{
    relativePath: string;
    kind: "new" | "update" | "unchanged";
  }>;
  written: string[];
  unchanged: string[];
}

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

export function executeCli(input: CliExecutionInput): CliExecutionResult {
  const parsed = parseCliArgs(input.argv);

  if (parsed.flags.help) {
    return createHelpResult(parsed.flags.format);
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
        "Use alp validate, alp generate, or alp doctor for the implemented baseline.",
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

  if (parsed.command === "validate") {
    return runValidateCommand(parsed.flags, input);
  }

  if (parsed.command === "generate") {
    return runGenerateCommand(parsed.flags, input);
  }

  if (parsed.command === "init") {
    return runInitCommand(parsed.flags, input);
  }

  if (parsed.command === "scaffold") {
    return runScaffoldCommand(parsed.flags, input);
  }

  return runDoctorCommand(parsed.flags, input);
}

function createHelpResult(format: CliFormat): CliExecutionResult {
  const commands = KNOWN_COMMANDS.join(", ");
  const textLines = [
    "ALP CLI",
    "Usage: alp <command> [options]",
    `Commands: ${commands}`,
    "Global flags: --project --board-yaml --sdk-root --format text|json --verbose --quiet --no-color --non-interactive --ci --help",
    "Generate flags: --target <emit-mode> --all",
    "Init flags: --template <id> --name <project-name> --destination <path> --preview --force",
    "Scaffold flags: --template <id> --name <module-name> --destination <path> --preview --force",
    "Doctor flags: --target-kind <zephyr-mcu|baremetal-mcu|yocto-userspace|native-host> --server <jlink|openocd|pyocd|gdbserver|none>",
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
        commands: [...KNOWN_COMMANDS],
      },
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

export function runValidateCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<ValidateCommandData> {
  try {
    const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
    const settings: ProjectSettings = {
      sdkPath: flags.sdkRoot ?? "",
      pythonPath: "",
      boardYamlPath: flags.boardYamlPath ?? "board.yaml",
      westCwd: "",
    };
    const context = resolveProjectContext(
      {
        workspaceFolders: [workspaceRoot],
        settings,
        platform: input.platform,
      },
      input.pathExists,
    );

    if (!context.boardYamlPath || !input.pathExists(context.boardYamlPath)) {
      return createValidationFailure(
        flags.format,
        context,
        "board-yaml-missing",
        "board.yaml path could not be resolved or the file does not exist.",
      );
    }

    if (!context.sdkRoot) {
      return createValidationFailure(
        flags.format,
        context,
        "sdk-root-unresolved",
        "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
      );
    }

    const plan = createValidatorPlan(context, context.boardYamlPath);
    const execution = executeValidatorPlanWithSpawn(
      context,
      plan,
      input.spawnSync,
    );
    const validation = analyzeValidationResult(execution);
    const commandResult: ValidateCommandResult = {
      context,
      validation,
      commandLine: plan.commandLine,
    };

    return formatValidateResult(commandResult, flags);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI validation failure.";
    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.internalFailure,
      textLines: ["validate: internal failure", message],
      envelope: createEnvelope(
        "validate",
        {
          root: null,
          boardYaml: null,
        },
        {
          schemaVersion: "1",
          outcome: "failed",
          issueCount: 1,
          commandLine: "",
          boardYamlPath: "",
        },
        [
          {
            code: "validate.internal-failure",
            severity: "error",
            message,
          },
        ],
        CLI_EXIT_CODE.internalFailure,
      ),
    };
  }
}

function runGenerateCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<GenerateCommandData> {
  try {
    const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
    const settings: ProjectSettings = {
      sdkPath: flags.sdkRoot ?? "",
      pythonPath: "",
      boardYamlPath: flags.boardYamlPath ?? "board.yaml",
      westCwd: "",
    };
    const context = resolveProjectContext(
      {
        workspaceFolders: [workspaceRoot],
        settings,
        platform: input.platform,
      },
      input.pathExists,
    );

    if (!context.boardYamlPath || !input.pathExists(context.boardYamlPath)) {
      return createFailureResult(
        "generate",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["generate: board.yaml path is unresolved or missing."],
        [
          {
            code: "generate.board-yaml-missing",
            severity: "error",
            message:
              "board.yaml path could not be resolved or the file does not exist.",
          },
        ],
        {
          schemaVersion: "1",
          targets: [],
          written: [],
          failed: [],
        },
      );
    }

    if (!context.sdkRoot) {
      return createFailureResult(
        "generate",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["generate: alp-sdk root is unresolved."],
        [
          {
            code: "generate.sdk-root-unresolved",
            severity: "error",
            message:
              "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
          },
        ],
        {
          schemaVersion: "1",
          targets: [],
          written: [],
          failed: [],
        },
      );
    }

    const targets = resolveGenerateTargets(flags.target, flags.all);
    const written: string[] = [];
    const failed: EmitMode[] = [];
    const issues: CliIssue[] = [];

    for (const emit of targets) {
      const plan = createLoaderPlan(context, emit);
      const execution = executeLoaderPlanWithSpawn(
        context.pythonBinary,
        plan,
        input.spawnSync,
      );
      if (execution.status === 0) {
        written.push(path.relative(workspaceRoot, plan.outputPath));
      } else {
        failed.push(emit);
        issues.push({
          code: "generate.emit-failed",
          severity: "error",
          message:
            execution.stderr.trim() ||
            `Generation failed for target '${emit}'.`,
        });
      }
    }

    const exitCode =
      failed.length === 0 ? CLI_EXIT_CODE.success : CLI_EXIT_CODE.writeFailure;

    const textLines: string[] = [];
    if (flags.format === "text") {
      if (failed.length === 0) {
        textLines.push(
          `generate: wrote ${written.length}/${targets.length} targets`,
        );
      } else {
        textLines.push(
          `generate: wrote ${written.length}/${targets.length}; failed: ${failed.join(", ")}`,
        );
      }

      if (flags.verbose) {
        for (const target of targets) {
          textLines.push(`target: ${target}`);
        }
      }
    }

    return {
      format: flags.format,
      exitCode,
      textLines,
      envelope: createEnvelope(
        "generate",
        {
          root: context.workspaceRoot,
          boardYaml: context.boardYamlPath,
        },
        {
          schemaVersion: "1",
          targets,
          written,
          failed,
        },
        issues,
        exitCode,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI generation failure.";
    return createFailureResult(
      "generate",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["generate: internal failure", message],
      [
        {
          code: "generate.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        targets: [],
        written: [],
        failed: [],
      },
    );
  }
}

function runInitCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<InitCommandData> {
  try {
    const templateId = resolveInitTemplate(flags.template);
    const defaultBoard = createDefaultBoardModel();

    const baseDestination = path.resolve(
      input.cwd,
      flags.destination ?? flags.projectPath ?? ".",
    );
    const projectRoot = flags.name
      ? path.join(baseDestination, flags.name)
      : baseDestination;

    const template = listWizardTemplates().find(
      (item) => item.id === templateId,
    );
    if (!template) {
      throw new Error(`Unsupported init template '${templateId}'.`);
    }

    const plan = createWizardPlan({
      templateId,
      somSku: defaultBoard.som.sku,
      carrierName: defaultBoard.carrier?.name ?? "E1M-EVK",
      os: defaultBoard.os,
      features: { ...template.defaultFeatures },
      libraries: [...template.defaultLibraries],
    });

    const fileChanges = collectWizardFileChanges(projectRoot, plan.files);
    const blockingUpdates = fileChanges.filter(
      (file) => file.kind === "update",
    );

    if (blockingUpdates.length > 0 && !flags.force) {
      return createFailureResult(
        "init",
        flags.format,
        CLI_EXIT_CODE.writeFailure,
        [
          `init: ${blockingUpdates.length} existing files would be updated. Use --force to overwrite.`,
        ],
        [
          {
            code: "init.overwrite-blocked",
            severity: "error",
            message:
              "Existing files would be overwritten. Re-run with --force to allow updates.",
          },
        ],
        {
          schemaVersion: "1",
          templateId,
          destination: projectRoot,
          preview: flags.preview,
          fileChanges,
          written: [],
          unchanged: [],
        },
      );
    }

    const writeResult = flags.preview
      ? { written: [], unchanged: [] }
      : writeWizardFiles(projectRoot, plan.files);

    const textLines: string[] = [];
    if (flags.preview) {
      textLines.push(
        `init: preview ${fileChanges.length} files in ${projectRoot}`,
      );
    } else {
      textLines.push(
        `init: wrote ${writeResult.written.length} files in ${projectRoot}`,
      );
      if (writeResult.unchanged.length > 0) {
        textLines.push(`init: unchanged ${writeResult.unchanged.length} files`);
      }
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: flags.format === "json" ? [] : textLines,
      envelope: createEnvelope(
        "init",
        {
          root: projectRoot,
          boardYaml: path.join(projectRoot, "board.yaml"),
        },
        {
          schemaVersion: "1",
          templateId,
          destination: projectRoot,
          preview: flags.preview,
          fileChanges,
          written: writeResult.written,
          unchanged: writeResult.unchanged,
        },
        [],
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI init failure.";
    return createFailureResult(
      "init",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["init: internal failure", message],
      [
        {
          code: "init.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        templateId: "minimal-app",
        destination: path.resolve(input.cwd),
        preview: flags.preview,
        fileChanges: [],
        written: [],
        unchanged: [],
      },
    );
  }
}

function runScaffoldCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<ScaffoldCommandData> {
  try {
    if (!flags.name || !flags.name.trim()) {
      return createFailureResult(
        "scaffold",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        ["scaffold: --name is required for module scaffolding."],
        [
          {
            code: "scaffold.name-required",
            severity: "error",
            message: "Module name is required. Provide --name <module-name>.",
          },
        ],
        {
          schemaVersion: "1",
          templateId: "sensor-driver",
          moduleName: "",
          normalizedModuleName: "",
          destination: path.resolve(input.cwd),
          preview: flags.preview,
          fileChanges: [],
          written: [],
          unchanged: [],
        },
      );
    }

    const templateId = resolveScaffoldTemplate(flags.template);
    const destination = path.resolve(
      input.cwd,
      flags.destination ?? flags.projectPath ?? ".",
    );
    const plan = createModuleScaffoldPlan({
      templateId,
      moduleName: flags.name,
      boardModel: null,
    });
    const fileChanges = collectWizardFileChanges(destination, plan.files);
    const blockingUpdates = fileChanges.filter(
      (file) => file.kind === "update",
    );

    if (blockingUpdates.length > 0 && !flags.force) {
      return createFailureResult(
        "scaffold",
        flags.format,
        CLI_EXIT_CODE.writeFailure,
        [
          `scaffold: ${blockingUpdates.length} existing files would be updated. Use --force to overwrite.`,
        ],
        [
          {
            code: "scaffold.overwrite-blocked",
            severity: "error",
            message:
              "Existing files would be overwritten. Re-run with --force to allow updates.",
          },
        ],
        {
          schemaVersion: "1",
          templateId,
          moduleName: plan.moduleName,
          normalizedModuleName: plan.normalizedModuleName,
          destination,
          preview: flags.preview,
          fileChanges,
          written: [],
          unchanged: [],
        },
      );
    }

    const writeResult = flags.preview
      ? { written: [], unchanged: [] }
      : writeWizardFiles(destination, plan.files);
    const textLines: string[] = [];

    if (flags.preview) {
      textLines.push(
        `scaffold: preview ${fileChanges.length} files in ${destination}`,
      );
    } else {
      textLines.push(
        `scaffold: wrote ${writeResult.written.length} files in ${destination}`,
      );
      if (writeResult.unchanged.length > 0) {
        textLines.push(
          `scaffold: unchanged ${writeResult.unchanged.length} files`,
        );
      }
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: flags.format === "json" ? [] : textLines,
      envelope: createEnvelope(
        "scaffold",
        {
          root: destination,
          boardYaml: path.join(destination, "board.yaml"),
        },
        {
          schemaVersion: "1",
          templateId,
          moduleName: plan.moduleName,
          normalizedModuleName: plan.normalizedModuleName,
          destination,
          preview: flags.preview,
          fileChanges,
          written: writeResult.written,
          unchanged: writeResult.unchanged,
        },
        [],
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI scaffold failure.";
    return createFailureResult(
      "scaffold",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["scaffold: internal failure", message],
      [
        {
          code: "scaffold.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        templateId: "sensor-driver",
        moduleName: flags.name ?? "",
        normalizedModuleName: "",
        destination: path.resolve(input.cwd),
        preview: flags.preview,
        fileChanges: [],
        written: [],
        unchanged: [],
      },
    );
  }
}

function runDoctorCommand(
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

function resolveGenerateTargets(
  target: string | null,
  all: boolean,
): EmitMode[] {
  if (all || !target) {
    return [...ALL_EMIT_MODES];
  }

  if ((ALL_EMIT_MODES as readonly string[]).includes(target)) {
    return [target as EmitMode];
  }

  throw new Error(`Unsupported generate target '${target}'.`);
}

function resolveScaffoldTemplate(rawTemplate: string | null): ModuleTemplateId {
  if (!rawTemplate) {
    return "sensor-driver";
  }

  const available = listModuleTemplates().map((template) => template.id);
  if ((available as readonly string[]).includes(rawTemplate)) {
    return rawTemplate as ModuleTemplateId;
  }

  throw new Error(
    `Unsupported --template '${rawTemplate}'. Allowed values: ${available.join(", ")}.`,
  );
}

function resolveInitTemplate(rawTemplate: string | null): WizardTemplateId {
  if (!rawTemplate) {
    return "minimal-app";
  }

  const available = listWizardTemplates().map((template) => template.id);
  if ((available as readonly string[]).includes(rawTemplate)) {
    return rawTemplate as WizardTemplateId;
  }

  throw new Error(
    `Unsupported --template '${rawTemplate}'. Allowed values: ${available.join(", ")}.`,
  );
}

function createValidationFailure(
  format: CliFormat,
  context: { workspaceRoot: string | null; boardYamlPath: string | null },
  issueCode: string,
  message: string,
): CliExecutionResult<ValidateCommandData> {
  return {
    format,
    exitCode: CLI_EXIT_CODE.validationFailure,
    textLines: ["validate: validation failure", message],
    envelope: createEnvelope(
      "validate",
      {
        root: context.workspaceRoot,
        boardYaml: context.boardYamlPath,
      },
      {
        schemaVersion: "1",
        outcome: "failed",
        issueCount: 1,
        commandLine: "",
        boardYamlPath: context.boardYamlPath ?? "",
      },
      [
        {
          code: `validate.${issueCode}`,
          severity: "error",
          message,
        },
      ],
      CLI_EXIT_CODE.validationFailure,
    ),
  };
}

function formatValidateResult(
  commandResult: ValidateCommandResult,
  flags: CliGlobalFlags,
): CliExecutionResult<ValidateCommandData> {
  const exitCode = validationOutcomeExitCode(commandResult.validation.outcome);
  const issues = toCliIssues(
    commandResult.validation.outcome,
    commandResult.validation.issues,
  );
  const payload: ValidateCommandData = {
    schemaVersion: "1",
    outcome: commandResult.validation.outcome,
    issueCount: issues.length,
    commandLine: commandResult.commandLine,
    boardYamlPath: commandResult.context.boardYamlPath ?? "",
  };

  const textLines = formatValidateText(commandResult, issues, flags);

  return {
    format: flags.format,
    exitCode,
    textLines,
    envelope: createEnvelope(
      "validate",
      {
        root: commandResult.context.workspaceRoot,
        boardYaml: commandResult.context.boardYamlPath,
      },
      payload,
      issues,
      exitCode,
    ),
  };
}

function toCliIssues(
  outcome: ValidationOutcome,
  issues: readonly {
    message: string;
    severity: "warning" | "error" | "suggestion";
  }[],
): CliIssue[] {
  const mapped = issues.map((issue) => ({
    code: `validate.${outcome}`,
    severity: issue.severity,
    message: issue.message,
  }));

  if (mapped.length > 0) {
    return mapped;
  }

  if (outcome === "clean") {
    return [];
  }

  return [
    {
      code: `validate.${outcome}`,
      severity: "error",
      message: `Validation ended with outcome '${outcome}'.`,
    },
  ];
}

function formatValidateText(
  commandResult: ValidateCommandResult,
  issues: readonly CliIssue[],
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines: string[] = [];
  if (commandResult.validation.outcome === "clean") {
    lines.push("validate: clean");
    if (!flags.quiet) {
      lines.push(`board.yaml: ${commandResult.context.boardYamlPath ?? ""}`);
    }
  } else {
    lines.push(`validate: ${commandResult.validation.outcome}`);
    if (!flags.quiet) {
      for (const issue of issues) {
        lines.push(`[${issue.severity}] ${issue.message}`);
      }
    }
  }

  if (flags.verbose) {
    lines.push(`cmd: ${commandResult.commandLine}`);
  }

  return lines;
}

function validationOutcomeExitCode(outcome: ValidationOutcome): number {
  if (outcome === "clean") {
    return CLI_EXIT_CODE.success;
  }

  if (
    outcome === "missing-preset" ||
    outcome === "schema-violation" ||
    outcome === "hardware-revision"
  ) {
    return CLI_EXIT_CODE.validationFailure;
  }

  return CLI_EXIT_CODE.runtimeFailure;
}

function createFailureResult<TData>(
  command: string,
  format: CliFormat,
  exitCode: number,
  textLines: string[],
  issues: CliIssue[],
  data: TData,
): CliExecutionResult<TData> {
  return {
    format,
    exitCode,
    textLines: format === "json" ? [] : textLines,
    envelope: createEnvelope(
      command,
      {
        root: null,
        boardYaml: null,
      },
      data,
      issues,
      exitCode,
    ),
  };
}

export function createEnvelope<TData>(
  command: string,
  project: { root: string | null; boardYaml: string | null },
  data: TData,
  issues: readonly CliIssue[],
  exitCode: number,
): CliEnvelope<TData> {
  return {
    command,
    ok: exitCode === CLI_EXIT_CODE.success,
    exitCode,
    project,
    data,
    issues: [...issues],
  };
}

function isKnownCommand(command: string): command is CliCommand {
  return (KNOWN_COMMANDS as readonly string[]).includes(command);
}
