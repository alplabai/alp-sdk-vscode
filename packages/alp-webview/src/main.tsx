import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML =
    '<p class="alp-boot-error">Alp IDE: #root element missing</p>';
} else {
  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    // Built with DOM methods, not innerHTML: `err` is arbitrary text and
    // interpolating it into markup makes the crash handler an injection point.
    // textContent renders it literally.
    const box = document.createElement("div");
    box.className = "alp-boot-error-detail";
    const heading = document.createElement("b");
    heading.textContent = "Alp IDE render error:";
    box.append(heading, document.createElement("br"));
    box.append(String(err));
    root.textContent = "";
    root.append(box);
  }
}
