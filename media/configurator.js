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
    else if (state.active === "chips") m.appendChild(renderChips());
    else if (state.active === "diagnostics") m.appendChild(renderDiagnostics());
    else if (state.active === "advanced") m.appendChild(renderAdvanced());
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
  // Apply instantly client-side (theme is purely a CSS data attribute); the panel
  // only persists the choice. Avoids a render round-trip and a config read-after-write race.
  bindChange("alp-theme", (v) => {
    state.theme = v;
    document.body.dataset.theme = v;
    vscode.postMessage({ type: "setTheme", theme: v });
  });
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

  // generic searchable add control (selected chips + filter dropdown), updates locally + posts.
  // getList()->string[] current selection; setList(arr) mutates the board.
  function renderTagSelector(allIds, getList, setList, placeholder) {
    const wrap = el("div", { class: "alp-sel" });
    const chips = el("div", { class: "alp-selchips" });
    const combo = el("div", { class: "alp-combo" });
    const input = el("input", { type: "text", placeholder: placeholder || "Add…" });
    const dd = el("div", { class: "alp-dd", style: "display:none" });
    let matches = [], active = -1;

    function commit(arr) { setList(arr); rebuildChips(); refresh(); postUpdate(false); }
    function add(id) { const arr = getList().slice(); if (!arr.includes(id)) arr.push(id); input.value = ""; commit(arr); input.focus(); }
    function remove(id) { commit(getList().filter((l) => l !== id)); }
    function rebuildChips() {
      clear(chips);
      const list = getList();
      if (!list.length) chips.appendChild(el("span", { class: "alp-selempty", text: "none" }));
      for (const id of list) {
        const x = el("span", { class: "x", text: "×" });
        x.addEventListener("click", () => remove(id));
        chips.appendChild(el("span", { class: "alp-selchip" }, [document.createTextNode(id + " "), x]));
      }
    }
    function refresh() {
      const q = input.value.trim().toLowerCase();
      const chosen = new Set(getList());
      matches = allIds.filter((id) => !chosen.has(id) && id.toLowerCase().includes(q)).sort().slice(0, 8);
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

  function renderLibrarySelector(coreId) {
    return renderTagSelector(
      state.vm.libraries,
      () => { const c = state.board.cores && state.board.cores[coreId]; return (c && c.libraries) || []; },
      (arr) => { const c = ensureCore(coreId); if (arr.length) c.libraries = arr; else delete c.libraries; },
      "Add library…",
    );
  }

  // ============================ Chips (project-wide chips[]) ============================
  function renderChips() {
    const sec = el("div", { class: "alp-section" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: "§ Chips" }));
    sec.appendChild(el("p", { class: "alp-help", text: "Chip drivers the app links directly via <alp/chips/…>, project-wide. The list is filtered to the selected SoM's family." }));
    const allChipIds = (state.vm.chips || []).map((c) => c.chipId);
    const sel = renderTagSelector(
      allChipIds,
      () => state.board.chips || [],
      (arr) => { if (arr.length) state.board.chips = arr; else delete state.board.chips; },
      "Add chip driver…",
    );
    sec.appendChild(field("Linked chip drivers", sel, `${allChipIds.length} chip drivers available for this SoM`));
    return sec;
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

  // ============================ Advanced (Boot / Storage / Security / OTA / IPC) ============================
  function ensureObj(key) { state.board[key] = state.board[key] || {}; return state.board[key]; }
  function selectEl(options, current, onChange) {
    const s = el("select");
    options.forEach(([v, l]) => { const o = el("option", { value: v, text: l }); if (v === current) o.selected = true; s.appendChild(o); });
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function textEl(value, ph, onInput) { const i = el("input", { type: "text", value: value || "", placeholder: ph || "" }); i.addEventListener("input", () => onInput(i.value)); return i; }
  function numEl(value, ph, onInput) { const i = el("input", { type: "number", value: value != null ? String(value) : "", placeholder: ph || "" }); i.addEventListener("input", () => onInput(i.value)); return i; }
  function checkEl(checked, label, onChange) { const c = el("input", { type: "checkbox" }); c.checked = !!checked; c.addEventListener("change", () => onChange(c.checked)); return el("label", { class: "alp-check" }, [c, el("span", { text: " " + label })]); }
  function advCard(title, children) { return el("div", { class: "alp-advcard" }, [el("div", { class: "alp-advhd", text: title }), el("div", { class: "alp-advbody" }, children)]); }
  function intInto(obj, key, raw) { const n = parseInt(raw, 10); if (Number.isFinite(n)) obj[key] = n; else delete obj[key]; }

  function renderAdvanced() {
    const sec = el("div", { class: "alp-section alp-wide" });
    sec.appendChild(el("p", { class: "alp-seclabel", text: "§ Advanced" }));
    sec.appendChild(el("p", { class: "alp-help", text: "Production blocks — bootloader, storage, security, OTA, and cross-core IPC. Leave a block off to use the SDK defaults." }));
    sec.appendChild(renderBootBlock());
    sec.appendChild(renderStorageBlock());
    sec.appendChild(renderSecurityBlock());
    sec.appendChild(renderOtaBlock());
    sec.appendChild(renderIpcBlock());
    return sec;
  }

  function renderBootBlock() {
    const b = state.board.boot || {};
    const kids = [];
    kids.push(field("Bootloader", selectEl([["", "(SDK default)"], ["mcuboot", "mcuboot"], ["none", "none"]], b.method || "", (v) => {
      if (!v) delete state.board.boot; else ensureObj("boot").method = v;
      postUpdate(true);
    })));
    if (b.method === "mcuboot") {
      const sign = b.signing || {};
      kids.push(row(
        field("Signing algorithm", selectEl([["ecdsa_p256", "ecdsa_p256"], ["rsa2048", "rsa2048"], ["rsa3072", "rsa3072"], ["ed25519", "ed25519"]], sign.algorithm || "ecdsa_p256", (v) => { const bb = ensureObj("boot"); bb.signing = bb.signing || {}; bb.signing.algorithm = v; postUpdate(false); })),
        field("Public key file", textEl(sign.key_file, "keys/prod.pub.pem", (v) => { const bb = ensureObj("boot"); bb.signing = bb.signing || {}; setOrDelete(bb.signing, "key_file", v); postUpdateDebounced(); })),
      ));
      kids.push(row(
        field("Swap algorithm", selectEl([["scratch", "scratch"], ["move", "move"], ["overwrite", "overwrite"]], b.swap_algorithm || "scratch", (v) => { const bb = ensureObj("boot"); if (v === "scratch") delete bb.swap_algorithm; else bb.swap_algorithm = v; postUpdate(false); })),
        field("Build type", selectEl([["Release", "Release"], ["Debug", "Debug"], ["MinSizeRel", "MinSizeRel"]], b.build_type || "Release", (v) => { const bb = ensureObj("boot"); if (v === "Release") delete bb.build_type; else bb.build_type = v; postUpdate(false); })),
      ));
      kids.push(checkEl(b.anti_rollback, "Anti-rollback (monotonic image counters)", (c) => { const bb = ensureObj("boot"); if (c) bb.anti_rollback = true; else delete bb.anti_rollback; postUpdate(false); }));
    }
    return advCard("Boot", kids);
  }

  function renderStorageBlock() {
    const parts = state.board.storage || [];
    const list = el("div", { class: "alp-partlist" });
    if (!parts.length) list.appendChild(el("span", { class: "alp-selempty", text: "no partitions" }));
    parts.forEach((p, i) => {
      const x = el("span", { class: "alp-modx", text: "×" });
      x.addEventListener("click", () => { state.board.storage.splice(i, 1); if (!state.board.storage.length) delete state.board.storage; postUpdate(true); });
      list.appendChild(el("div", { class: "alp-partrow" }, [
        textEl(p.name, "name", (v) => { p.name = v; postUpdateDebounced(); }),
        numEl(p.size_kib, "size KiB", (v) => { intInto(p, "size_kib", v); postUpdateDebounced(); }),
        selectEl([["raw", "raw"], ["littlefs", "littlefs"], ["fat", "fat"], ["ext4", "ext4"]], p.fs || "raw", (v) => { if (v === "raw") delete p.fs; else p.fs = v; postUpdate(false); }),
        textEl(p.flash_device, "flash device", (v) => { setOrDelete(p, "flash_device", v); postUpdateDebounced(); }),
        x,
      ]));
    });
    const add = el("button", { class: "alp-btn", text: "Add partition" });
    add.addEventListener("click", () => { state.board.storage = state.board.storage || []; state.board.storage.push({ name: "data", size_kib: 64 }); postUpdate(true); });
    return advCard("Storage partitions", [list, add]);
  }

  function renderSecurityBlock() {
    const has = !!(state.board.security && state.board.security.psa);
    const psa = (state.board.security && state.board.security.psa) || {};
    const kids = [checkEl(has, "Enable PSA Crypto key store", (c) => { if (c) { const s = ensureObj("security"); s.psa = s.psa || {}; } else delete state.board.security; postUpdate(true); })];
    if (has) {
      kids.push(row(
        field("Persistent key slots", numEl(psa.persistent_slots, "16", (v) => { const s = ensureObj("security"); s.psa = s.psa || {}; intInto(s.psa, "persistent_slots", v); postUpdateDebounced(); })),
        field("Attestation root", selectEl([["none", "none"], ["optiga_trust_m", "optiga_trust_m"], ["tfm_internal", "tfm_internal"]], psa.attestation_root || "none", (v) => { const s = ensureObj("security"); s.psa = s.psa || {}; if (v === "none") delete s.psa.attestation_root; else s.psa.attestation_root = v; postUpdate(false); })),
      ));
      kids.push(checkEl(psa.tfm, "Enable TF-M secure partition", (c) => { const s = ensureObj("security"); s.psa = s.psa || {}; if (c) s.psa.tfm = true; else delete s.psa.tfm; postUpdate(false); }));
    }
    return advCard("Security (PSA)", kids);
  }

  function renderOtaBlock() {
    const o = state.board.ota || {};
    const kids = [field("OTA provider", selectEl([["", "(none)"], ["mender", "mender"], ["hawkbit", "hawkbit"], ["mcumgr", "mcumgr"]], o.provider || "", (v) => {
      if (!v) delete state.board.ota; else ensureObj("ota").provider = v;
      postUpdate(true);
    }))];
    if (o.provider) {
      const srv = o.server || {};
      kids.push(row(
        field("Artifact name", textEl(o.artifact_name, "my-fw-v1", (v) => { const oo = ensureObj("ota"); setOrDelete(oo, "artifact_name", v); postUpdateDebounced(); })),
        field("Poll interval (s)", numEl(o.poll_interval_s, "1800", (v) => { const oo = ensureObj("ota"); intInto(oo, "poll_interval_s", v); postUpdateDebounced(); })),
      ));
      kids.push(field("Server URL", textEl(srv.url, "https://hosted.mender.io", (v) => { const oo = ensureObj("ota"); oo.server = oo.server || {}; setOrDelete(oo.server, "url", v); if (!Object.keys(oo.server).length) delete oo.server; postUpdateDebounced(); })));
    }
    return advCard("OTA", kids);
  }

  function renderIpcBlock() {
    const ipc = state.board.ipc || [];
    const list = el("div", { class: "alp-partlist" });
    if (!ipc.length) list.appendChild(el("span", { class: "alp-selempty", text: "no IPC channels" }));
    ipc.forEach((e, i) => {
      const x = el("span", { class: "alp-modx", text: "×" });
      x.addEventListener("click", () => { state.board.ipc.splice(i, 1); if (!state.board.ipc.length) delete state.board.ipc; postUpdate(true); });
      list.appendChild(el("div", { class: "alp-partrow ipc" }, [
        textEl(e.name, "name", (v) => { e.name = v; postUpdateDebounced(); }),
        selectEl([["rpmsg", "rpmsg"], ["raw_shmem", "raw_shmem"], ["mailbox_only", "mailbox_only"]], e.kind || "rpmsg", (v) => { e.kind = v; postUpdate(false); }),
        textEl((e.endpoints || []).join(", "), "core_a, core_b", (v) => { e.endpoints = v.split(",").map((s) => s.trim()).filter(Boolean); postUpdateDebounced(); }),
        numEl(e.carve_out_kb, "KiB", (v) => { intInto(e, "carve_out_kb", v); postUpdateDebounced(); }),
        x,
      ]));
    });
    const add = el("button", { class: "alp-btn", text: "Add IPC channel" });
    add.addEventListener("click", () => { state.board.ipc = state.board.ipc || []; state.board.ipc.push({ kind: "rpmsg", name: "alp_rpmsg", endpoints: [], carve_out_kb: 256 }); postUpdate(true); });
    return advCard("IPC carve-outs", [list, add]);
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
