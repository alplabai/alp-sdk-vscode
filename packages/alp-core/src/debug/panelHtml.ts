// SPDX-License-Identifier: Apache-2.0

import {
  DebugDoctorSection,
  DebugGenerationTraceReport,
  DebugInspectReport,
  DebugPreflightReport,
  DebugServerKind,
  DebugTargetKind,
} from "./models";

export interface DebugTroubleshootingPanelHtmlInput {
  cspSource: string;
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  inspect: DebugInspectReport;
  trace: DebugGenerationTraceReport;
  doctor: DebugDoctorSection;
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

  // #474: the envelope carries a per-check `fix` and a report-level
  // `nextSteps`, and this table parsed both and then dropped them — so the
  // panel told a blocked customer WHAT was wrong and never what to do about
  // it, with the answer sitting in the payload it had just read.
  //
  // Both are PROSE from tan, rendered verbatim and never parsed — the rule
  // commit e359d37 (#347) set. That is also why `data.missingPrerequisites`
  // is deliberately NOT rendered here: it is the structured per-tool route
  // for a different surface, and folding it into this column would blur the
  // one boundary #347 exists to keep.
  //
  // An absent `fix` renders an EMPTY cell — not the `"-"` the trace table
  // above uses for an absent path. This column is remediation text, so a
  // filler glyph in it reads as advice. `fix` is optional AND nullable on the
  // wire (4 of 14 checks carry one on the pinned tan 0.5.1), so both cases
  // land here.
  // Measured on the pinned tan 0.5.1: `data.nextSteps` is byte-identical to
  // the ordered list of non-null `check.fix` values (4 and 4, identical). So
  // rendering both verbatim prints every remediation TWICE — including a
  // 257-character `pythonFloor` paragraph, in a table this panel gives no
  // `<style>` block, where one such cell dominates the column widths.
  //
  // So the list carries only what the Fix column does not already show. On
  // today's tan that filters to nothing and no heading renders at all; the
  // section appears when tan emits a report-level step that is not also some
  // check's fix, which the envelope permits and nothing guarantees against.
  // Deduplicating is the point — a customer must see each remediation, once.
  const doctorFixValues =
    input.doctor.kind === "envelope"
      ? new Set(
          input.doctor.data.checks
            .map((check) => check.fix)
            .filter((fix): fix is string => typeof fix === "string"),
        )
      : new Set<string>();
  const remainingNextSteps =
    input.doctor.kind === "envelope"
      ? (input.doctor.data.nextSteps ?? []).filter(
          (step) => !doctorFixValues.has(step),
        )
      : [];
  const doctorNextSteps = remainingNextSteps.length
    ? `
  <h3>Next steps</h3>
  <ul>
${remainingNextSteps.map((step) => `      <li>${escapeHtml(step)}</li>`).join("\n")}
  </ul>`
    : "";

  const doctorSection =
    input.doctor.kind === "envelope"
      ? `  <p>pass=${input.doctor.data.summary.pass} warn=${input.doctor.data.summary.warn} fail=${input.doctor.data.summary.fail}</p>
  <table>
    <thead><tr><th>Check</th><th>Status</th><th>Detail</th><th>Fix</th></tr></thead>
    <tbody>
${input.doctor.data.checks
  .map(
    (check) =>
      `<tr><td>${escapeHtml(check.name)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.detail)}</td><td>${escapeHtml(check.fix ?? "")}</td></tr>`,
  )
  .join("\n")}
    </tbody>
  </table>${doctorNextSteps}`
      : // Exactly ONE message where the table was (#376) — never a second,
        // in-process doctor rendered in its place. `detail`, when the
        // resolver had one, is the raw diagnosis behind `error` — safe here
        // (this panel is channel-grade text, unlike a toast) and the whole
        // reason a customer reading it can tell WHY tan was unresolvable.
        `  <p>${escapeHtml(input.doctor.error)}</p>` +
        (input.doctor.detail
          ? `\n  <p>${escapeHtml(input.doctor.detail)}</p>`
          : "");

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
  <title>Alp Troubleshooting</title>
</head>
<body>
  <h1>Alp Troubleshooting Panel</h1>
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
${doctorSection}

  <h2>Preflight Summary</h2>
  <p>pass=${input.preflight.summary.pass} warn=${input.preflight.summary.warn} fail=${input.preflight.summary.fail} canLaunch=${input.preflight.canLaunch} configurationGraded=${input.preflight.configurationGraded}</p>
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
