// Types mirrored from src/ideHub/messages.ts — kept in sync manually.
// The webview is a separate build; we do not share source with the extension.

/** Must match PROTOCOL_VERSION in src/ideHub/messages.ts. */
export const PROTOCOL_VERSION = 1 as const;

export type SdkReadinessState = "ready" | "partial" | "missing" | "unknown";

/** Visual state for a readiness status chip. */
export type ChipState =
  | "ready"
  | "setup-required"
  | "not-installed"
  | "not-updated";

export interface LocalSdkEntry {
  path: string;
  version: string | null;
  readiness: SdkReadinessState;
  issues: string[];
}

export interface SdkRelease {
  tag: string;
  publishedAt: string;
  tarballUrl: string;
  releaseNotesSummary: string;
}

export interface SdkStatus {
  activePath: string | null;
  version: string | null;
  readiness: SdkReadinessState;
  localEntries: LocalSdkEntry[];
}

export interface ToolVersions {
  python: string | null;
  west: string | null;
  cmake: string | null;
  ninja: string | null;
}

export interface SetupStatus {
  pythonAvailable: boolean;
  westAvailable: boolean;
  /** ISO timestamp of the last time the user triggered bootstrap. Null if never. */
  lastBootstrapAt: string | null;
  /** Raw version strings for each build tool, null when not found. */
  toolVersions: ToolVersions;
}

export interface WorkspaceStatus {
  workspaceRoot: string | null;
  boardYamlExists: boolean;
  /** True when a `.west` directory exists at the workspace root. */
  westInitialized: boolean;
}

export interface AlpIdeState {
  sdk: SdkStatus;
  setup: SetupStatus;
  workspace: WorkspaceStatus;
}

// Extension → Webview
export interface StateUpdateMessage {
  type: "stateUpdate";
  _v: number;
  state: AlpIdeState;
}
export interface SdkReleasesLoadedMessage {
  type: "sdkReleasesLoaded";
  releases: SdkRelease[];
}
export interface SdkInstallProgressMessage {
  type: "sdkInstallProgress";
  log: string;
  done: boolean;
  success?: boolean;
}
export type ExtToWebviewMessage =
  | StateUpdateMessage
  | SdkReleasesLoadedMessage
  | SdkInstallProgressMessage;

// Webview → Extension
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
export interface OpenUrlMessage {
  type: "openUrl";
  url: string;
  label: string;
}
export type WebviewToExtMessage =
  | ReadyMessage
  | RunCommandMessage
  | SelectSdkPathMessage
  | RequestSdkReleasesMessage
  | RequestSdkInstallMessage
  | SwitchSdkMessage
  | OpenUrlMessage;
