// SPDX-License-Identifier: Apache-2.0
//
// Webview client for the ALP board configurator.  Receives an
// `init` message from the extension host with the current board.yaml
// model + the preset catalogue (released SoM SKUs, carriers and
// their populated defaults, schema enums) and binds controls to it.

/* global acquireVsCodeApi */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {object|null} */
  let model = null;
  /** @type {object|null} */
  let catalogue = null;
  /** @type {string|null} */
  let boardPath = null;
  /** @type {string} */
  let baselineFingerprint = "";
  /** @type {string} */
  let activeSection = "project";

  const sectionOrder = [
    "project",
    "features",
    "diagnostics",
    "review",
    "advanced",
  ];

  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing element: " + id);
    return el;
  }

  function fillSelect(el, values, current, placeholder) {
    el.innerHTML = "";
    if (placeholder !== undefined) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      el.appendChild(opt);
    }
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === current) opt.selected = true;
      el.appendChild(opt);
    }
  }

  function fingerprint(obj) {
    return JSON.stringify(obj || {});
  }

  function updateStatus(text) {
    $("status").textContent = text;
  }

  function updateMeta() {
    const isDirty = model && fingerprint(model) !== baselineFingerprint;
    const chip = $("dirty-indicator");
    chip.textContent = isDirty ? "Unsaved changes" : "Up to date";
    chip.classList.toggle("dirty", !!isDirty);
    chip.classList.toggle("clean", !isDirty);
    $("board-path").textContent = boardPath
      ? "Editing " + boardPath
      : "board.yaml path unresolved";
  }

  function isSectionVisible(sectionName) {
    const section = $("section-" + sectionName);
    const mode = $("view-mode").value;
    if (mode === "advanced") return true;
    return section.dataset.level !== "advanced";
  }

  function setActiveSection(sectionName) {
    if (!isSectionVisible(sectionName)) {
      return;
    }
    activeSection = sectionName;
    for (const name of sectionOrder) {
      const section = $("section-" + name);
      const button = document.querySelector(
        ".section-tab[data-section='" + name + "']",
      );
      const visible = isSectionVisible(name);
      section.hidden = !visible || name !== sectionName;
      if (button) {
        button.hidden = !visible;
        button.classList.toggle("active", visible && name === sectionName);
      }
    }
  }

  function updateModeVisibility() {
    if (!isSectionVisible(activeSection)) {
      const firstVisible =
        sectionOrder.find((name) => isSectionVisible(name)) || "project";
      setActiveSection(firstVisible);
      return;
    }
    setActiveSection(activeSection);
  }

  function validateModelDraft() {
    const errors = [];
    const warnings = [];
    const suggestions = [];

    if (!model || !model.som || !model.som.sku) {
      errors.push("SoM SKU is required.");
    }
    if (!model || !model.carrier || !model.carrier.name) {
      errors.push("Carrier name is required.");
    }
    if (isV2()) {
      const cores = model.cores || {};
      const activeCores = Object.values(cores).filter(
        (c) => c && c.os && c.os !== "off",
      );
      if (activeCores.length === 0) {
        errors.push("At least one core must be active (os != off) in schema v2.");
      }
    } else if (!model || !model.os) {
      errors.push("OS target is required.");
    }

    const arena = model && model.inference && model.inference.default_arena_kib;
    if (arena !== undefined && (!Number.isFinite(arena) || arena < 16)) {
      warnings.push("Inference arena should be at least 16 KiB.");
    }

    if (model && model.iot && model.iot.mqtt && !model.iot.wifi) {
      suggestions.push(
        "MQTT is enabled while Wi-Fi is disabled. Confirm your transport path.",
      );
    }
    if (!model || !model.libraries || model.libraries.length === 0) {
      suggestions.push(
        "No optional libraries selected. This is fine for minimal projects.",
      );
    }

    return { errors, warnings, suggestions };
  }

  function renderValidationSummary() {
    const summary = validateModelDraft();
    $("validation-counts").textContent =
      "Errors: " +
      summary.errors.length +
      " | Warnings: " +
      summary.warnings.length +
      " | Suggestions: " +
      summary.suggestions.length;

    const items = $("validation-items");
    items.innerHTML = "";

    for (const message of summary.errors) {
      const li = document.createElement("li");
      li.className = "severity-error";
      li.textContent = "Error: " + message;
      items.appendChild(li);
    }
    for (const message of summary.warnings) {
      const li = document.createElement("li");
      li.className = "severity-warning";
      li.textContent = "Warning: " + message;
      items.appendChild(li);
    }
    for (const message of summary.suggestions) {
      const li = document.createElement("li");
      li.className = "severity-suggestion";
      li.textContent = "Suggestion: " + message;
      items.appendChild(li);
    }

    if (items.children.length === 0) {
      const li = document.createElement("li");
      li.className = "severity-clean";
      li.textContent = "No issues detected.";
      items.appendChild(li);
    }

    return summary;
  }

  function onModelChanged() {
    renderValidationSummary();
    updateMeta();
  }

  function carrierPreset(name) {
    if (!catalogue) return null;
    return catalogue.carriers.find((c) => c.name === name) || null;
  }

  function renderCarrierPopulated() {
    const host = $("carrier-populated");
    host.innerHTML = "";
    if (!model || !catalogue) return;

    const carrierName = (model.carrier && model.carrier.name) || "";
    const preset = carrierPreset(carrierName);
    // Source of truth for the row keys: union of (preset defaults,
    // user overrides) so both shipped chips and customer additions
    // appear in the UI.
    const merged = Object.assign(
      {},
      preset ? preset.populated : {},
      (model.carrier && model.carrier.populated) || {},
    );
    const keys = Object.keys(merged).sort();
    for (const chip of keys) {
      const row = document.createElement("div");
      row.className = "populated-row";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!merged[chip];
      checkbox.addEventListener("change", () => {
        model.carrier = model.carrier || { name: carrierName };
        model.carrier.populated = model.carrier.populated || {};
        const presetDefault = preset && preset.populated[chip];
        if (presetDefault === checkbox.checked) {
          // Match the preset default -- drop the override
          // entry so the saved yaml stays minimal.
          delete model.carrier.populated[chip];
        } else {
          model.carrier.populated[chip] = checkbox.checked;
        }
        onModelChanged();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(chip));
      row.appendChild(label);

      const source = document.createElement("span");
      source.className = "source";
      if (preset && chip in preset.populated) {
        source.textContent = "carrier preset";
      } else {
        source.textContent = "custom";
      }
      row.appendChild(source);
      host.appendChild(row);
    }
  }

  function renderLibraries() {
    const host = $("libraries");
    host.innerHTML = "";
    if (!catalogue) return;
    const selected = new Set(model.libraries || []);
    for (const lib of catalogue.libraries) {
      const row = document.createElement("div");
      row.className = "library-row";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(lib);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(lib);
        else selected.delete(lib);
        model.libraries = Array.from(selected.values()).sort();
        onModelChanged();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(lib));
      row.appendChild(label);
      host.appendChild(row);
    }
  }

  const CORE_OS_CHOICES = ["zephyr", "yocto", "baremetal", "off"];

  function renderCoresBlock() {
    const host = $("cores-rows");
    host.innerHTML = "";
    if (!model || !model.cores) return;

    const coreIds = Object.keys(model.cores);
    for (const coreId of coreIds) {
      const entry = model.cores[coreId] || {};
      const row = document.createElement("div");
      row.className = "core-row";

      const idLabel = document.createElement("span");
      idLabel.className = "core-id";
      idLabel.textContent = coreId;
      row.appendChild(idLabel);

      const osSelect = document.createElement("select");
      osSelect.className = "core-os-select";
      for (const choice of CORE_OS_CHOICES) {
        const opt = document.createElement("option");
        opt.value = choice;
        opt.textContent = choice;
        if (choice === (entry.os || "")) opt.selected = true;
        osSelect.appendChild(opt);
      }
      osSelect.addEventListener("change", () => {
        if (!model || !model.cores) return;
        model.cores[coreId] = model.cores[coreId] || {};
        model.cores[coreId].os = osSelect.value;
        onModelChanged();
      });
      row.appendChild(osSelect);

      const appInput = document.createElement("input");
      appInput.type = "text";
      appInput.className = "core-app-input";
      appInput.placeholder = "app (optional)";
      appInput.value = entry.app || "";
      appInput.addEventListener("change", () => {
        if (!model || !model.cores) return;
        model.cores[coreId] = model.cores[coreId] || {};
        if (appInput.value.trim()) {
          model.cores[coreId].app = appInput.value.trim();
        } else {
          delete model.cores[coreId].app;
        }
        onModelChanged();
      });
      row.appendChild(appInput);

      host.appendChild(row);
    }
  }

  function isV2() {
    return !!model && model.schema_version >= 2;
  }

  function bindStatic() {
    $("view-mode").addEventListener("change", () => {
      updateModeVisibility();
    });

    for (const tab of document.querySelectorAll(".section-tab")) {
      tab.addEventListener("click", () => {
        const section = tab.dataset.section;
        if (section) {
          setActiveSection(section);
        }
      });
    }

    const skuEl = $("som-sku");
    skuEl.addEventListener("change", () => {
      if (!model) return;
      model.som = model.som || { sku: "" };
      model.som.sku = skuEl.value;
      onModelChanged();
    });

    const carrierEl = $("carrier-name");
    carrierEl.addEventListener("change", () => {
      if (!model) return;
      model.carrier = model.carrier || {};
      model.carrier.name = carrierEl.value;
      // When the carrier changes, drop the user's prior overrides
      // -- they're meaningless against a different preset.
      delete model.carrier.populated;
      renderCarrierPopulated();
      onModelChanged();
    });

    const osEl = $("os-choice");
    osEl.addEventListener("change", () => {
      if (!model) return;
      model.os = osEl.value;
      onModelChanged();
    });

    const backendEl = $("inference-backend");
    backendEl.addEventListener("change", () => {
      if (!model) return;
      if (backendEl.value === "") {
        if (model.inference) delete model.inference.backend;
      } else {
        model.inference = model.inference || {};
        model.inference.backend = backendEl.value;
      }
      onModelChanged();
    });

    const arenaEl = $("inference-arena");
    arenaEl.addEventListener("change", () => {
      if (!model) return;
      const val = parseInt(arenaEl.value, 10);
      if (Number.isFinite(val) && val >= 16) {
        model.inference = model.inference || {};
        model.inference.default_arena_kib = val;
      } else if (model.inference) {
        delete model.inference.default_arena_kib;
      }
      onModelChanged();
    });

    for (const key of ["wifi", "mqtt", "ble", "tls"]) {
      const el = $("iot-" + key);
      el.addEventListener("change", () => {
        if (!model) return;
        model.iot = model.iot || {};
        model.iot[key] = el.checked;
        onModelChanged();
      });
    }

    const lastErrEl = $("diag-last-error");
    lastErrEl.addEventListener("change", () => {
      if (!model) return;
      model.diagnostics = model.diagnostics || {};
      model.diagnostics.last_error = lastErrEl.checked;
      onModelChanged();
    });

    const logEl = $("diag-log-level");
    logEl.addEventListener("change", () => {
      if (!model) return;
      model.diagnostics = model.diagnostics || {};
      model.diagnostics.log_level = logEl.value;
      onModelChanged();
    });

    $("save").addEventListener("click", () => {
      if (!model) return;
      const summary = renderValidationSummary();
      if (summary.errors.length > 0) {
        setActiveSection("review");
        updateStatus("Resolve validation errors before saving.");
        return;
      }
      const dirty = fingerprint(model) !== baselineFingerprint;
      if (!dirty) {
        updateStatus("No changes to save.");
        return;
      }
      const target = boardPath || "board.yaml";
      const proceed = window.confirm(
        "Write changes to " +
          target +
          "?\n\n" +
          "Errors: " +
          summary.errors.length +
          ", Warnings: " +
          summary.warnings.length +
          ", Suggestions: " +
          summary.suggestions.length,
      );
      if (!proceed) {
        return;
      }
      vscode.postMessage({ type: "save", payload: model });
    });
    $("reload").addEventListener("click", () => {
      vscode.postMessage({ type: "reload" });
    });
    $("preview-effective").addEventListener("click", () => {
      vscode.postMessage({ type: "previewEffectiveConfig" });
    });
  }

  function applyModelToControls() {
    if (!model || !catalogue) return;
    fillSelect($("som-sku"), catalogue.skus, model.som && model.som.sku);
    fillSelect(
      $("carrier-name"),
      catalogue.carriers.map((c) => c.name),
      model.carrier && model.carrier.name,
    );
    fillSelect($("os-choice"), catalogue.osChoices, model.os);
    fillSelect(
      $("inference-backend"),
      catalogue.inferenceBackends,
      model.inference && model.inference.backend,
      "(use SoM preset's preferred_backend)",
    );
    fillSelect(
      $("diag-log-level"),
      catalogue.logLevels,
      model.diagnostics && model.diagnostics.log_level,
    );
    $("inference-arena").value =
      (model.inference && model.inference.default_arena_kib) || "";
    for (const key of ["wifi", "mqtt", "ble", "tls"]) {
      $("iot-" + key).checked = !!(model.iot && model.iot[key]);
    }
    $("diag-last-error").checked =
      !model.diagnostics || model.diagnostics.last_error !== false;
    renderCarrierPopulated();
    renderLibraries();
    // v1: show os-choice row; v2: show cores block
    const v2 = isV2();
    $("os-choice-row").hidden = v2;
    $("cores-block").hidden = !v2;
    if (v2) {
      renderCoresBlock();
    }
    renderValidationSummary();
    updateModeVisibility();
    updateMeta();
  }

  window.addEventListener("message", (evt) => {
    const msg = evt.data;
    if (msg.type === "init") {
      model = msg.model;
      catalogue = msg.catalogue;
      boardPath = msg.boardPath;
      baselineFingerprint = fingerprint(model);
      applyModelToControls();
      updateStatus("Loaded from disk.");
    } else if (msg.type === "saved") {
      baselineFingerprint = fingerprint(model);
      updateMeta();
      updateStatus("Saved " + msg.boardPath);
    }
  });

  bindStatic();
  updateModeVisibility();
})();
