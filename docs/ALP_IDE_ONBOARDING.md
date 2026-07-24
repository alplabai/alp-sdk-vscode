# ALP IDE — GUI Onboarding Guide

Last revised: 2026-07-25

This guide walks through every GUI-first path for getting started with the ALP SDK
inside VS Code, using the ALP IDE sidebar panel and wizard flows.

## Overview

The ALP IDE extension provides five entry-point surfaces:

| Surface | Command | Purpose |
|---------|---------|---------|
| **Sidebar** | Auto-opens on workspace load | Status overview + quick actions |
| **Setup Wizard** | `Alp: Open Setup Wizard` | Step-by-step first-run environment setup |
| **New Project Wizard** | `Alp: New Project Wizard` | Create a new ALP project from a template |
| **Open Existing Project** | `Alp: Open Existing ALP Project` | Open and activate an existing ALP project |
| **IDE Overview** | `Alp: Open ALP IDE overview` | Full-window summary of workspace state |
| **Models Panel** | Activity Bar → ALP icon → Models | Pre-flight fit badge, INT8 prep, host run/A-B, model-zoo browse |

---

## 1. First Run — Setup Wizard

If Python, west, or CMake are not on your PATH, the sidebar shows status chips
in the **Setup** section.  Click **Fix Now** next to any missing component, or
run the full wizard:

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **`Alp: Open Setup Wizard`**.
3. The wizard opens as a full-window editor panel.
4. Work through each step:
   - **Environment** — Python, west, CMake, Ninja readiness checks.
   - **SDK** — Choose an SDK path or install from the release catalog.
   - **Workspace** — Verify or create a west workspace (`west init` + `west update`).
5. Each step shows a status chip: `Ready`, `Action Required`, `Missing`, or `Update Needed`.
6. Click **Fix Now** / **Install** buttons to resolve issues in-place.
7. When all steps show **Ready**, close the wizard.

> **Tip:** You can re-open the Setup Wizard at any time to re-check the environment
> after installing new tools.

---

## 2. Creating a New Project

1. Run **`Alp: New Project Wizard`** from the Command Palette, or click
   **New Project** in the ALP IDE sidebar.
2. The wizard opens as a 4-step horizontal flow:

### Step 1 — Template

The template grid is generated dynamically from the active SDK, so the exact
cards depend on the SDK version. It has two groups:

- **Starters** — the CLI project templates (`tan init` `--template`): _Minimal
  app_, _Zephyr app_, _Sensor starter_, _IoT starter_, _Edge AI starter_,
  _Board diagnostics_, and _Host tooling starter_.
- **Examples** — one card per SDK example, titled from each example's README
  (e.g. `gpio-button-led`, `lvgl-widgets-demo`, `iot-dashboard`).

Click a template card to select it (the card highlights with a blue border).

### Step 2 — Hardware

Select the target E1M module from the grouped list:

- **Alif Ensemble** — E1M-AEN801, AEN301, AEN401, AEN501, AEN601, AEN801
- **Renesas RZ/V2N** — E1M-V2N101, V2N102, V2M101 (+ DEEPX DX-M1), V2M102
- **NXP i.MX 9** — E1M-NX9101

The selected module determines the `som.sku` value written to `board.yaml`.

### Step 3 — Name

Enter a project name.  Rules:
- Letters, digits, underscores, and hyphens only.
- Must start with a letter or digit.
- This becomes the output folder name and the CMake `project()` name.

### Step 4 — Confirm

Review the template, module, and project name.  Click **Create Project**.

A folder picker opens — select or create the parent directory.  The wizard
creates the following scaffold inside `<parent>/<project-name>/`:

```
board.yaml          # schema_version: 2, som.sku: <module>, project.name: <name>
CMakeLists.txt      # find_package(Zephyr), project(), target_sources(app)
prj.conf            # empty Kconfig fragment
src/
  main.c            # #include <zephyr/kernel.h> + int main(void)
```

VS Code opens the new folder automatically.

---

## 3. Opening an Existing ALP Project

1. Run **`Alp: Open Existing ALP Project`** from the Command Palette.
2. The wizard opens as a 3-step flow:

### Step 1 — Folder

If a workspace is already open, it is shown with its path.  To use a different
folder, click **Open Folder…** or the inline link.

### Step 2 — Inspect

The wizard checks the open folder for:

| Check | Status |
|-------|--------|
| `board.yaml` present | `Ready` / `Missing` |
| `.west/` directory present | `Ready` / `Action Required` |

If `board.yaml` is missing, the folder may not be an ALP project.

### Step 3 — Activate

Depending on inspection results:

- **West not initialised** → Click **Initialise & Activate** to run `west init` and `west update`.
- **Already initialised** → Click **Open Project** to switch the window to this folder,
  or **Configure Board** to open the Board Configurator.

---

## 4. ALP IDE Overview Panel

Run **`Alp: Open ALP IDE overview`** to open a full-window summary showing:

- SDK path, version, and readiness state.
- Setup tool versions (Python, west, CMake, Ninja).
- Workspace root, `board.yaml` status, west init status.
- Quick-action buttons for common tasks.

The Overview panel refreshes automatically when workspace folders change or
when the SDK is switched.

---

## 5. Sidebar Quick Actions

The ALP IDE sidebar (Activity Bar → ALP icon) shows live status chips and
per-section action buttons:

| Section | Available Actions |
|---------|------------------|
| **Setup** | Fix Now, Run Bootstrap, Retry Check |
| **Workspace** | Activate Workspace, New Workspace, Switch Folder |
| **SDK** | Install SDK, Switch SDK, Refresh |

All actions update the sidebar status chips in real time.

---

## 6. Models Panel

The **Models Panel** is a thin GUI over the `tan model` command family — it collects
input, shells `tan model …`, and renders the JSON envelope. Reach it from the
Activity Bar (**ALP icon → Models**). Nothing here compiles or flashes; every action
is a host-side, pre-build check.

| GUI action | Shells | What it shows |
|------------|--------|---------------|
| **Fit badge** (green / yellow / red) | `tan model check <model.tflite\|.onnx> --sku <SKU>` (or `--board board.yaml [--model NAME]`) `[--format human\|json]` | Static, offline pre-flight verdict per SoM backend — `fits` (green) / `cpu-fallback` (yellow) / `no-fit` (red) — with est. SRAM (vs the SoC arena budget), est. latency, op-coverage %, and unsupported ops. No toolchain needed. |
| **Prep Model** | `tan model prep <model.onnx\|.tflite> --calibration <dir> [--out] [--per-channel] [--min-samples N]` | License-free INT8 quantize (onnxruntime QDQ) plus an fp32-vs-int8 accuracy report (top-1 agreement %, mean cosine, max-abs-err, `good`/`degraded` verdict + guidance). A `.tflite` input is converted to ONNX first (tf2onnx). |
| **Run Model** | `tan model run <model.onnx> [--input FILE.npy] [--expected LABEL] [--runs N]` | Host reference run (backend `cpu-host`): functional result + host latency + accuracy. |
| **A-B Compare** | `tan model ab <a.onnx> <b.onnx> [--input] [--runs]` | Runs two models on the same input (host reference): latency + size delta. |
| **Model Zoo Gallery** | `tan model zoo [--sku <SKU> \| --board board.yaml] [--format]` | Browse curated model-zoo entries, each marked `runs_here` for your SoM. One-click **Add** shells `tan model add <zoo-id> [--board board.yaml] [--name NAME] [--models-dir DIR]` to append `{name, source}` to `board.yaml` `models:` (non-destructive — a duplicate name errors). |

> **Honest caveats — read before trusting a number:**
> - The **fit badge** is a *static, conservative estimate* (labelled `source:static`, biased to never over-promise `fits`). It is verified on real silicon later, not by this check.
> - **Run Model** and **A-B Compare** are *host reference* runs (backend `cpu-host`) — **not** the target SoM's performance. `peak_sram_kib` / `power_mj` are `null` on the host; on-device power + measurement are hardware-gated (they need the EVK power-topology + Yocto NPU runtimes).
> - Real curated zoo entries, PyTorch/Keras→ONNX conversion, and per-backend compile defaults are follow-ons.

---

## 7. Recovery Language Reference

| Chip label | Meaning | Suggested action |
|------------|---------|-----------------|
| **Ready** | Component is healthy | No action needed |
| **Action Required** | Component exists but needs configuration | Click Fix Now |
| **Missing** | Component not found | Install or configure |
| **Update Needed** | Outdated version detected | Update via Fix Now |
| **Blocked** | Cannot proceed until a dependency is resolved | Resolve dependency first |

---

## 8. Related Guides

- [GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md) — Quick terminal-and-command-palette path
- [ALP_IDE_SDK_INSTALLATION.md](ALP_IDE_SDK_INSTALLATION.md) — Detailed SDK install and management
- [TROUBLESHOOTING_ENVIRONMENT.md](TROUBLESHOOTING_ENVIRONMENT.md) — Environment issues
