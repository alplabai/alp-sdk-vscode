// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";

export type EmitMode =
  | "zephyr-conf"
  | "cmake-args"
  | "yocto-conf"
  | "dts-overlay";

export type LoaderWorkspaceContext = ProjectContext;

export interface ScriptPlan {
  scriptPath: string;
  args: string[];
  commandLine: string;
}

export interface LoaderPlan extends ScriptPlan {
  emit: EmitMode;
  outputPath: string;
}

export interface ScriptExecutionResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface LoaderBatchEntry {
  emit: EmitMode;
  outputPath: string;
  exists: boolean;
  size: number;
}

export interface LoaderBatchSummary {
  written: string[];
  failed: EmitMode[];
}
