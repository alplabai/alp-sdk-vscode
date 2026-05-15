import { useEffect, useState } from "react";
import { ProjectSection } from "./sections/ProjectSection";
import { QuickActionsSection } from "./sections/QuickActionsSection";
import { SdkSection } from "./sections/SdkSection";
import { SetupSection } from "./sections/SetupSection";
import type { AlpIdeState } from "./types";
import { onMessage, postMessage } from "./vscode";

export function App() {
  const [state, setState] = useState<AlpIdeState | null>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "stateUpdate") {
        setState(msg.state);
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
      <SdkSection sdk={state?.sdk ?? null} />
      <vscode-divider role="separator" />
      <QuickActionsSection />
    </div>
  );
}
