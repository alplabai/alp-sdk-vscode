import { useEffect, useState } from "react";
import { ProjectSection } from "./sections/ProjectSection";
import { QuickActionsSection } from "./sections/QuickActionsSection";
import { SdkSection } from "./sections/SdkSection";
import { SetupSection } from "./sections/SetupSection";
import type { AlpIdeState, SdkRelease } from "./types";
import { onMessage, postMessage } from "./vscode";

export function App() {
  const [state, setState] = useState<AlpIdeState | null>(null);
  const [sdkReleases, setSdkReleases] = useState<SdkRelease[] | null>(null);
  const [sdkInstallLog, setSdkInstallLog] = useState<string | null>(null);
  const [sdkInstallActive, setSdkInstallActive] = useState(false);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "stateUpdate") {
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
    </div>
  );
}
