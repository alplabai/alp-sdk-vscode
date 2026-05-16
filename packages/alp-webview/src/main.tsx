import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML =
    '<p style="color:#f88;padding:8px">ALP IDE: #root element missing</p>';
} else {
  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    root.innerHTML = `<div style="padding:12px;color:#f88;font-family:monospace;font-size:12px">
      <b>ALP IDE render error:</b><br>${String(err)}
    </div>`;
  }
}
