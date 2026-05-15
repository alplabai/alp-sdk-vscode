import { useState } from "react";
import { StatusChip } from "../components/StatusChip";
import type { ChipState, LocalSdkEntry, SdkRelease, SdkStatus } from "../types";
import { postMessage } from "../vscode";

interface Props {
  sdk: SdkStatus | null;
  releases: SdkRelease[] | null;
  installLog: string | null;
  installActive: boolean;
}

type SdkTab = "active" | "local" | "download";

function sdkChip(readiness: SdkStatus["readiness"]): ChipState {
  switch (readiness) {
    case "ready":
      return "ready";
    case "partial":
      return "setup-required";
    default:
      return "not-installed";
  }
}

function shortPath(p: string): string {
  const parts = p.split("/");
  if (parts.length > 5) return "~/…/" + parts.slice(-2).join("/");
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function localEntryChip(r: LocalSdkEntry["readiness"]): ChipState {
  return r === "ready" ? "ready" : r === "partial" ? "setup-required" : "not-installed";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function SdkSection({ sdk, releases, installLog, installActive }: Props) {
  const [tab, setTab] = useState<SdkTab>("active");
  const [selectedTag, setSelectedTag] = useState("");

  const localCount = sdk?.localEntries.length ?? 0;
  const latestTag = releases?.[0]?.tag ?? "";
  const installTarget = selectedTag || latestTag;

  if (!sdk) {
    return (
      <div className="section">
        <p className="section-title">SDK Manager</p>
        <div className="loading-row">
          <vscode-progress-ring />
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <p className="section-title">SDK Manager</p>

      {/* Tab bar */}
      <div className="sdk-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "active"}
          className={`sdk-tab${tab === "active" ? " active" : ""}`}
          onClick={() => setTab("active")}
        >
          Active
        </button>
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={`sdk-tab${tab === "local" ? " active" : ""}`}
          onClick={() => setTab("local")}
        >
          Local{localCount > 0 && <span className="sdk-tab-badge">{localCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === "download"}
          className={`sdk-tab${tab === "download" ? " active" : ""}`}
          onClick={() => setTab("download")}
        >
          Download
        </button>
      </div>

      {/* Active tab */}
      {tab === "active" && (
        <div className="sdk-tab-content">
          <div className="setup-row">
            <div className="setup-row-header">
              <span className="setup-row-label">
                {sdk.version ? `v${sdk.version}` : "Active SDK"}
              </span>
              <StatusChip state={sdk.activePath ? sdkChip(sdk.readiness) : "not-installed"} />
            </div>
            {sdk.activePath ? (
              <p className="setup-row-desc path-mono" title={sdk.activePath}>
                {shortPath(sdk.activePath)}
              </p>
            ) : (
              <p className="setup-row-desc">No active SDK configured.</p>
            )}
            <div className="setup-row-action">
              <vscode-button
                appearance="secondary"
                title="Browse for an SDK directory"
                onClick={() => postMessage({ type: "selectSdkPath" })}
              >
                Browse…
              </vscode-button>
            </div>
          </div>
        </div>
      )}

      {/* Local tab */}
      {tab === "local" && (
        <div className="sdk-tab-content">
          {localCount === 0 ? (
            <p className="setup-row-desc sdk-empty-state">
              No local SDK installations found. Use Download to get an SDK.
            </p>
          ) : (
            <div className="sdk-entry-list">
              {sdk.localEntries.map((entry) => (
                <div key={entry.path} className="sdk-entry">
                  <div className="sdk-entry-header">
                    <span className="sdk-entry-version">{entry.version ?? "unknown"}</span>
                    <StatusChip state={localEntryChip(entry.readiness)} />
                  </div>
                  <p className="setup-row-desc path-mono" title={entry.path}>
                    {shortPath(entry.path)}
                  </p>
                  {entry.path !== sdk.activePath && (
                    <div className="setup-row-action">
                      <vscode-button
                        appearance="secondary"
                        onClick={() =>
                          postMessage({ type: "switchSdk", sdkPath: entry.path })
                        }
                      >
                        Use This
                      </vscode-button>
                    </div>
                  )}
                  {entry.path === sdk.activePath && (
                    <p className="sdk-active-label">← active</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Download tab */}
      {tab === "download" && (
        <div className="sdk-tab-content">
          <p className="setup-row-desc">
            Download a versioned ALP SDK release to <span className="path-mono">~/.alp/sdk/</span>.
          </p>

          {/* Install progress */}
          {installActive && (
            <div className="sdk-install-status">
              <vscode-progress-ring />
              <span className="setup-row-desc">{installLog ?? "Installing…"}</span>
            </div>
          )}
          {!installActive && installLog && (
            <p
              className={`setup-row-desc sdk-install-result ${
                installLog.startsWith("Install failed") ? "text-err" : "text-ok"
              }`}
            >
              {installLog}
            </p>
          )}

          {!installActive && (
            <div className="sdk-download-controls">
              {releases === null ? (
                <vscode-button onClick={() => postMessage({ type: "requestSdkReleases" })}>
                  Load Releases
                </vscode-button>
              ) : releases.length === 0 ? (
                <p className="setup-row-desc">No releases found.</p>
              ) : (
                <>
                  <div className="sdk-release-picker">
                    <select
                      className="sdk-release-select"
                      value={installTarget}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      aria-label="Select SDK release version"
                    >
                      {releases.map((r) => (
                        <option key={r.tag} value={r.tag}>
                          {r.tag}
                          {r.publishedAt ? `  ·  ${formatDate(r.publishedAt)}` : ""}
                        </option>
                      ))}
                    </select>
                    <vscode-button
                      appearance="primary"
                      onClick={() =>
                        postMessage({ type: "requestSdkInstall", version: installTarget })
                      }
                    >
                      Install
                    </vscode-button>
                  </div>
                  {releases.find((r) => r.tag === installTarget)?.releaseNotesSummary && (
                    <p className="setup-row-desc sdk-release-notes">
                      {releases.find((r) => r.tag === installTarget)!.releaseNotesSummary}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
