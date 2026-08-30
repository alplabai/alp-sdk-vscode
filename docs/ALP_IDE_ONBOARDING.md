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

**There is no Models surface to open in this release.** The Activity Bar
contributes exactly one view — **Alp IDE** (`alp-ide.hub`) — and both Models
commands (`Alp: Models` and `Alp: Build Model`) are hidden from the Command
Palette (`"when": "false"`, #525). The commands are still registered, but nothing
in the GUI reaches them, so there is no step here to follow on a first run.
Restoring the surface is tracked as #524.

The panel is also ahead of the CLI it shells. The pinned `tan` (0.6.0)
implements exactly one `model` subcommand — `build`, which compiles and packages
the `models:` entries of `board.yaml` into `.alpmodel` packages (default output
directory `build/models`). The pre-flight NPU-coverage badge, INT8 prep with an
fp32-vs-int8 accuracy report, host reference run, A-B compare and the model-zoo
gallery are all intended, and each of them needs a `model` subcommand this `tan`
does not have (`check`, `prep`, `run`, `ab`, `zoo`, `add`) — that gap is
tan-cli#674, and keeping this documentation in step with it is #551.

> **When the surface returns, two of its numbers still need reading carefully:**
>
> - NPU coverage is an _eligibility_ screen, not proof of NPU execution. An
>   operator the NPU cannot take falls back to the CPU silently rather than
>   failing, and `undetermined` means "no data for that backend" — never "the
>   model will not run".
> - **Run Model** and **A-B Compare** are _host reference_ runs (backend
>   `cpu-host`) — they measure the host, **not** the target SoM.

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
