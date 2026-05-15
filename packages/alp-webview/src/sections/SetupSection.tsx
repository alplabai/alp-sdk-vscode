import type { SetupStatus } from "../types";
import { postMessage } from "../vscode";

interface Props {
  setup: SetupStatus | null;
}

export function SetupSection({ setup }: Props) {
  const python = setup?.pythonAvailable ?? null;
  const west = setup?.westAvailable ?? null;

  const allOk = python === true && west === true;
  const loading = setup === null;

  return (
    <div className="section">
      <p className="section-title">Setup</p>
      {loading ? (
        <span className="no-sdk">Loading…</span>
      ) : (
        <>
          <div className="row">
            <span className="label">Python</span>
            <span className={`badge ${python ? "badge-ok" : "badge-err"}`}>
              {python ? "found" : "missing"}
            </span>
          </div>
          <div className="row">
            <span className="label">west</span>
            <span className={`badge ${west ? "badge-ok" : "badge-err"}`}>
              {west ? "found" : "missing"}
            </span>
          </div>
          {!allOk && (
            <div className="btn-row">
              <button
                className="action-btn primary"
                onClick={() =>
                  postMessage({ type: "runCommand", command: "alp.bootstrap" })
                }
              >
                Run Bootstrap
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
