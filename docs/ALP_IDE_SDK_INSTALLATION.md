# ALP IDE — SDK Installation and Management

Last revised: 2026-05-16

This guide covers installing, switching, and managing ALP SDK versions
from inside the VS Code extension.

---

## 1. Prerequisites

Before installing the SDK, ensure the following tools are on your PATH:

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.10 | `python3 --version` |
| west | 1.2 | `west --version` |
| CMake | 3.20 | `cmake --version` |
| Ninja | 1.11 | `ninja --version` |

The Setup section in the ALP IDE sidebar shows a status chip for each tool.
If any chip shows **Missing** or **Action Required**, use the
[ALP IDE Onboarding Guide](ALP_IDE_ONBOARDING.md) to resolve it before
continuing.

---

## 2. Installing the SDK via the GUI

### 2a. From the Setup Wizard

1. Run **`Alp: Open Setup Wizard`** (Command Palette).
2. Navigate to the **SDK** step.
3. Click **Install SDK** — the wizard fetches the release catalog from GitHub.
4. Select the desired release from the list.
5. Click **Install**.
6. A progress log is shown while the SDK is being downloaded and extracted.
7. When the chip changes to **Ready**, the SDK is installed and active.

### 2b. From the Sidebar

1. Expand the **SDK** section in the ALP IDE sidebar.
2. If no SDK is detected, click **Install SDK**.
3. Follow the same release selection flow as above.

---

## 3. SDK Release Catalog

The extension fetches available SDK versions from the ALP GitHub releases page.
Releases are listed in descending version order.  The catalog is loaded
on demand — click the refresh icon to reload it.

Each release entry shows:
- Version tag (e.g., `v1.3.0`)
- Release date
- Download size estimate

---

## 4. Switching Between SDK Versions

If multiple SDK versions are installed locally:

1. In the **SDK** sidebar section, click **Switch SDK**.
2. A folder picker opens — navigate to the target SDK root directory.
3. The extension validates that the selected path contains `scripts/alp_project.py`.
4. On success, the active path and version chip update immediately.

You can also set the path manually in VS Code settings:

```jsonc
// .vscode/settings.json or user settings
{
  "alpSdk.path": "/opt/alp-sdk-v1.3.0"
}
```

---

## 5. Bootstrap (create the Zephyr workspace)

After installing the SDK, a **Zephyr workspace** must be created to fetch the
Zephyr kernel, HAL modules, and toolchains.  This is called "bootstrapping."

### Via the GUI

1. In the sidebar **Workspace** section, click **Activate Workspace**.
   — or —
   Open the **Open Existing Project** wizard and use **Initialise & Activate**.

2. The extension runs `tan bootstrap`. It is native on every host — a Rust port
   of the SDK's `scripts/bootstrap.sh` + `scripts/bootstrap.ps1`, **not** a
   shell-out to either, so Windows needs no `bash` (tan-cli#49). It creates a
   workspace virtual environment, installs `west` into it, initialises the
   Zephyr workspace with the **alp-sdk checkout itself as the manifest repo**,
   and installs Zephyr's Python requirements:
   ```
   west init -l <sdk-path>
   west update          # shallow + narrow
   west zephyr-export
   ```
   The exact flags come from the SDK's `metadata/bootstrap.json`, which is the
   source of truth for them. `west init -l` makes the **parent of the SDK
   checkout** the west topdir — a sibling `zephyrproject/` topdir is the
   pre-v0.11 layout, which the extension still recognises but bootstrap no
   longer creates.
3. Progress is shown in the Output panel (`ALP SDK` channel).
4. When complete, the west chip in the sidebar changes to **Ready**.

Manual fallback (no extension): `tan bootstrap`, run from the project directory
(`--no-pip` / `--no-west` / `--print-env` are supported). Works on Windows,
macOS and Linux with no shell dependency.

The SDK still ships `scripts/bootstrap.sh` and `scripts/bootstrap.ps1`, but they
are no longer the supported entry point — `tan bootstrap` is the one that stays
in step with the extension.

### Via the Command Palette

```
Alp: Bootstrap SDK environment
```

This re-runs `tan bootstrap` and refreshes the sidebar state.

---

## 6. Local SDK Discovery

On startup the extension scans common installation paths for existing SDK checkouts:

- `~/.alp-sdk/`
- `~/alp-sdk/`
- The workspace's parent directory

Discovered entries appear in the **SDK** sidebar section as a list.  You can
activate any discovered entry by clicking **Switch** next to it.

---

## 7. Offline / Air-gapped Installations

If network access is not available:

1. Download the SDK archive from the GitHub releases page on a connected machine.
2. Extract it to a stable path on the target machine (e.g., `/opt/alp-sdk-v1.3.0`).
3. Set `alpSdk.path` in VS Code settings to point to the extracted directory.
4. Manually run `west update` in a terminal inside the SDK directory if Zephyr
   modules are not already present.

The extension does not require internet access after the SDK and modules are
present on disk.

---

## 8. Verifying the Installation

After installation, the sidebar should show:

| Status chip | Expected state |
|-------------|---------------|
| SDK | **Ready** (version displayed) |
| Python | **Ready** |
| west | **Ready** |
| CMake | **Ready** |

If any chip remains in a non-Ready state, see
[TROUBLESHOOTING_ENVIRONMENT.md](TROUBLESHOOTING_ENVIRONMENT.md).

You can also run a quick validation from the Command Palette:

```
Alp: Validate board.yaml
```

If this command succeeds without errors, the SDK is correctly wired up.

---

## 9. Updating the SDK

To update to a newer release:

1. Run **`Alp: Install SDK`** and select the new version.
   — or —
   Pull the latest changes in your SDK checkout (`git pull`) and
   run `west update`.
2. Click **Switch SDK** in the sidebar and select the updated path if needed.
3. Re-run bootstrap if west manifests changed.

---

## 10. Related Guides

- [ALP_IDE_ONBOARDING.md](ALP_IDE_ONBOARDING.md) — Full GUI onboarding walkthrough
- [GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md) — Quick command-palette path
- [TROUBLESHOOTING_ENVIRONMENT.md](TROUBLESHOOTING_ENVIRONMENT.md) — Environment issues
- [GETTING_STARTED_CLI.md](GETTING_STARTED_CLI.md) — Terminal-first usage
