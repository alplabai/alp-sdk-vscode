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
  const testRoot = path.resolve(__dirname, "../../.vscode-test");
  const userDataDir = path.join(testRoot, "user-data");
  const extensionsDir = path.join(testRoot, "extensions");

  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");

  // The extension declares extensionDependencies: ["redhat.vscode-yaml"], so
  // VS Code refuses to activate it unless that extension is installed IN THE
  // SAME extensions dir the test run uses. The CLI is a `.cmd` shim on Windows,
  // so spawn it through a shell.
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
      "--force",
    ],
    { encoding: "utf-8", stdio: "inherit", shell: true },
  );
  if (install.status !== 0) {
    throw new Error(
      "Failed to install the redhat.vscode-yaml dependency into the test instance",
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
  });
}

main().catch((err) => {
  console.error("e2e run failed:", err);
  process.exit(1);
});
