// SPDX-License-Identifier: Apache-2.0

import type {
    LocalSdkEntry,
    SdkReadinessState,
    SdkRelease,
} from "@alp-sdk/core/sdk/models";

// Re-export so callers only need this module.
export type { LocalSdkEntry, SdkRelease };

// ---------------------------------------------------------------------------
// Shared state model (extension → webview)
// ---------------------------------------------------------------------------

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState | "unknown";
  /** Locally discovered SDK installations, sorted by version descending. */
  localEntries: LocalSdkEntry[];
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
    sdk: {
      activePath: null,
      version: null,
      readiness: "unknown",
      localEntries: [],
    },
    setup: { pythonAvailable: false, westAvailable: false },
    workspace: { workspaceRoot: null, boardYamlExists: false },
  };
}

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

/** Increment whenever the message protocol changes in a breaking way. */
export const PROTOCOL_VERSION = 1 as const;

export interface StateUpdateMessage {
  type: "stateUpdate";
  /** Protocol version — webview shows a reload prompt on mismatch. */
  _v: typeof PROTOCOL_VERSION;
  state: AlpIdeState;
}

export interface SdkReleasesLoadedMessage {
  type: "sdkReleasesLoaded";
  releases: SdkRelease[];
}

export interface SdkInstallProgressMessage {
  type: "sdkInstallProgress";
  /** Human-readable status line. */
  log: string;
  done: boolean;
  success?: boolean;
}

export type ExtToWebviewMessage =
  | StateUpdateMessage
  | SdkReleasesLoadedMessage
  | SdkInstallProgressMessage;

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

export interface SelectSdkPathMessage {
  type: "selectSdkPath";
}

export interface RequestSdkReleasesMessage {
  type: "requestSdkReleases";
}

export interface RequestSdkInstallMessage {
  type: "requestSdkInstall";
  version: string;
}

export interface SwitchSdkMessage {
  type: "switchSdk";
  sdkPath: string;
}

export type WebviewToExtMessage =
  | ReadyMessage
  | RunCommandMessage
  | SelectSdkPathMessage
  | RequestSdkReleasesMessage
  | RequestSdkInstallMessage
  | SwitchSdkMessage;
