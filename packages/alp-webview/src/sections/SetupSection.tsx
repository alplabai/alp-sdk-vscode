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
        <div className="loading-row">
          <vscode-progress-ring />
        </div>
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
              <vscode-button
                appearance="primary"
                onClick={() =>
                  postMessage({ type: "runCommand", command: "alp.bootstrap" })
                }
              >
                Run Bootstrap
              </vscode-button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
