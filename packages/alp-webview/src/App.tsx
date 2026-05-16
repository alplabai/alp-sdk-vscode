import { useEffect, useState } from "react";
import { FooterView } from "./features/footer";
import { ProjectView } from "./features/project";
import { QuickActionsView } from "./features/quick-actions";
import { SdkView } from "./features/sdk";
import { SetupView } from "./features/setup";
import { WestWorkspacesView } from "./features/west-workspaces";
import layout from "./shared/ui/layout.module.css";
import { BuildBar } from "./shared/ui/BuildBar";
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
      <div className={layout.section}>
        <p className={layout.sectionTitle}>ALP IDE</p>
        <p className={layout.setupRowDesc}>
          The extension was updated. Please reload the window to refresh the
          panel.
        </p>
        <div className={layout.setupRowAction}>
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
      <BuildBar state={state} />
      <SetupView state={state} />
      <vscode-divider role="separator" />
      <WestWorkspacesView state={state} />
      <vscode-divider role="separator" />
      <ProjectView state={state} />
      <vscode-divider role="separator" />
      <SdkView
        sdk={state?.sdk ?? null}
        releases={sdkReleases}
        installLog={sdkInstallLog}
        installActive={sdkInstallActive}
      />
      <vscode-divider role="separator" />
      <QuickActionsView />
      <FooterView />
    </div>
  );
}
