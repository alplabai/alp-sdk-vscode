import {
    provideVSCodeDesignSystem,
    vsCodeButton,
    vsCodeDivider,
    vsCodeProgressRing,
    vsCodeTag,
} from "@vscode/webview-ui-toolkit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Register VS Code design system web components used across the panel.
provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeDivider(),
  vsCodeProgressRing(),
  vsCodeTag(),
);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
