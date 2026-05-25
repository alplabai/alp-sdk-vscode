// SPDX-License-Identifier: Apache-2.0
// Alp Board Configurator — thin client renderer.
// Receives `render { viewModel, board, boardPath, sdkConnected, theme }` from the panel,
// builds the active section's DOM, and posts edits back. Hard logic lives in the tested
// core view-model; this file is DOM + the edit contract.
(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    vm: null,
    board: null,
    boardPath: "",
    sdkConnected: false,
    theme: "brand",
    active: "project",
    /** when true, the next `render` echo should not rebuild #alp-main (scalar edit in progress) */
    suppressRebuild: false,
  };

  // ---- tiny DOM helpers ----
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else if (k === "value") node.value = v;
        else node[k] = v;
      }
    }
    for (const c of children || []) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  const main = () => document.getElementById("alp-main");

  let debounceTimer = null;
  function postUpdate(structural) {
    if (!structural) state.suppressRebuild = true;
    vscode.postMessage({ type: "update", board: state.board });
  }
  function postUpdateDebounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => postUpdate(false), 200);
  }

  // ============================ render dispatch ============================
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === "saved") { flashSaved("saved"); return; }
    if (msg.type !== "render") return;
    state.vm = msg.viewModel;
    state.board = msg.board;
    state.boardPath = msg.boardPath;
    state.sdkConnected = msg.sdkConnected;
    if (msg.theme) state.theme = msg.theme;
    document.body.dataset.theme = state.theme;
    renderValidation();
    flashSaved("saved");
    if (state.suppressRebuild) { state.suppressRebuild = false; return; }
    renderActive();
  });

  function flashSaved(word) {
    const s = document.getElementById("alp-saved");
    if (s) s.textContent = state.boardPath ? `board.yaml · ${word}` : "";
  }

  function renderValidation() {
    const v = document.getElementById("alp-validation");
    if (!v || !state.vm) return;
    const errs = state.vm.validation.errors;
    const warns = state.vm.validation.warnings || [];
    v.className = "alp-valid " + (errs.length ? "err" : "ok");
    if (errs.length) v.textContent = `✗ ${errs.length} error${errs.length > 1 ? "s" : ""}: ${errs[0]}`;
    else if (warns.length) v.textContent = `⚠ ${warns.length} warning${warns.length > 1 ? "s" : ""}`;
    else v.textContent = "✓ Valid";
  }

  function renderActive() {
    const m = main();
    if (!m) return;
    clear(m);
    if (!state.sdkConnected) { m.appendChild(renderDisconnected()); return; }
    if (state.active === "cores") m.appendChild(renderCoresPlaceholder());
    else m.appendChild(renderProject());
  }

  // ---- sidebar nav ----
  document.querySelectorAll(".alp-nav a[data-section]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      state.active = a.getAttribute("data-section");
      document.querySelectorAll(".alp-nav a").forEach((n) => n.classList.toggle("active", n === a));
      renderActive();
    });
  });

  // ---- footer buttons ----
  bindClick("alp-save", () => vscode.postMessage({ type: "save" }));
  bindClick("alp-reload", () => vscode.postMessage({ type: "reload" }));
  bindClick("alp-preview", () => vscode.postMessage({ type: "previewEffectiveConfig" }));
  function bindClick(id, fn) { const b = document.getElementById(id); if (b) b.addEventListener("click", fn); }

  // ============================ disconnected ============================
  function renderDisconnected() {
    return el("div", { class: "alp-section" }, [
      el("p", { class: "alp-seclabel", text: "§ Not connected" }),
      el("p", { class: "alp-help", text: "No Alp SDK found. Set alpSdk.path to your alp-sdk checkout to load SoMs, boards, chips and libraries." }),
    ]);
  }

  // ============================ Project & Hardware ============================
  function renderProject() {
    const vm = state.vm, board = state.board;
    const sec = el("div", { class: "alp-section" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: "§ Project & Hardware" }));

    // SoM SKU (grouped) — structural
    const skuSel = el("select", { "data-field": "som.sku" });
    for (const g of vm.som.options) {
      const og = el("optgroup", { label: g.family });
      for (const s of g.soms) {
        const label = s.displayName + (s.preliminary ? "  (preliminary)" : "");
        const opt = el("option", { value: s.sku, text: label });
        if (s.sku === vm.som.selected) opt.selected = true;
        og.appendChild(opt);
      }
      skuSel.appendChild(og);
    }
    skuSel.addEventListener("change", () => {
      board.som = board.som || {};
      board.som.sku = skuSel.value;
      postUpdate(true);
    });
    sec.appendChild(field("SoM SKU", skuSel, "som.sku · drives backend, default board & chips"));

    // name / description — scalar
    const nameInput = el("input", { type: "text", value: board.name || "", placeholder: "(optional board name)" });
    nameInput.addEventListener("input", () => { setOrDelete(board, "name", nameInput.value); postUpdateDebounced(); });
    const descInput = el("input", { type: "text", value: board.description || "", placeholder: "(optional one-line description)" });
    descInput.addEventListener("input", () => { setOrDelete(board, "description", descInput.value); postUpdateDebounced(); });
    sec.appendChild(row(field("Name", nameInput), field("Description", descInput)));

    // board mode + carrier — structural
    const carrierSel = el("select", { "data-field": "preset" });
    carrierSel.appendChild(el("option", { value: "", text: "(inline — no preset)" }));
    for (const b of vm.carriers.options) {
      const opt = el("option", { value: b.name, text: b.displayName || b.name });
      if (b.name === vm.carriers.selected) opt.selected = true;
      carrierSel.appendChild(opt);
    }
    carrierSel.addEventListener("change", () => {
      if (carrierSel.value) board.preset = carrierSel.value;
      else delete board.preset;
      postUpdate(true);
    });
    sec.appendChild(field("Carrier / board preset", carrierSel, vm.boardMode === "inline" ? "inline populated mode" : "preset mode"));

    // hardware card (read-only)
    sec.appendChild(renderHardwareCard(vm));
    return sec;
  }

  function renderHardwareCard(vm) {
    const card = el("div", { class: "alp-card" });
    if (!vm.hardware) {
      card.appendChild(el("div", { class: "alp-cardtop" }, [el("span", { class: "alp-name", text: "Unknown SoM" })]));
      card.appendChild(el("div", { class: "alp-kv", text: "Select a SoM SKU recognised by the SDK." }));
      return card;
    }
    const hw = vm.hardware;
    const top = el("div", { class: "alp-cardtop" }, [
      el("span", { class: "alp-name", text: hw.displayName || hw.sku }),
      el("span", { class: "alp-silicon", text: hw.silicon }),
    ]);
    if (hw.preliminary) top.appendChild(el("span", { class: "alp-pill warn", text: "preliminary" }));
    card.appendChild(top);

    const kv = el("dl", { class: "alp-kv" });
    const coresText = hw.cores.length
      ? hw.cores.map((c) => `${c.count}× ${c.type}${c.freqMhz ? " @ " + c.freqMhz + "MHz" : ""}`).join(" · ")
      : "—";
    kvRow(kv, "Compute", coresText);
    const backend = el("span", {}, [
      document.createTextNode(hw.preferredBackend || "—"),
      el("span", { class: "alp-fixed", text: "silicon-fixed" }),
    ]);
    kvRow(kv, "Inference", backend);
    kvRow(kv, "Default board", hw.defaultBoard || "—");
    if (hw.onModule && hw.onModule.length) kvRow(kv, "On-module", hw.onModule.join(" · "));

    // accelerator row — only the accelerators this SoM actually has
    const acc = el("div", { class: "alp-acc" });
    for (const a of vm.accelerators) {
      if (!a.available) continue;
      acc.appendChild(el("span", { class: "alp-accchip on", text: a.label }));
    }
    kv.appendChild(el("dt", { text: "Accelerators" }));
    kv.appendChild(el("dd", {}, [acc]));
    card.appendChild(kv);
    return card;
  }

  // ============================ Cores (placeholder until UI-2b Task 3) ============================
  function renderCoresPlaceholder() {
    return el("div", { class: "alp-section" }, [
      el("p", { class: "alp-seclabel", text: "§ Cores" }),
      el("p", { class: "alp-help", text: "Per-core editor (override cards + library selector) — building next." }),
    ]);
  }

  // ---- field/layout helpers ----
  function field(label, control, hint) {
    return el("div", { class: "alp-field" }, [
      el("label", { text: label }),
      control,
      hint ? el("div", { class: "alp-hint", text: hint }) : null,
    ]);
  }
  function row(a, b) { return el("div", { class: "alp-row" }, [a, b]); }
  function kvRow(dl, k, v) {
    dl.appendChild(el("dt", { text: k }));
    dl.appendChild(el("dd", {}, [typeof v === "string" ? document.createTextNode(v) : v]));
  }
  function setOrDelete(obj, key, val) { if (val) obj[key] = val; else delete obj[key]; }

  // ask the panel to (re)send state on load
  vscode.postMessage({ type: "reload" });
})();
