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
    const ts = document.getElementById("alp-theme"); if (ts) ts.value = state.theme;
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
    if (state.active === "cores") m.appendChild(renderCores());
    else if (state.active === "diagnostics") m.appendChild(renderDiagnostics());
    else if (state.active === "review") m.appendChild(renderReview());
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

  // ---- theme toggle ----
  bindChange("alp-theme", (v) => vscode.postMessage({ type: "setTheme", theme: v }));
  function bindChange(id, fn) { const e = document.getElementById(id); if (e) e.addEventListener("change", () => fn(e.value)); }

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

  // ============================ Cores ============================
  function ensureCore(id) {
    state.board.cores = state.board.cores || {};
    state.board.cores[id] = state.board.cores[id] || {};
    return state.board.cores[id];
  }

  function renderCores() {
    const vm = state.vm;
    const sec = el("div", { class: "alp-section alp-wide" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: `§ Cores · ${vm.som.selected}` }));
    sec.appendChild(el("p", { class: "alp-help", text: "One slice per core from the SoM topology. Blank cores inherit the SoM preset's defaults." }));
    for (const core of vm.cores) sec.appendChild(renderCoreCard(core));
    return sec;
  }

  function renderCoreCard(core) {
    if (core.inheritedFromTopology) {
      const card = el("div", { class: "alp-core ghost" });
      card.appendChild(el("div", { class: "alp-chd" }, [
        el("span", { class: "alp-led m" }),
        el("span", { class: "alp-cid", text: core.id }),
        el("span", { class: "alp-spacer" }),
        el("span", { class: "alp-osq", text: "inherits SoM default" }),
      ]));
      const ob = el("button", { class: "alp-ob", text: "Override this core" });
      ob.addEventListener("click", () => { ensureCore(core.id); postUpdate(true); });
      card.appendChild(el("div", { class: "alp-ghostnote" }, [
        document.createTextNode("Runs the SoM preset's default image. "), ob,
      ]));
      return card;
    }

    const enabled = core.os !== "off";
    const card = el("div", { class: "alp-core" });
    const sw = el("span", { class: "alp-sw" + (enabled ? " on" : "") });
    const toggle = el("span", { class: "alp-toggle" }, [el("span", { text: "Enabled" }), sw]);
    toggle.addEventListener("click", () => {
      const c = ensureCore(core.id);
      if (enabled) c.os = "off"; else delete c.os;
      postUpdate(true);
    });
    card.appendChild(el("div", { class: "alp-chd" }, [
      el("span", { class: "alp-led m" }),
      el("span", { class: "alp-cid", text: core.id }),
      el("span", { class: "alp-spacer" }),
      toggle,
    ]));
    if (!enabled) {
      card.appendChild(el("div", { class: "alp-ghostnote", text: "Disabled (os: off)." }));
      return card;
    }

    const body = el("div", { class: "alp-cbody" });
    const appInput = el("input", { type: "text", value: core.app || "", placeholder: "./src" });
    appInput.addEventListener("input", () => { const c = ensureCore(core.id); setOrDelete(c, "app", appInput.value); postUpdateDebounced(); });
    const arenaInput = el("input", { type: "number", value: core.inferenceArenaKib != null ? String(core.inferenceArenaKib) : "", placeholder: "128", min: "16" });
    arenaInput.addEventListener("input", () => {
      const c = ensureCore(core.id);
      const n = parseInt(arenaInput.value, 10);
      if (Number.isFinite(n)) { c.inference = c.inference || {}; c.inference.default_arena_kib = n; }
      else if (c.inference) { delete c.inference.default_arena_kib; if (!Object.keys(c.inference).length) delete c.inference; }
      postUpdateDebounced();
    });
    body.appendChild(row(field("App directory", appInput), field("Inference arena (KiB)", arenaInput)));

    // IoT toggles (structural — affects validation)
    const iotWrap = el("div", { class: "alp-chips" });
    ["wifi", "mqtt", "ble", "tls"].forEach((flag) => {
      const on = !!core.iot[flag];
      const chip = el("span", { class: "alp-chip" + (on ? " on" : ""), text: flag });
      chip.addEventListener("click", () => {
        const c = ensureCore(core.id); c.iot = c.iot || {};
        if (on) delete c.iot[flag]; else c.iot[flag] = true;
        if (!Object.keys(c.iot).length) delete c.iot;
        postUpdate(true);
      });
      iotWrap.appendChild(chip);
    });
    body.appendChild(field("Connectivity (IoT)", iotWrap));

    body.appendChild(field("Libraries", renderLibrarySelector(core.id)));
    card.appendChild(body);
    return card;
  }

  // searchable add control (selected chips + filter dropdown), updates locally + posts
  function renderLibrarySelector(coreId) {
    const all = state.vm.libraries;
    const wrap = el("div", { class: "alp-sel" });
    const chips = el("div", { class: "alp-selchips" });
    const combo = el("div", { class: "alp-combo" });
    const input = el("input", { type: "text", placeholder: "Add library…" });
    const dd = el("div", { class: "alp-dd", style: "display:none" });
    let matches = [], active = -1;

    const libs = () => { const c = state.board.cores && state.board.cores[coreId]; return (c && c.libraries) || []; };
    function commit() {
      const c = ensureCore(coreId);
      const list = c.libraries || [];
      if (!list.length) delete c.libraries;
      rebuildChips(); refresh();
      postUpdate(false); // suppressed: validation updates, selector keeps focus
    }
    function add(id) {
      const c = ensureCore(coreId);
      c.libraries = (c.libraries || []).slice();
      if (!c.libraries.includes(id)) c.libraries.push(id);
      input.value = ""; commit(); input.focus();
    }
    function remove(id) {
      const c = ensureCore(coreId);
      c.libraries = (c.libraries || []).filter((l) => l !== id);
      commit();
    }
    function rebuildChips() {
      clear(chips);
      const list = libs();
      if (!list.length) chips.appendChild(el("span", { class: "alp-selempty", text: "none" }));
      for (const id of list) {
        const x = el("span", { class: "x", text: "×" });
        x.addEventListener("click", () => remove(id));
        chips.appendChild(el("span", { class: "alp-selchip" }, [document.createTextNode(id + " "), x]));
      }
    }
    function refresh() {
      const q = input.value.trim().toLowerCase();
      const chosen = new Set(libs());
      matches = all.filter((id) => !chosen.has(id) && id.toLowerCase().includes(q)).sort().slice(0, 8);
      clear(dd); active = -1;
      if (!matches.length) { dd.style.display = "none"; return; }
      matches.forEach((id) => {
        const opt = el("div", { class: "alp-opt", text: id });
        opt.addEventListener("mousedown", (e) => { e.preventDefault(); add(id); });
        dd.appendChild(opt);
      });
      dd.style.display = "block";
    }
    function markActive() { Array.prototype.forEach.call(dd.children, (c, i) => c.classList.toggle("active", i === active)); }
    input.addEventListener("input", refresh);
    input.addEventListener("focus", refresh);
    input.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; }, 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { active = Math.min(active + 1, matches.length - 1); markActive(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); markActive(); e.preventDefault(); }
      else if (e.key === "Enter") { if (matches.length) add(matches[active >= 0 ? active : 0]); e.preventDefault(); }
      else if (e.key === "Escape") { dd.style.display = "none"; }
    });
    combo.appendChild(input); combo.appendChild(dd);
    wrap.appendChild(chips); wrap.appendChild(combo);
    rebuildChips();
    return wrap;
  }

  // ============================ Diagnostics ============================
  const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];
  function cleanupDiag() { const d = state.board.diagnostics; if (d && !Object.keys(d).length) delete state.board.diagnostics; }
  function ensureDiag() { state.board.diagnostics = state.board.diagnostics || {}; return state.board.diagnostics; }

  function renderDiagnostics() {
    const d = state.board.diagnostics || {};
    const sec = el("div", { class: "alp-section" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: "§ Diagnostics" }));

    const le = el("input", { type: "checkbox" }); le.checked = d.last_error !== false;
    le.addEventListener("change", () => {
      const dg = ensureDiag();
      if (le.checked) delete dg.last_error; else dg.last_error = false;
      cleanupDiag(); postUpdate(false);
    });
    sec.appendChild(el("div", { class: "alp-field" }, [
      el("label", { class: "alp-check" }, [le, el("span", { text: " Keep alp_last_error() slot (thread-local)" })]),
    ]));

    const lvl = el("select");
    LOG_LEVELS.forEach((l) => { const o = el("option", { value: l, text: l }); if ((d.log_level || "info") === l) o.selected = true; lvl.appendChild(o); });
    lvl.addEventListener("change", () => {
      const dg = ensureDiag();
      if (lvl.value === "info") delete dg.log_level; else dg.log_level = lvl.value;
      cleanupDiag(); postUpdate(false);
    });
    sec.appendChild(field("Default log level", lvl, "applies to every module without an override below"));

    sec.appendChild(el("div", { class: "alp-field" }, [
      el("label", { text: "Per-module overrides" }),
      renderModuleOverrides(),
    ]));
    return sec;
  }

  function renderModuleOverrides() {
    const wrap = el("div", { class: "alp-modules" });
    function mods() { const d = state.board.diagnostics; return (d && d.modules) || {}; }
    function setLevel(name, level) {
      const dg = ensureDiag(); dg.modules = dg.modules || {};
      dg.modules[name] = level;
      rebuild(); postUpdate(false);
    }
    function removeMod(name) {
      const dg = state.board.diagnostics;
      if (dg && dg.modules) { delete dg.modules[name]; if (!Object.keys(dg.modules).length) delete dg.modules; }
      cleanupDiag(); rebuild(); postUpdate(false);
    }
    const rows = el("div", { class: "alp-modrows" });
    const adder = el("div", { class: "alp-modadd" });
    function rebuild() {
      clear(rows);
      const m = mods();
      const keys = Object.keys(m);
      if (!keys.length) rows.appendChild(el("span", { class: "alp-selempty", text: "no overrides — every module uses the default level" }));
      keys.forEach((name) => {
        const sel = el("select");
        ["error", "warn", "info", "debug", "trace", "off"].forEach((l) => { const o = el("option", { value: l, text: l }); if (m[name] === l) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", () => setLevel(name, sel.value));
        const x = el("span", { class: "alp-modx", text: "×" });
        x.addEventListener("click", () => removeMod(name));
        rows.appendChild(el("div", { class: "alp-modrow" }, [el("span", { class: "alp-modname", text: name }), sel, x]));
      });
    }
    const addInput = el("input", { type: "text", placeholder: "module name (e.g. alp_inference)" });
    const addBtn = el("button", { class: "alp-btn", text: "Add override" });
    addBtn.addEventListener("click", () => {
      const name = addInput.value.trim();
      if (/^[a-z][a-z0-9_]*$/.test(name)) { setLevel(name, "debug"); addInput.value = ""; }
    });
    adder.appendChild(addInput); adder.appendChild(addBtn);
    wrap.appendChild(rows); wrap.appendChild(adder);
    rebuild();
    return wrap;
  }

  // ============================ Review ============================
  function renderReview() {
    const vm = state.vm, board = state.board;
    const sec = el("div", { class: "alp-section" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: "§ Review" }));

    const v = vm.validation;
    if (v.errors.length) {
      sec.appendChild(el("p", { class: "alp-revhead err", text: `✗ ${v.errors.length} error(s)` }));
      const ul = el("ul", { class: "alp-revlist" });
      v.errors.forEach((e) => ul.appendChild(el("li", { text: e })));
      sec.appendChild(ul);
    } else {
      sec.appendChild(el("p", { class: "alp-revhead ok", text: "✓ board.yaml is valid" }));
    }
    if (v.warnings && v.warnings.length) {
      const ul = el("ul", { class: "alp-revlist warn" });
      v.warnings.forEach((w) => ul.appendChild(el("li", { text: w })));
      sec.appendChild(ul);
    }

    const enabledCores = vm.cores.filter((c) => !c.inheritedFromTopology && c.os !== "off").map((c) => c.id);
    const summary = el("dl", { class: "alp-kv" });
    kvRow(summary, "SoM", vm.som.selected || "—");
    kvRow(summary, "Board", board.preset ? board.preset : (vm.boardMode === "inline" ? "inline" : "—"));
    kvRow(summary, "Active cores", enabledCores.length ? enabledCores.join(" · ") : "—");
    if (board.chips && board.chips.length) kvRow(summary, "Chips", board.chips.join(" · "));
    sec.appendChild(el("div", { class: "alp-card" }, [
      el("div", { class: "alp-cardtop" }, [el("span", { class: "alp-name", text: "Effective summary" })]),
      summary,
    ]));

    const prev = el("button", { class: "alp-btn primary", text: "Preview effective config" });
    prev.addEventListener("click", () => vscode.postMessage({ type: "previewEffectiveConfig" }));
    sec.appendChild(el("div", { style: "margin-top:14px" }, [prev]));
    return sec;
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
