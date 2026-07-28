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
  /**
   * `process.platform` of the host the extension host runs on, supplied by
   * `src/debug/vscodeAdapter.ts`. The debug service is a PURE module and may
   * not read `process` itself, so the host OS arrives here alongside the other
   * probed host facts rather than being sniffed in the service.
   *
   * Optional, and absent means "assume not Windows": every caller and fixture
   * that predates this field keeps compiling and keeps its old verdict, and a
   * platform-blocking check that fired on a *missing* value would block Linux
   * and macOS — the two hosts on which the target actually works.
   */
  hostPlatform?: string;
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

/**
 * VS Code **debug type** strings — the `type` field of a launch configuration,
 * as registered by each adapter extension in its own `contributes.debuggers`.
 * These are adapter ids, NOT extension names or ids:
 *
 * - `cortex-debug` — marus25.cortex-debug
 * - `cppdbg`       — ms-vscode.cpptools
 * - `lldb`         — vadimcn.vscode-lldb (the extension is *named* CodeLLDB;
 *                    it registers the type `lldb`, and `codelldb` is not a
 *                    debug type at all)
 */
export type DebugAdapterKind = "cortex-debug" | "cppdbg" | "lldb";

export type DebugProfileOs = "zephyr" | "baremetal" | "yocto" | "host";

/**
 * The session the extension is REPORTING ON, not a launch configuration.
 *
 * It carries only what `buildDebugPreflightReport` needs to grade host
 * readiness. It used to also carry the cortex-debug/cppdbg configuration
 * values — `device`, `interface`, `svdFile`, `openOcdConfigFiles`, `targetId`,
 * `miMode`, `miDebuggerPath`, `miDebuggerServerAddress`, `setupCommands` — and
 * `createDebugProfile` could only ever fill them with `<resolved-…>`
 * placeholder literals, because the values come from the build's
 * `runners.yaml` and only `tan debug-config` reads that (#387). Grading those
 * literals made a fully resolved profile report unlaunchable (#339), so they
 * are gone. tan owns the configuration; the written configuration is what gets
 * graded, by `foldLaunchConfigPlaceholders`.
 *
 * Do not add a field here to describe something that ends up IN launch.json —
 * that is tan's output and re-deriving it is the defect, not the fix.
 */
export interface DebugProfile {
  id: string;
  name: string;
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  os: DebugProfileOs;
  executablePath: string;
  cwd: string;
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
