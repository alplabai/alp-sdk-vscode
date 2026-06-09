const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDebugTroubleshootingPanelHtml,
} = require("../packages/alp-core/dist/debug/panelHtml.js");

test("createDebugTroubleshootingPanelHtml includes sections and command links", () => {
  const html = createDebugTroubleshootingPanelHtml({
    cspSource: "vscode-webview://panel",
    generatedAt: "2026-05-14T00:00:00.000Z",
    targetKind: "native-host",
    server: "none",
    inspect: {
      schemaVersion: "1",
      generatedAt: "2026-05-14T00:00:00.000Z",
      context: {
        generatedAt: "2026-05-14T00:00:00.000Z",
        workspaceRoot: "/workspace/app",
        sdkRoot: "/workspace/sdk",
        boardYamlPath: "/workspace/app/board.yaml",
        boardYamlExists: true,
        westCwd: "/workspace/app",
        pythonBinary: "python3",
        debuggerExtensions: {
          cortexDebug: true,
          cppTools: true,
          codeLLDB: true,
        },
      },
      resolvedValues: [
        {
          key: "workspaceRoot",
          source: "workspace",
          value: "/workspace/app",
          detail: "Workspace root path",
        },
      ],
    },
    trace: {
      schemaVersion: "1",
      generatedAt: "2026-05-14T00:00:00.000Z",
      workflow: "vscode.debugPanel",
      decisions: [
        {
          key: "generation.target.zephyr-conf",
          outcome: "planned",
          outputPath: "/workspace/app/build/generated/alp.conf",
          detail: "Would run loader plan",
        },
      ],
    },
    doctor: {
      generatedAt: "2026-05-14T00:00:00.000Z",
      targetKind: "native-host",
      server: "none",
      summary: { pass: 3, warn: 0, fail: 0 },
      checks: [
        {
          name: "workspaceRoot",
          status: "pass",
          detail: "workspace is available",
        },
      ],
      nextSteps: [],
    },
    preflight: {
      generatedAt: "2026-05-14T00:00:00.000Z",
      targetKind: "native-host",
      server: "none",
      profileId: "native-host-none",
      summary: { pass: 4, warn: 0, fail: 0 },
      checks: [
        {
          name: "workspaceRoot",
          status: "pass",
          detail: "workspace is available",
        },
      ],
      nextSteps: [],
      canLaunch: true,
    },
  });

  assert.match(html, /Alp Troubleshooting Panel/);
  assert.match(html, /Inspect: Effective Resolved Values/);
  assert.match(html, /Trace: Generation Decisions/);
  assert.match(html, /Environment: Doctor Summary/);
  assert.match(html, /command:alp\.openDebugTroubleshootingPanel/);
  assert.match(html, /workspaceRoot/);
});
