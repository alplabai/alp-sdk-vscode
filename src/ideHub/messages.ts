// SPDX-License-Identifier: Apache-2.0

import type { SdkReadinessState } from "@alp-sdk/core/sdk/models";

// ---------------------------------------------------------------------------
// Shared state model (extension → webview)
// ---------------------------------------------------------------------------

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState | "unknown";
}

export interface SetupStatus {
  pythonAvailable: boolean;
  westAvailable: boolean;
}

export interface WorkspaceStatus {
  workspaceRoot: string | null;
  boardYamlExists: boolean;
}

export interface AlpIdeState {
  sdk: SdkStatus;
  setup: SetupStatus;
  workspace: WorkspaceStatus;
}

export function emptyAlpIdeState(): AlpIdeState {
  return {
    sdk: { activePath: null, version: null, readiness: "unknown" },
    setup: { pythonAvailable: false, westAvailable: false },
    workspace: { workspaceRoot: null, boardYamlExists: false },
  };
}

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

export interface StateUpdateMessage {
  type: "stateUpdate";
  state: AlpIdeState;
}

export type ExtToWebviewMessage = StateUpdateMessage;

// ---------------------------------------------------------------------------
// Webview → Extension messages
// ---------------------------------------------------------------------------

export interface ReadyMessage {
  type: "ready";
}

export interface RunCommandMessage {
  type: "runCommand";
  command: string;
}

export interface InstallSdkMessage {
  type: "installSdk";
  version: string;
}

export interface SwitchSdkMessage {
  type: "switchSdk";
  sdkPath: string;
}

export type WebviewToExtMessage =
  | ReadyMessage
  | RunCommandMessage
  | InstallSdkMessage
  | SwitchSdkMessage;
