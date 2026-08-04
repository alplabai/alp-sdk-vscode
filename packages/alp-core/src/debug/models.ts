// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";
import type { DoctorEnvelopeData } from "../cli/doctorEnvelope";

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

export interface PreflightCheck {
  name: string;
  status: PreflightStatus;
  detail: string;
  fix?: string;
}

export interface PreflightSummary {
  pass: number;
  warn: number;
  fail: number;
}

/**
 * The doctor half of a debug report/bundle, sourced from a `tan doctor` spawn
 * rather than a TypeScript re-implementation (#376 deleted `buildDoctorReport`
 * and its own `DoctorReport`/`DoctorCheck`/`DoctorStatus`/`DoctorSummary`
 * family, which this replaces).
 *
 * - `"envelope"` carries tan's own `checks[]`/`summary` VERBATIM
 *   (`DoctorEnvelopeData`, `../cli/doctorEnvelope`) — no allowlist, no status
 *   filter, no recomputed counts. An `unknown` status renders as `unknown`
 *   and is excluded from `summary.pass/warn/fail` exactly the way tan's own
 *   arithmetic excludes it; nothing here may recount.
 * - `"unavailable"` is the ONE thing a consumer is still allowed to say on its
 *   own — that `tan` itself could not be resolved or run — carrying the
 *   resolver's own message verbatim rather than falling back to a second,
 *   in-process doctor.
 */
export type DebugDoctorSection =
  | { kind: "envelope"; data: DoctorEnvelopeData }
  | { kind: "unavailable"; error: string };

/**
 * WHICH configuration a preflight report's `canLaunch` graded (#339).
 *
 * - `"none"` — none was read, so `canLaunch` is host readiness alone.
 * - `"launchJson"` — the entry in the customer's `.vscode/launch.json`, found
 *   by the `name` tan reports. That file is what F5 launches, so this is the
 *   verdict that answers the question the customer asked.
 * - `"cliEnvelope"` — tan's own `data.configuration`, which is the DRAFT it
 *   composed, not necessarily what landed. tan MERGES, and a value the
 *   customer hand-filled survives the merge while the draft still carries the
 *   placeholder. So this source can name a key that is fine in the file, and
 *   the fold's verdict is a worst case rather than the file's own.
 */
export type DebugConfigurationGrade = "none" | "launchJson" | "cliEnvelope";

export interface DebugPreflightReport {
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  profileId: string;
  summary: PreflightSummary;
  checks: PreflightCheck[];
  nextSteps: string[];
  canLaunch: boolean;
  /**
   * Which launch configuration's OWN values were graded in reaching `canLaunch`
   * (#339) — see `DebugConfigurationGrade`.
   *
   * `buildDebugPreflightReport` grades host readiness and nothing else, so it
   * sets `"none"`; `foldLaunchConfigPlaceholders` records what its caller
   * graded, and only `writeLaunchProfile` has a configuration to fold. The
   * three diagnostic surfaces — `Alp: Debug preflight`, the troubleshooting
   * panel and the support bundle — never do, so their `canLaunch: true` means
   * "the host is ready", NOT "this file can launch". Read on its own it would
   * send the reader of a support bundle, sent precisely because a session
   * already failed, looking away from the placeholder that killed it.
   *
   * It has three values rather than two because a failed read must not pass
   * for a clean one. When `.vscode/launch.json` cannot be read, does not parse,
   * or holds no entry under tan's name, the fold still runs — against the CLI
   * envelope, the pre-#403 behaviour — and `"cliEnvelope"` is what says the
   * verdict came from the draft rather than from the file.
   */
  configurationGraded: DebugConfigurationGrade;
}

export interface DebugSupportBundlePayload {
  schemaVersion: "1";
  generatedAt: string;
  inspect: DebugInspectReport;
  preflight?: DebugPreflightReport;
  trace?: DebugGenerationTraceReport;
  doctor?: DebugDoctorSection;
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

/**
 * The session the extension is REPORTING ON, not a launch configuration.
 *
 * It carries only what `buildDebugPreflightReport` needs to grade host
 * readiness. Nine cortex-debug/cppdbg configuration fields used to ride here
 * too — `device`, `targetId`, `openOcdConfigFiles`, `svdFile`, `interface`,
 * `miMode`, `miDebuggerPath`, `miDebuggerServerAddress`, `setupCommands` —
 * and every one of them was a CONSTANT of `(targetKind, server)`:
 * `createDebugProfile` invented them, no project input reached them, and a
 * customer's actual values live in the build's `runners.yaml`, which only
 * `tan debug-config` reads (#387). Five were `<resolved-…>` literals
 * (`"<resolved-device>"`, `"<resolved-target-id>"`,
 * `"<resolved-openocd-board-cfg>"`, `"<resolved-svd>"`, `"<resolved-gdb>"`);
 * `miDebuggerServerAddress` was `"<host>:<port>"`, a placeholder but NOT a
 * `<resolved-…>` one — the distinction `isConcrete` in src/debug/service.ts
 * exists to record; and `interface: "swd"`, `miMode: "gdb"` and
 * `setupCommands: [{ text: "-enable-pretty-printing" }]` were concrete values
 * that no code in `src/`, `packages/` or `test/` ever read. The other six were
 * read only by the preflight checks that graded them, so a placeholder check
 * failed for every project on earth and a fully resolved launch.json reported
 * unlaunchable (#339). All nine are gone. tan owns the configuration; the
 * `launch.json` entry it merged into is what gets graded, by
 * `foldLaunchConfigPlaceholders` over `gradeWrittenLaunchConfig`.
 *
 * `cwd`, `name` and `os` went with them for the same reason. `cwd` was
 * `"${workspaceFolder}"`; `name` was `Alp: Zephyr Debug (J-Link)` and its
 * siblings — a launch.json key, and a constant of `(targetKind, server)` like
 * the nine above, `serverLabel(server)` spelling the suffix on the MCU
 * targets. By tan 0.4.0 it had ALREADY DRIFTED from the `ALP: …` merge key tan
 * writes, which is the whole reason the orphan rescue in src/debug/service.ts
 * exists. It reads the two spellings off the customer's own file and off
 * `tan debug-config --preview`, never off a profile. `os` was a second name
 * for `targetKind`: `"zephyr" | "baremetal" | "yocto" | "host"`, one value per
 * target class, derived from nothing else. None of the three had a reader in
 * `src/`, `packages/` or
 * `test/`.
 *
 * A field belongs here only when the extension itself must READ it to grade a
 * host fact. `executablePath` qualifies — `createExecutableCheck` stats the
 * ELF, which is a fact about this machine. A value the extension only wants to
 * SEE in launch.json does not: that is tan's output, and re-deriving it is the
 * defect, not the fix.
 */
export interface DebugProfile {
  id: string;
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  executablePath: string;
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
