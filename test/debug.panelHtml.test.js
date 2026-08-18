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

// #474 — the doctor table parsed the envelope's per-check `fix` and its
// report-level `nextSteps` and then dropped both, so the panel told a blocked
// customer WHAT was wrong and never what to do about it.
//
// Fixture values are the real strings the pinned tan 0.5.1 emits, on purpose:
// `--sdk-root <path>` carries a `<path>` that an unescaped render lets a
// browser eat as a tag, which would silently delete the useful half of the
// remediation. Escaping is asserted, not assumed.
function panelWithDoctorEnvelope(data) {
  return createDebugTroubleshootingPanelHtml({
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
    doctor: { kind: "envelope", data },
    preflight: {
      generatedAt: "2026-05-14T00:00:00.000Z",
      targetKind: "native-host",
      server: "none",
      profileId: "native-host-none",
      summary: { pass: 0, warn: 0, fail: 0 },
      checks: [],
      nextSteps: [],
      canLaunch: true,
      configurationGraded: "none",
    },
  });
}

test("#474 a check's `fix` renders verbatim, and an absent one renders no filler", () => {
  const html = panelWithDoctorEnvelope({
    summary: { pass: 1, warn: 0, fail: 1 },
    checks: [
      {
        name: "sdk",
        status: "fail",
        detail: "no SDK selected",
        fix: "--sdk-root <path>",
      },
      // Measured on the pinned tan 0.5.1: 10 of 14 checks carry no `fix` at
      // all (11 of 14 with a project). No check emits an explicit `fix: null`
      // there — that shape is type-declared, not observed — so it is covered
      // here deliberately rather than because tan produces it today.
      {
        name: "homePath",
        status: "pass",
        detail: "Home directory has no spaces",
      },
      { name: "hostPython", status: "pass", detail: "Python 3.14", fix: null },
    ],
  });

  // Verbatim, and ESCAPED: `<path>` must survive as text, not be parsed as a tag.
  assert.match(html, /--sdk-root &lt;path&gt;/);
  assert.doesNotMatch(html, /--sdk-root <path>/);

  // No filler for the two checks without one. Their rows end on an empty cell.
  assert.match(
    html,
    /<td>homePath<\/td><td>pass<\/td><td>Home directory has no spaces<\/td><td><\/td>/,
  );
  assert.match(
    html,
    /<td>hostPython<\/td><td>pass<\/td><td>Python 3\.14<\/td><td><\/td>/,
  );
  // Nothing that reads as advice stood in for the missing value. Scoped to the
  // doctor rows on purpose: the TRACE table above renders `-` for an absent
  // `outputPath`, so a document-wide negative would pass or fail for reasons
  // that have nothing to do with this column.
  for (const row of html.match(
    /<tr><td>(?:homePath|hostPython)<\/td>[^\n]*/g,
  ) ?? []) {
    assert.doesNotMatch(row, /no fix available|n\/a|<td>-<\/td>/);
  }
});

test("#474 `data.nextSteps` renders when present, and nothing at all when it is not", () => {
  const withSteps = panelWithDoctorEnvelope({
    summary: { pass: 0, warn: 1, fail: 0 },
    checks: [{ name: "jlink", status: "warn", detail: "JLink not probed" }],
    nextSteps: [
      "Run `JLinkExe -?` by hand and confirm the banner reports V9.46 or newer.",
      "Select a project with `--project <dir>` (or `--board-yaml <path>`) to check one.",
    ],
  });

  assert.match(withSteps, /Next steps/);
  assert.match(
    withSteps,
    /Run `JLinkExe -\?` by hand and confirm the banner reports V9\.46 or newer\./,
  );
  // Escaped here too — this one carries `<dir>` and `<path>`.
  assert.match(withSteps, /--project &lt;dir&gt;/);
  assert.match(withSteps, /--board-yaml &lt;path&gt;/);

  // Absent and empty both render nothing — not an empty heading.
  for (const data of [
    { summary: { pass: 1, warn: 0, fail: 0 }, checks: [] },
    { summary: { pass: 1, warn: 0, fail: 0 }, checks: [], nextSteps: [] },
    { summary: { pass: 1, warn: 0, fail: 0 }, checks: [], nextSteps: null },
  ]) {
    assert.doesNotMatch(panelWithDoctorEnvelope(data), /Next steps/);
  }
});

test("#474 nothing renders `data.missingPrerequisites` here — that is #347's structured route", () => {
  const html = panelWithDoctorEnvelope({
    summary: { pass: 0, warn: 1, fail: 0 },
    checks: [{ name: "ninja", status: "warn", detail: "Ninja not found" }],
    missingPrerequisites: [
      { tool: "distinctive-tool-marker-7c1e", command: "brew install ninja" },
    ],
  });

  // Positive first: without it this test also passes against a renderer that
  // emits no doctor section at all.
  assert.match(html, /<td>ninja<\/td><td>warn<\/td><td>Ninja not found<\/td>/);
  assert.doesNotMatch(html, /distinctive-tool-marker-7c1e/);
  assert.doesNotMatch(html, /brew install ninja/);
});

test("#474 a nextStep that merely repeats a check's fix is not printed twice", () => {
  // Measured on the pinned tan 0.5.1: `data.nextSteps` is byte-identical to the
  // ordered non-null `check.fix` values, so rendering both verbatim doubles
  // every remediation — a 257-character paragraph included.
  const html = panelWithDoctorEnvelope({
    summary: { pass: 0, warn: 1, fail: 1 },
    checks: [
      {
        name: "sdk",
        status: "fail",
        detail: "no SDK selected",
        fix: "--sdk-root <path>",
      },
      { name: "jlink", status: "warn", detail: "JLink not probed" },
    ],
    nextSteps: [
      "--sdk-root <path>",
      "Run `JLinkExe -?` by hand and confirm the banner reports V9.46 or newer.",
    ],
  });

  // The duplicate appears exactly once, in the Fix cell.
  assert.equal(html.match(/--sdk-root &lt;path&gt;/g)?.length, 1);
  // The step that is NOT also a fix still reaches the list.
  assert.match(html, /<li>Run `JLinkExe -\?`/);
});

test("#474 an all-duplicate nextSteps list renders no heading at all", () => {
  const html = panelWithDoctorEnvelope({
    summary: { pass: 0, warn: 0, fail: 1 },
    checks: [
      {
        name: "sdk",
        status: "fail",
        detail: "no SDK selected",
        fix: "--sdk-root <path>",
      },
    ],
    nextSteps: ["--sdk-root <path>"],
  });

  assert.doesNotMatch(html, /Next steps/);
  assert.equal(html.match(/--sdk-root &lt;path&gt;/g)?.length, 1);
});
