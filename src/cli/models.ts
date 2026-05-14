// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";
import { SpawnSyncLike } from "../validation/adapterCore";
import {
    ValidationOutcome,
    ValidationResult,
    ValidationSeverity,
} from "../validation/models";

export const CLI_EXIT_CODE = {
  success: 0,
  runtimeFailure: 1,
  validationFailure: 2,
  writeFailure: 3,
  doctorFailure: 4,
  internalFailure: 5,
} as const;

export type CliFormat = "text" | "json";

export type CliCommand =
  | "validate"
  | "generate"
  | "explain"
  | "presets"
  | "init"
  | "scaffold"
  | "diff"
  | "completion"
  | "inspect"
  | "trace"
  | "doctor"
  | "support-bundle"
  | "debug-config";

export type CliShell = "bash" | "zsh" | "fish";

export interface CliGlobalFlags {
  projectPath: string | null;
  boardYamlPath: string | null;
  sdkRoot: string | null;
  target: string | null;
  all: boolean;
  targetKind: string | null;
  server: string | null;
  template: string | null;
  name: string | null;
  destination: string | null;
  shell: string | null;
  preview: boolean;
  force: boolean;
  format: CliFormat;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
  nonInteractive: boolean;
  ci: boolean;
  help: boolean;
}

export interface CliParseResult {
  command: string | null;
  commandArgs: string[];
  flags: CliGlobalFlags;
  errors: string[];
}

export interface CliIssue {
  code: string;
  severity: ValidationSeverity | "info";
  message: string;
}

export interface CliEnvelope<TData> {
  command: string;
  ok: boolean;
  exitCode: number;
  project: {
    root: string | null;
    boardYaml: string | null;
  };
  data: TData;
  issues: CliIssue[];
}

export interface CliExecutionResult<TData = unknown> {
  format: CliFormat;
  exitCode: number;
  textLines: string[];
  envelope: CliEnvelope<TData>;
}

export interface CliExecutionInput {
  argv: readonly string[];
  cwd: string;
  platform: NodeJS.Platform;
  pathExists: (candidatePath: string) => boolean;
  spawnSync: SpawnSyncLike;
}

export interface ValidateCommandData {
  schemaVersion: "1";
  outcome: ValidationOutcome;
  issueCount: number;
  commandLine: string;
  boardYamlPath: string;
}

export interface ValidateCommandResult {
  context: ProjectContext;
  validation: ValidationResult;
  commandLine: string;
}
