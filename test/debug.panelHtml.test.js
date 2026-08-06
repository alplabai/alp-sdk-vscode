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
      kind: "envelope",
      data: {
        summary: { pass: 3, warn: 0, fail: 0 },
        checks: [
          {
            name: "workspaceRoot",
            status: "pass",
            detail: "workspace is available",
          },
          {
            name: "codeLLDBExtension",
            status: "unknown",
            detail:
              "unknown — the standalone tan binary cannot see VS Code's installed extensions.",
          },
        ],
      },
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
      configurationGraded: "none",
    },
  });

  assert.match(html, /Alp Troubleshooting Panel/);
  assert.match(html, /Inspect: Effective Resolved Values/);
  assert.match(html, /Trace: Generation Decisions/);
  assert.match(html, /Environment: Doctor Summary/);
  assert.match(html, /command:alp\.openDebugTroubleshootingPanel/);
  assert.match(html, /workspaceRoot/);
  // The panel builds its report the same config-blind way the support bundle
  // does, so `canLaunch=true` on its own would read as "this launch.json runs"
  // when nothing here opened the file (#339). Both halves, side by side.
  assert.match(html, /canLaunch=true configurationGraded=none/);
  // tan's own summary/checks, verbatim (#376) — pass/warn/fail counts an
  // `unknown` status the way tan's own arithmetic does, and the row itself
  // still renders rather than being filtered out.
  assert.match(html, /pass=3 warn=0 fail=0/);
  assert.match(html, /codeLLDBExtension/);
  assert.match(html, />unknown</);
});

// #376 decision 5: exactly ONE message where the doctor table was — never a
// second, in-process doctor rendered in its place.
test("createDebugTroubleshootingPanelHtml renders one message when the doctor is unavailable", () => {
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
      resolvedValues: [],
    },
    trace: {
      schemaVersion: "1",
      generatedAt: "2026-05-14T00:00:00.000Z",
      workflow: "vscode.debugPanel",
      decisions: [],
    },
    doctor: {
      kind: "unavailable",
      error:
        "tan could not be resolved: no prebuilt tan CLI for this platform.",
    },
    preflight: {
      generatedAt: "2026-05-14T00:00:00.000Z",
      targetKind: "native-host",
      server: "none",
      profileId: "native-host-none",
      summary: { pass: 4, warn: 0, fail: 0 },
      checks: [],
      nextSteps: [],
      canLaunch: true,
      configurationGraded: "none",
    },
  });

  assert.match(html, /Environment: Doctor Summary/);
  assert.match(
    html,
    /tan could not be resolved: no prebuilt tan CLI for this platform\./,
  );
  // No doctor table, no summary counts, no second doctor rebuilt in its
  // place — only the inspect/trace/preflight tables remain (3, not 4).
  assert.equal((html.match(/<table>/g) ?? []).length, 3);
  // The doctor section is ONE message, immediately followed by the next
  // heading — no `pass=… warn=… fail=…` line of its own (unlike Preflight
  // Summary, which still carries one).
  assert.match(
    html,
    /Environment: Doctor Summary<\/h2>\n {2}<p>tan could not be resolved.*<\/p>\n\n {2}<h2>Preflight Summary/,
  );
});

// #376 fix: the raw detail behind the curated message (`CliOutcome.
// unavailable.detail` — the actual errno/resolver diagnosis) must also reach
// this panel. It is channel-grade text, unlike a toast, so it is safe here
// and is the whole reason a reader can tell WHY tan was unresolvable.
test("createDebugTroubleshootingPanelHtml renders the raw detail behind an unavailable doctor, when present", () => {
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
      resolvedValues: [],
    },
    trace: {
      schemaVersion: "1",
      generatedAt: "2026-05-14T00:00:00.000Z",
      workflow: "vscode.debugPanel",
      decisions: [],
    },
    doctor: {
      kind: "unavailable",
      error: "tan CLI unavailable.",
      detail: "spawn tan ENOENT — distinctive-errno-marker-9f3a",
    },
    preflight: {
      generatedAt: "2026-05-14T00:00:00.000Z",
      targetKind: "native-host",
      server: "none",
      profileId: "native-host-none",
      summary: { pass: 4, warn: 0, fail: 0 },
      checks: [],
      nextSteps: [],
      canLaunch: true,
      configurationGraded: "none",
    },
  });

  assert.match(html, /tan CLI unavailable\./);
  assert.match(html, /spawn tan ENOENT — distinctive-errno-marker-9f3a/);
});
