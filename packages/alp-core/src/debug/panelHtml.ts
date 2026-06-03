// SPDX-License-Identifier: Apache-2.0

import {
  DebugGenerationTraceReport,
  DebugInspectReport,
  DebugPreflightReport,
  DebugServerKind,
  DebugTargetKind,
  DoctorReport,
} from "./models";

export interface DebugTroubleshootingPanelHtmlInput {
  cspSource: string;
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  inspect: DebugInspectReport;
  trace: DebugGenerationTraceReport;
  doctor: DoctorReport;
  preflight: DebugPreflightReport;
}

export function createDebugTroubleshootingPanelHtml(
  input: DebugTroubleshootingPanelHtmlInput,
): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${input.cspSource}; ` +
    `font-src ${input.cspSource};`;

  const inspectRows = input.inspect.resolvedValues
    .map(
      (value) =>
        `<tr><td>${escapeHtml(value.key)}</td><td>${escapeHtml(String(value.source))}</td><td>${escapeHtml(formatValue(value.value))}</td></tr>`,
    )
    .join("\n");

  const traceRows = input.trace.decisions
    .map(
      (decision) =>
        `<tr><td>${escapeHtml(decision.key)}</td><td>${escapeHtml(decision.outcome)}</td><td>${escapeHtml(decision.outputPath ?? "-")}</td><td>${escapeHtml(decision.detail)}</td></tr>`,
    )
    .join("\n");

  const doctorRows = input.doctor.checks
    .map(
      (check) =>
        `<tr><td>${escapeHtml(check.name)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.detail)}</td></tr>`,
    )
    .join("\n");

  const preflightRows = input.preflight.checks
    .map(
      (check) =>
        `<tr><td>${escapeHtml(check.name)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.detail)}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ALP Troubleshooting</title>
</head>
<body>
  <h1>ALP Troubleshooting Panel</h1>
  <p>Generated at ${escapeHtml(input.generatedAt)} for target ${escapeHtml(input.targetKind)} with server ${escapeHtml(input.server)}.</p>

  <h2>Quick Actions</h2>
  <ul>
    <li><a href="command:alp.inspectProjectState">Run Inspect (JSON)</a></li>
    <li><a href="command:alp.debugDoctor">Run Doctor (JSON)</a></li>
    <li><a href="command:alp.debugPreflight">Run Preflight (JSON)</a></li>
    <li><a href="command:alp.configureDebugProfile">Write launch.json profile</a></li>
    <li><a href="command:alp.exportSupportBundle">Export support bundle</a></li>
    <li><a href="command:alp.openDebugTroubleshootingPanel">Refresh panel</a></li>
  </ul>

  <h2>Inspect: Effective Resolved Values</h2>
  <table>
    <thead><tr><th>Key</th><th>Source</th><th>Value</th></tr></thead>
    <tbody>
${inspectRows}
    </tbody>
  </table>

  <h2>Trace: Generation Decisions</h2>
  <table>
    <thead><tr><th>Decision</th><th>Outcome</th><th>Output</th><th>Detail</th></tr></thead>
    <tbody>
${traceRows}
    </tbody>
  </table>

  <h2>Environment: Doctor Summary</h2>
  <p>pass=${input.doctor.summary.pass} warn=${input.doctor.summary.warn} fail=${input.doctor.summary.fail}</p>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
${doctorRows}
    </tbody>
  </table>

  <h2>Preflight Summary</h2>
  <p>pass=${input.preflight.summary.pass} warn=${input.preflight.summary.warn} fail=${input.preflight.summary.fail} canLaunch=${input.preflight.canLaunch}</p>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
${preflightRows}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "<undefined>";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}
