// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";

export type DebugTargetKind =
  | "zephyr-mcu"
  | "baremetal-mcu"
  | "yocto-userspace"
  | "native-host";

export type DebugServerKind =
  | "jlink"
  | "openocd"
  | "pyocd"
  | "gdbserver"
  | "none";

export type DoctorStatus = "pass" | "warn" | "fail";

export type PreflightStatus = "pass" | "warn" | "fail";

export interface DebugTargetChoice {
  label: string;
  description: string;
  targetKind: DebugTargetKind;
}

export interface DebugServerChoice {
  label: string;
  server: DebugServerKind;
}

export interface DebuggerExtensionsState {
  cortexDebug: boolean;
  cppTools: boolean;
  codeLLDB: boolean;
}

export interface DebugWorkspaceContext extends ProjectContext {
  generatedAt: string;
  boardYamlExists: boolean;
  debuggerExtensions: DebuggerExtensionsState;
}

export type DebugValueSource =
  | "workspace"
  | "setting"
  | "default"
  | "runtime"
  | "derived"
  | "unresolved";

export interface DebugResolvedValue {
  key: string;
  value: unknown;
  source: DebugValueSource;
  detail: string;
}

export interface DebugInspectReport {
  schemaVersion: "1";
  generatedAt: string;
  context: DebugWorkspaceContext;
  resolvedValues: DebugResolvedValue[];
}

export type DebugTraceOutcome = "planned" | "written" | "failed";

export interface DebugGenerationTraceDecision {
  key: string;
  outcome: DebugTraceOutcome;
  detail: string;
  outputPath?: string;
}

export interface DebugGenerationTraceReport {
  schemaVersion: "1";
  generatedAt: string;
  workflow: string;
  decisions: DebugGenerationTraceDecision[];
}

export interface DebugRuntimeCapabilities {
  pythonAvailable: boolean;
  jlinkExecutable: string | null;
  openOcdExecutable: string | null;
  pyocdExecutable: string | null;
  gdbExecutable: string | null;
  lldbExecutable: string | null;
}

export interface DebugDoctorRequest {
  targetKind: DebugTargetKind;
  server: DebugServerKind;
}

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface PreflightCheck {
  name: string;
  status: PreflightStatus;
  detail: string;
  fix?: string;
}

export interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
}

export interface PreflightSummary {
  pass: number;
  warn: number;
  fail: number;
}

export interface DoctorReport {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  summary: DoctorSummary;
  checks: DoctorCheck[];
  nextSteps: string[];
}

export interface DebugPreflightReport {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  profileId: string;
  summary: PreflightSummary;
  checks: PreflightCheck[];
  nextSteps: string[];
  canLaunch: boolean;
}

export interface DebugSupportBundlePayload {
  schemaVersion: "1";
  generatedAt: string;
  inspect: DebugInspectReport;
  preflight?: DebugPreflightReport;
  trace?: DebugGenerationTraceReport;
  doctor?: DoctorReport;
  notes: string[];
}

export type DebugAdapterKind = "cortex-debug" | "cppdbg" | "codelldb";

export type DebugProfileOs = "zephyr" | "baremetal" | "yocto" | "host";

export interface DebugSetupCommand {
  text: string;
}

export interface DebugProfile {
  id: string;
  name: string;
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  os: DebugProfileOs;
  executablePath: string;
  cwd: string;
  preLaunchTask?: string;
  device?: string;
  interface?: "swd" | "jtag";
  svdFile?: string;
  openOcdConfigFiles?: string[];
  targetId?: string;
  miMode?: "gdb";
  miDebuggerPath?: string;
  miDebuggerServerAddress?: string;
  setupCommands?: DebugSetupCommand[];
}

export type LaunchConfigurationDraft = Record<string, unknown>;

export interface DebugLaunchDocument {
  version: string;
  configurations: LaunchConfigurationDraft[];
}

export interface DebugLaunchPreview {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  notes: string[];
  launch: DebugLaunchDocument;
}
