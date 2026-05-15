// Types mirrored from src/ideHub/messages.ts — kept in sync manually.
// The webview is a separate build; we do not share source with the extension.

export type SdkReadinessState = "ready" | "missing" | "incomplete" | "unknown";

/** Visual state for a readiness status chip. */
export type ChipState = "ready" | "setup-required" | "not-installed" | "not-updated";

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState;
}

export interface SetupStatus {
  pythonAvailable: boolean;
  westAvailable: boolean;
  workspaceOpen: boolean;
}

export interface AlpIdeState {
  sdk: SdkStatus;
  setup: SetupStatus;
}

// Extension → Webview
export interface StateUpdateMessage {
  type: "stateUpdate";
  state: AlpIdeState;
}
export type ExtToWebviewMessage = StateUpdateMessage;

// Webview → Extension
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
