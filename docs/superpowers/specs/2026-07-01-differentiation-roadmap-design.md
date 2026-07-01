# Alp SDK VS Code Extension — Differentiation Roadmap

**Date:** 2026-07-01
**Status:** Draft for review
**Scope:** Feature roadmap to differentiate the Alp SDK extension from competing embedded IDE tools (nRF Connect for VS Code, PlatformIO, ESP-IDF extension, STM32 VS Code, Zephyr IDE).

## Strategy

Serve three customer segments with one roadmap:

1. **Evaluators** — firmware engineers comparing Alp SoMs against competitors. The first 30 minutes decide.
2. **Committed teams** — customers shipping products on Alp. Day-to-day productivity, debugging, CI, variant management.
3. **Hardware/product engineers** — know their product, not Zephyr internals. Guided, GUI-first flows.

Differentiation rests on four pillars, all pursued. Two structural advantages underlie everything: **Alp has a structured SKU/SoM metadata model** (competitors treat hardware as text configs), and **the E1M standard fixes the SoM pinout** — pins carry a standard function or act as GPIO, making SoM swaps pin-compatible by design. Every pillar exploits the metadata model; pillar 1 additionally turns E1M compliance into tooling no competitor can replicate without a standard of their own.

All features are designed **offline-first**. Cloud-dependent capabilities (fleet, OTA) are tier-2 and light up when a backend exists; until then, local artifact formats define the contract.

## Existing assets these features build on

- board.yaml JSON schema + LSP (validation, effective-config preview)
- Config generators: zephyr-conf, dts-overlay, cmake-args, yocto-conf
- alp-cli with `validate`, `generate`, `inspect`, `trace`
- west build/flash/native_sim integration + problem matchers
- Board configurator GUI (webview), hardware explorer, new project wizard
- Debug doctor, preflight, toolchain doctor, support bundle export
- SKU catalog (`newBoardFromSku`), SoM docs deep-linking (`docsBaseUrl`)

## Pillar 1 — Hardware-truth integration

### F1. E1M compliance diagnostics at edit time
The E1M standard fixes the SoM pinout: each pin carries its standard function or acts as GPIO; remapping is possible but breaks the standard. LSP diagnostics driven by SKU metadata enforce this: warn when board.yaml assigns a pin outside its E1M function/GPIO envelope ("deviates from E1M — possible but not recommended"), flag invalid peripheral instances, and validate function-vs-GPIO mode choices as the user types. Extends the existing LSP server and schema validation. No competitor has a pin standard to enforce, let alone in-editor enforcement.

### F2. Interactive pinout view
Upgrade the hardware explorer to a visual E1M pin map: the fixed standard pinout, each pin's mode (standard function or GPIO), current assignment, and a compliance badge for any deviation. Two-way binding — toggling a pin's mode from the view updates board.yaml.

### F3. Config provenance trace in-editor
Hover any line in generated alp.conf / alp.overlay → show which board.yaml entry and SKU rule produced it. alp-cli already has `trace`; surface it as hovers/CodeLens in the editor.

### F4. Datasheet-anchored hovers
Hover a peripheral in board.yaml → key specs (max baud, voltage domain, errata notes) from SKU metadata, with a deep link to the SoM documentation page.

### F5. SKU migration assistant — prove the E1M swap guarantee
E1M's fixed pinout means SoM swaps are pin-compatible by design — the standard's core selling point. The migration assistant turns that promise into proof: "move board from SKU A to SKU B" verifies feature/peripheral availability on the target SKU, reports capability differences (missing peripheral instances, performance deltas), flags any existing E1M deviations that would not survive the swap, and emits a patched board.yaml. Competitors cannot offer this because their ecosystems have no pinout standard.

## Pillar 2 — Time-to-first-blink

### F6. One-command environment bootstrap
Harden `installDependencies` into a full bootstrap: detect toolchain/west/python/probe tools, install what is missing, verify by building a hello-blink sample, and report elapsed time. Target: clone → LED blink in under 10 minutes, measured and displayed.

### F7. Prebuilt eval images
New project wizard offers "flash demo image now, build later" — first success on hardware before any toolchain install.

### F8. Devcontainer fallback
Generate a `.devcontainer` with the full toolchain when host installation fails or the user prefers containers. Particularly valuable on Windows, where competitors are weakest.

### F9. Guided first-run walkthrough
Native VS Code `walkthroughs` contribution: connect board → flash → see serial output, with live checkmarks fed by doctor checks.

## Pillar 3 — AI-assisted embedded development

### F10. Build-error explainer
Parse west/gcc failures, feed the error plus board.yaml and SKU context to an LLM, output cause and concrete fix (e.g. "CONFIG_SPI missing because the overlay disabled spi1"). Hardware context is the edge over generic Copilot.

### F11. MCP server for Alp projects
Expose board state, SKU catalog, validate/generate/trace as MCP tools built on alp-core. Any AI agent (Claude Code, Copilot, etc.) becomes Alp-aware. Low cost, large ecosystem leverage.

### F12. Metadata-driven driver scaffolding
Extend `scaffoldModule`: generate a sensor/driver skeleton from a SKU peripheral descriptor with bus, address, and IRQ pin pre-wired.

### F13. Chat over device state
"Why is my I2C silent?" → assistant grounded in board.yaml, pinout, serial log, and doctor output. Depends on F10/F11 plumbing.

## Pillar 4 — Full lifecycle (dev → CI → fleet)

### F14. CI config generator
`Alp: Generate CI` emits a GitHub Actions / GitLab pipeline: validate board.yaml → generate configs → build matrix per board variant → upload artifacts. Reuses the same alp-cli commands locally and in CI — one source of truth.

### F15. Variant/matrix management
Multiple board.yaml variants (EVT/DVT/PVT, regional SKUs) as first-class objects: variant picker in the status bar, build-all matrix, config diff view between variants.

### F16. Release bundle + signing
Command produces a versioned artifact: firmware + manifest (SKU, board.yaml hash, toolchain versions) + optional signature. Fully offline; the manifest format is the future OTA contract.

### F17. Smart serial monitor
Built-in monitor decoding Zephyr log levels, linking file:line to source, recording sessions into the support bundle. Table stakes vs nRF Connect, but integrated with doctor/bundle.

### F18. Fleet hooks (tier 2 — cloud-dependent)
Panel surfacing provisioned devices / OTA channels once a backend exists. Until then, F16's manifest defines the interface.

## Delivery waves

| Wave | Features | Rationale |
|------|----------|-----------|
| 1 | F1, F3, F6, F14 | Immediate moat (SKU model in-editor) + evaluation win + team win; all build directly on existing LSP/CLI |
| 2 | F2, F5, F10, F11, F17 | Highly visible, demo-able differentiators |
| 3 | F7, F8, F9, F12, F15, F16 | Depth across all segments |
| 4 | F13, F18 | Require AI plumbing / backend infrastructure |

**Compounding combination no competitor has:** F1 + F3 + F11 — the editor, the human, and AI agents all reasoning over the same structured hardware model.

## Error handling & resilience principles

- Every feature degrades gracefully offline (docs hovers fall back to cached metadata; CI generator never requires network).
- AI features (F10–F13) are opt-in and never block core flows; failures fall back to raw tool output.
- Bootstrap (F6) is idempotent and resumable; each step reports pass/fail into the doctor framework.

## Success criteria

- Evaluators: clone → blink < 10 min on Windows/macOS/Linux (F6/F7/F9).
- Committed teams: SKU migration and variant matrix reduce config-drift incidents to zero (F5/F14/F15).
- Non-experts: complete board bring-up without touching a terminal (F2/F9 + existing configurator).

## Out of scope

- Building Alp cloud backend services (only the extension-side contracts).
- Rust CLI migration (tracked separately in CLAUDE.md).
- Non-VS Code IDEs.
