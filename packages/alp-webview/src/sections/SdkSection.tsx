import type { SdkStatus } from "../types";
import { postMessage } from "../vscode";

interface Props {
  sdk: SdkStatus | null;
}

function readinessBadgeClass(r: SdkStatus["readiness"]): string {
  switch (r) {
    case "ready":
      return "badge-ok";
    case "incomplete":
      return "badge-warn";
    case "missing":
      return "badge-err";
    default:
      return "badge-neutral";
  }
}

function shortPath(p: string): string {
  // Abbreviate home directory
  const home = "~";
  // Remove leading slash segments beyond depth 4 for display
  const parts = p.split("/");
  if (parts.length > 5) {
    return home + "/…/" + parts.slice(-2).join("/");
  }
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function SdkSection({ sdk }: Props) {
  if (!sdk) {
    return (
      <div className="section">
        <p className="section-title">SDK</p>
        <span className="no-sdk">Loading…</span>
      </div>
    );
  }

  const hasActive = sdk.activePath !== null;

  return (
    <div className="section">
      <p className="section-title">SDK</p>

      {hasActive ? (
        <>
          <div className="row">
            <span className="label">Status</span>
            <span className={`badge ${readinessBadgeClass(sdk.readiness)}`}>
              {sdk.readiness}
            </span>
          </div>
          {sdk.version && (
            <div className="row">
              <span className="label">Version</span>
              <span className="value">{sdk.version}</span>
            </div>
          )}
          <div className="row">
            <span className="label">Path</span>
            <span className="value path-mono" title={sdk.activePath ?? ""}>
              {shortPath(sdk.activePath!)}
            </span>
          </div>
          <div className="btn-row">
            <button
              className="action-btn"
              onClick={() =>
                postMessage({ type: "runCommand", command: "alp.sdk.switch" })
              }
            >
              Switch SDK
            </button>
            <button
              className="action-btn"
              onClick={() =>
                postMessage({ type: "runCommand", command: "alp.sdk.install" })
              }
            >
              Install SDK
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="no-sdk">No active SDK configured.</span>
          <div className="btn-row">
            <button
              className="action-btn primary"
              onClick={() =>
                postMessage({ type: "runCommand", command: "alp.sdk.install" })
              }
            >
              Install SDK
            </button>
          </div>
        </>
      )}
    </div>
  );
}
