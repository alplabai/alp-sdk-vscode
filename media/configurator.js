// SPDX-License-Identifier: Apache-2.0
// UI-2a stub: the shell renders; the section renderer lands in UI-2b.
(function () {
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "render") {
      const main = document.getElementById("alp-main");
      if (main) main.textContent = msg.sdkConnected
        ? `Loaded ${msg.boardPath}`
        : "Connect your alp-sdk (set alpSdk.path) to configure.";
      const v = document.getElementById("alp-validation");
      if (v) v.textContent = (msg.viewModel.validation.errors.length === 0)
        ? "✓ Valid"
        : `${msg.viewModel.validation.errors.length} error(s)`;
    }
  });
  const save = document.getElementById("alp-save");
  if (save) save.addEventListener("click", () => vscode.postMessage({ type: "save" }));
  const reload = document.getElementById("alp-reload");
  if (reload) reload.addEventListener("click", () => vscode.postMessage({ type: "reload" }));
})();
