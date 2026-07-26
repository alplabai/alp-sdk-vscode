// SPDX-License-Identifier: Apache-2.0
//
// End-to-end harness: launches a real VS Code, installs the redhat.vscode-yaml
// dependency the extension declares, then runs the in-host suite that activates
// the extension and drives its commands. Run with: node test/e2e/runTest.js
const path = require("path");
const cp = require("child_process");
const os = require("os");
const fs = require("fs");
const {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");

  // A throwaway workspace so the extension has a folder to resolve against, and
  // a dedicated user-data / extensions dir shared between the install step and
  // the test run (so the installed dependency is actually visible at runtime).
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "alp-e2e-ws-"));

  // Seed the workspace with a minimal valid board.yaml so the project-backed
  // surfaces (configurator, validate, generate) have real input to resolve.
  fs.writeFileSync(
    path.join(workspace, "board.yaml"),
    [
      "som:",
      "  sku: E1M-AEN801",
      "cores:",
      "  m55_hp:",
      "    app: ./src",
      "",
    ].join("\n"),
  );

  // Point the extension at the real SDK checkout (sibling of this repo by
  // convention) when present, so SDK-backed commands resolve instead of no-op.
  const sdkRoot = path.resolve(extensionDevelopmentPath, "..", "alp-sdk");
  process.env.ALP_E2E_SDK_ROOT = fs.existsSync(sdkRoot) ? sdkRoot : "";

  const testRoot = path.resolve(__dirname, "../../.vscode-test");
  const userDataDir = path.join(testRoot, "user-data");
  const extensionsDir = path.join(testRoot, "extensions");

  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");

  // The extension declares extensionDependencies: ["redhat.vscode-yaml"], so
  // VS Code refuses to activate it unless that extension is installed IN THE
  // SAME extensions dir the test run uses. The CLI is a `.cmd` shim on Windows,
  // so spawn it through a shell THERE ONLY: with `shell: true`, spawnSync joins
  // argv into one command string without quoting, and the macOS CLI path runs
  // through "Visual Studio Code.app", so the shell splits it at the space
  // ("/bin/sh: …/vscode-darwin-arm64-1.129.1/Visual: No such file or
  // directory") and every e2e run dies before it starts.
  const [cli, ...baseArgs] =
    resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  const install = cp.spawnSync(
    cli,
    [
      ...baseArgs,
      "--extensions-dir",
      extensionsDir,
      "--install-extension",
      "redhat.vscode-yaml",
      // cortex-debug is the second `extensionDependency`; without it the
      // extension does not activate in the isolated --extensions-dir and every
      // e2e case fails at activation. The VS Code CLI pulls ITS dependencies
      // (debug-tracker-vscode, memory-view, rtos-views, peripheral-viewer)
      // transitively, so they need no entries here.
      "--install-extension",
      "marus25.cortex-debug",
      "--force",
    ],
    {
      encoding: "utf-8",
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (install.status !== 0) {
    throw new Error(
      "Failed to install an extensionDependency into the test instance",
    );
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspace,
      "--disable-gpu",
      "--user-data-dir",
      userDataDir,
      "--extensions-dir",
      extensionsDir,
    ],
    // Cross into the extension-host process (separate from this launcher).
    extensionTestsEnv: {
      ALP_E2E_SDK_ROOT: process.env.ALP_E2E_SDK_ROOT || "",
    },
  });
}

main().catch((err) => {
  console.error("e2e run failed:", err);
  process.exit(1);
});
