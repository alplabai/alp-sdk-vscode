// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "@alp-sdk/core/project/models";
import {
  MkdirP,
  PathExists,
  Readdir,
  ReadFile,
  SdkHttpFetch,
  SdkInstallAdapter,
  WriteFile,
} from "@alp-sdk/core/sdk/adapterCore";
import { SdkReadinessReport, SdkRelease } from "@alp-sdk/core/sdk/models";
import { SpawnSyncLike } from "@alp-sdk/core/validation/adapterCore";
import {
  ValidationOutcome,
  ValidationResult,
  ValidationSeverity,
} from "@alp-sdk/core/validation/models";

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
  | "debug-config"
  | "sdk";

export type CliShell = "bash" | "zsh" | "fish";

export interface CliGlobalFlags {
  projectPath: string | null;
  boardYamlPath: string | null;
  sdkRoot: string | null;
  inspectPath: string | null;
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
  showOrigin: boolean;
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
  pathExists: PathExists;
  spawnSync: SpawnSyncLike;
  // Optional adapters — required by sdk commands, unused by other commands.
  readFile?: ReadFile;
  writeFile?: WriteFile;
  mkdirP?: MkdirP;
  readdir?: Readdir;
  httpFetch?: SdkHttpFetch;
  sdkInstall?: SdkInstallAdapter;
}

// ---------------------------------------------------------------------------
// SDK command data types
// ---------------------------------------------------------------------------

export type SdkSubcommand = "list" | "install" | "current" | "switch";

export interface SdkListData {
  subcommand: "list";
  releases: SdkRelease[];
}

export interface SdkInstallData {
  subcommand: "install";
  version: string;
  sdkPath: string;
  readiness: SdkReadinessReport;
}

export interface SdkCurrentData {
  subcommand: "current";
  sdkPath: string | null;
  readiness: SdkReadinessReport | null;
}

export interface SdkSwitchData {
  subcommand: "switch";
  sdkPath: string;
  version: string | null;
}

export type SdkCommandData =
  | SdkListData
  | SdkInstallData
  | SdkCurrentData
  | SdkSwitchData;

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
