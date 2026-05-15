import { useEffect, useState } from "react";
import type { AlpIdeState } from "./types";
import { onMessage, postMessage } from "./vscode";
import { SetupSection } from "./sections/SetupSection";
import { SdkSection } from "./sections/SdkSection";
import { QuickActionsSection } from "./sections/QuickActionsSection";

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
            <SetupSection setup={state?.setup ?? null} />
            <SdkSection sdk={state?.sdk ?? null} />
            <QuickActionsSection />
        </div>
    );
}
