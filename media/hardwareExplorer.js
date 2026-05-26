// SPDX-License-Identifier: Apache-2.0
// Alp Hardware Explorer — read-only view of the selected SoM's cores, on-module
// chips, E1M pad routes, and on-module I2C device map. Rendered from data the
// panel posts (SomPreset + resolved SoC cores).
(function () {
  const vscode = acquireVsCodeApi();
  let data = null;

  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("data-")) n.setAttribute(k, v); else n[k] = v;
    }
    for (const c of children || []) if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  const main = () => document.getElementById("hx-main");

  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "render") return;
    data = e.data;
    const som = document.getElementById("hx-som");
    if (som) som.textContent = data.som ? data.som.sku : "";
    render();
  });

  function render() {
    const m = main(); if (!m) return; clear(m);
    if (!data.sdkConnected) { m.appendChild(empty("No Alp SDK found. Set alpSdk.path to your alp-sdk checkout.")); return; }
    if (!data.som) { m.appendChild(empty("Select a SoM the SDK recognises (open a board.yaml / the configurator).")); return; }
    const s = data.som;
    const wrap = el("div", { class: "alp-section alp-wide" });
    wrap.appendChild(el("p", { class: "alp-seclabel", text: `§ ${s.displayName || s.sku}` }));
    wrap.appendChild(el("p", { class: "alp-help", text: `${s.silicon}${s.family ? " · " + s.family : ""}` }));

    // Compute
    wrap.appendChild(card("Compute", coresTable(data.cores || [])));
    // On-module chips
    wrap.appendChild(card("On-module", chipList(s.onModule || [])));
    // Pad routes (searchable)
    wrap.appendChild(card("E1M pad routes", padRoutes(s.padRoutes || [])));
    // I2C devices
    wrap.appendChild(card("On-module I2C devices", i2cTable(s.i2cDevices || [])));
    m.appendChild(wrap);
  }

  function empty(msg) { return el("div", { class: "alp-section" }, [el("p", { class: "alp-help", text: msg })]); }
  function card(title, body) {
    return el("div", { class: "alp-advcard" }, [el("div", { class: "alp-advhd", text: title }), el("div", { class: "alp-advbody" }, [body])]);
  }
  function table(headers, rows) {
    const t = el("table", { class: "hx-table" });
    const thead = el("tr", {});
    headers.forEach((h) => thead.appendChild(el("th", { text: h })));
    t.appendChild(thead);
    rows.forEach((r) => {
      const tr = el("tr", {});
      r.forEach((cellText) => tr.appendChild(el("td", { text: cellText == null ? "" : String(cellText) })));
      t.appendChild(tr);
    });
    return t;
  }

  function coresTable(cores) {
    if (!cores.length) return el("span", { class: "alp-selempty", text: "core detail not in the SoC spec" });
    return table(["Core", "Type", "Count", "Freq (MHz)"], cores.map((c) => [c.id, c.type, c.count, c.freqMhz]));
  }
  function chipList(chips) {
    if (!chips.length) return el("span", { class: "alp-selempty", text: "none" });
    const w = el("div", { class: "alp-chips" });
    chips.forEach((c) => w.appendChild(el("span", { class: "alp-accchip on", text: c })));
    return w;
  }
  function i2cTable(devs) {
    if (!devs.length) return el("span", { class: "alp-selempty", text: "none listed" });
    return table(["Bus", "Chip", "Role", "Addr (7-bit)"], devs.map((d) => [d.bus, d.chip, d.role, d.address]));
  }
  function padRoutes(routes) {
    const box = el("div", {});
    if (!routes.length) { box.appendChild(el("span", { class: "alp-selempty", text: "no proxied pad routes (pads route directly to the SoC)" })); return box; }
    const search = el("input", { type: "text", placeholder: `Filter ${routes.length} pad routes…`, class: "hx-search" });
    const host = el("div", {});
    function draw(q) {
      clear(host);
      const f = q ? routes.filter((r) => (r.e1m + " " + r.dispatch + " " + (r.dispatchPin || "") + " " + (r.doc || "")).toLowerCase().includes(q)) : routes;
      host.appendChild(table(["E1M pad", "Dispatch", "Pin", "Note"], f.map((r) => [r.e1m, r.dispatch, r.dispatchPin, r.doc])));
    }
    search.addEventListener("input", () => draw(search.value.trim().toLowerCase()));
    box.appendChild(search);
    box.appendChild(host);
    draw("");
    return box;
  }

  vscode.postMessage({ type: "reload" });
})();
