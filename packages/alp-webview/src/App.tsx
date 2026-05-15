import { useEffect, useState } from "react";
import { FooterSection } from "./sections/FooterSection";
import { ProjectSection } from "./sections/ProjectSection";
import { QuickActionsSection } from "./sections/QuickActionsSection";
import { SdkSection } from "./sections/SdkSection";
import { SetupSection } from "./sections/SetupSection";
import { PROTOCOL_VERSION, type AlpIdeState, type SdkRelease } from "./types";
import { onMessage, postMessage } from "./vscode";

export function App() {
  const [state, setState] = useState<AlpIdeState | null>(null);
  const [sdkReleases, setSdkReleases] = useState<SdkRelease[] | null>(null);
  const [sdkInstallLog, setSdkInstallLog] = useState<string | null>(null);
  const [sdkInstallActive, setSdkInstallActive] = useState(false);
  const [protocolMismatch, setProtocolMismatch] = useState(false);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "stateUpdate") {
        if (msg._v !== PROTOCOL_VERSION) {
          setProtocolMismatch(true);
          return;
        }
        setState(msg.state);
      } else if (msg.type === "sdkReleasesLoaded") {
        setSdkReleases(msg.releases);
      } else if (msg.type === "sdkInstallProgress") {
        setSdkInstallLog(msg.log);
        if (msg.done) {
          setSdkInstallActive(false);
          if (msg.success) {
            // Clear log after a short delay on success
            setTimeout(() => setSdkInstallLog(null), 4000);
          }
        } else {
          setSdkInstallActive(true);
        }
      }
    });
    // Tell the extension we are ready
    postMessage({ type: "ready" });
    return unsubscribe;
  }, []);

  if (protocolMismatch) {
    return (
      <div className="section">
        <p className="section-title">ALP IDE</p>
        <p className="setup-row-desc">
          The extension was updated. Please reload the window to refresh the
          panel.
        </p>
        <div className="setup-row-action">
          <vscode-button
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "workbench.action.reloadWindow",
              })
            }
          >
            Reload Window
          </vscode-button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SetupSection state={state} />
      <vscode-divider role="separator" />
      <ProjectSection state={state} />
      <vscode-divider role="separator" />
      <SdkSection
        sdk={state?.sdk ?? null}
        releases={sdkReleases}
        installLog={sdkInstallLog}
        installActive={sdkInstallActive}
      />
      <vscode-divider role="separator" />
      <QuickActionsSection />
      <FooterSection />
    </div>
  );
}
