// SPDX-License-Identifier: Apache-2.0
(function () {
  const vscode = acquireVsCodeApi();

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "report") return;
    render(msg.report);
  });

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node[k] = v;
    }
    for (const c of children || []) if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }

  function glyph(status) {
    return status === "ok" ? "✓" : status === "warn" ? "!" : "✗";
  }

  function render(report) {
    const summary = document.getElementById("alp-doc-summary");
    summary.textContent = report.ok ? "All required tools present" : report.missingRequired + " required item(s) missing";

    const rows = document.getElementById("alp-doc-rows");
    rows.textContent = "";
    for (const c of report.checks) {
      const g = el("span", { class: "alp-doc-glyph alp-doc-" + c.status, text: glyph(c.status) });
      const mid = el("div", {}, [
        el("div", { class: "alp-doc-label", text: c.label + (c.required ? "" : " (recommended)") }),
        el("div", { class: "alp-doc-detail", text: c.detail }),
      ]);
      let action = el("span", {});
      if (c.fixId) {
        const btn = el("button", { class: "alp-doc-fix", text: "Fix" });
        btn.addEventListener("click", () => vscode.postMessage({ type: "fix", fixId: c.fixId }));
        action = btn;
      }
      rows.appendChild(el("div", { class: "alp-doc-row" }, [g, mid, action]));
    }
  }

  vscode.postMessage({ type: "reload" });
})();
