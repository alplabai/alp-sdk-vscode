import { StatusChip } from "../components/StatusChip";
import type { ChipState, LocalSdkEntry, SdkRelease, SdkStatus } from "../types";
import { postMessage } from "../vscode";

interface Props {
  sdk: SdkStatus | null;
  releases: SdkRelease[] | null;
  installLog: string | null;
  installActive: boolean;
}

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

function readinessLabel(r: LocalSdkEntry["readiness"]): string {
  switch (r) {
    case "ready":
      return "Ready";
    case "partial":
      return "Partial";
    default:
      return "Missing";
  }
}

function localEntryChip(r: LocalSdkEntry["readiness"]): ChipState {
  return r === "ready"
    ? "ready"
    : r === "partial"
      ? "setup-required"
      : "not-installed";
}

export function SdkSection({
  sdk,
  releases,
  installLog,
  installActive,
}: Props) {
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

  const hasActive = sdk.activePath !== null;

  return (
    <div className="section">
      <p className="section-title">SDK Manager</p>
      <div className="setup-rows">
        {/* Active SDK row */}
        <div className="setup-row">
          <div className="setup-row-header">
            <span className="setup-row-label">Active SDK</span>
            {hasActive ? (
              <StatusChip state={sdkChip(sdk.readiness)} />
            ) : (
              <StatusChip state="not-installed" />
            )}
          </div>
          {hasActive ? (
            <>
              <p className="setup-row-desc">
                {sdk.version && <span>v{sdk.version}&nbsp;&nbsp;</span>}
                <span className="path-mono" title={sdk.activePath ?? ""}>
                  {shortPath(sdk.activePath!)}
                </span>
              </p>
              {sdk.readiness !== "ready" && sdk.readiness !== "partial"
                ? null
                : null}
            </>
          ) : (
            <p className="setup-row-desc">No active SDK configured.</p>
          )}
          <div className="setup-row-action">
            <div className="btn-row">
              <vscode-button
                appearance="secondary"
                onClick={() => postMessage({ type: "selectSdkPath" })}
              >
                Browse…
              </vscode-button>
            </div>
          </div>
        </div>

        {/* Local SDK candidates */}
        {sdk.localEntries.length > 0 && (
          <div className="setup-row">
            <div className="setup-row-header">
              <span className="setup-row-label">Local SDKs</span>
            </div>
            <div className="sdk-entry-list">
              {sdk.localEntries.map((entry) => (
                <div key={entry.path} className="sdk-entry">
                  <div className="sdk-entry-header">
                    <span className="sdk-entry-version">
                      {entry.version ?? "unknown"}
                    </span>
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
                          postMessage({
                            type: "switchSdk",
                            sdkPath: entry.path,
                          })
                        }
                      >
                        Use This
                      </vscode-button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Download SDK */}
        <div className="setup-row">
          <div className="setup-row-header">
            <span className="setup-row-label">Download SDK</span>
          </div>
          <p className="setup-row-desc">
            Download a versioned ALP SDK release to ~/.alp/sdk/.
          </p>

          {installActive ? (
            <div className="sdk-install-status">
              <vscode-progress-ring />
              <span className="setup-row-desc">
                {installLog ?? "Installing…"}
              </span>
            </div>
          ) : installLog && !installActive ? (
            <p
              className={`setup-row-desc ${installLog.startsWith("Install failed") ? "text-err" : "text-ok"}`}
            >
              {installLog}
            </p>
          ) : null}

          {!installActive && (
            <div className="setup-row-action">
              {releases === null ? (
                <vscode-button
                  onClick={() => postMessage({ type: "requestSdkReleases" })}
                >
                  Load Releases
                </vscode-button>
              ) : releases.length === 0 ? (
                <p className="setup-row-desc">No releases found.</p>
              ) : (
                <div className="sdk-release-list">
                  {releases.slice(0, 5).map((r) => (
                    <div key={r.tag} className="sdk-release-row">
                      <span className="sdk-release-tag">{r.tag}</span>
                      <vscode-button
                        appearance="secondary"
                        onClick={() =>
                          postMessage({
                            type: "requestSdkInstall",
                            version: r.tag,
                          })
                        }
                      >
                        Install
                      </vscode-button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
