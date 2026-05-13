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

export interface DebugInspectReport extends DebugWorkspaceContext {}

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

export interface DoctorSummary {
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
