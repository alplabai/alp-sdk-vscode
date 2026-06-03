// SPDX-License-Identifier: Apache-2.0

import {
  analyzeValidationResult,
  createValidatorPlan,
  isBoardYamlPath,
} from "@alp-sdk/core/validation/service";
import * as vscode from "vscode";
import { log } from "./util";
import {
  collectValidationWorkspaceContext,
  executeValidatorPlan,
} from "./validation/vscodeAdapter";

/**
 * Surfaces `validate_board_yaml.py` failures as inline diagnostics
 * on the active board.yaml file -- the same content the *Alp:
 * Validate board.yaml* command writes to the output channel, but
 * pinned to the editor so they appear in the Problems panel and
 * as a squiggle on the document.
 *
 * Trigger points: every save + every open of a file named
 * `board.yaml`.  The validator runs in <100 ms locally so this is
 * cheap; if it ever isn't, we'll debounce or move to onWillSave.
 *
 * The Red Hat YAML extension we depend on already covers JSON-
 * Schema violations as inline diagnostics; this layer adds the
 * checks the schema can't express -- missing SoM preset, missing
 * carrier preset without inline `populated`, and the v0.3
 * hw_rev / SDK-version compatibility window.
 *
 * Line ranges: the legacy validator emits `FAIL <category>: <message>`
 * without column info, so those attach to line 1.  The rich ALP-B*
 * validator (`alp_cli/validator.py`) includes file:line:col coordinates
 * and diagnostic codes (ALP-B001..B010) that appear as clickable links
 * in the Problems panel.  The `suggestion` severity maps to
 * `DiagnosticSeverity.Information` (blue underline) in VS Code.
 */

function isBoardYaml(doc: vscode.TextDocument): boolean {
  return isBoardYamlPath(doc.uri.fsPath);
}

function validate(
  doc: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  if (!isBoardYaml(doc)) return;
  const project = collectValidationWorkspaceContext();
  if (!project.sdkRoot) {
    collection.delete(doc.uri);
    return;
  }
  const plan = createValidatorPlan(project, doc.uri.fsPath);
  const execution = executeValidatorPlan(project, plan);
  log(`$ ${plan.commandLine} (rv=${execution.status})`);

  const validation = analyzeValidationResult(execution);
  if (validation.outcome === "clean") {
    collection.delete(doc.uri);
    return;
  }

  const range = new vscode.Range(0, 0, 0, doc.lineAt(0).text.length);
  const diags = validation.issues.map((issue) => {
    // Use pinpointed location when the rich validator provides line/col.
    const diagRange =
      issue.line !== undefined && issue.col !== undefined
        ? (() => {
            const zeroLine = issue.line! - 1;
            const zeroCol = issue.col! - 1;
            const lineText =
              zeroLine < doc.lineCount ? doc.lineAt(zeroLine).text : "";
            return new vscode.Range(
              zeroLine,
              zeroCol,
              zeroLine,
              lineText.length,
            );
          })()
        : range;

    const diag = new vscode.Diagnostic(
      diagRange,
      issue.message,
      issue.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : issue.severity === "suggestion"
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Error,
    );

    if (issue.code) {
      diag.code = {
        value: issue.code,
        target: vscode.Uri.parse(
          `https://github.com/alplabai/alp-sdk/blob/main/docs/diagnostics/${issue.code}.md`,
        ),
      };
    }
    return diag;
  });
  collection.set(doc.uri, diags);
}

export function registerDiagnostics(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection("alp-sdk");
  context.subscriptions.push(collection);

  // Validate on open + save + the active editor's initial focus,
  // so the first time the user touches board.yaml the Problems
  // panel reflects current state.
  const disposables: vscode.Disposable[] = [
    vscode.workspace.onDidOpenTextDocument((doc) => validate(doc, collection)),
    vscode.workspace.onDidSaveTextDocument((doc) => validate(doc, collection)),
  ];
  for (const editor of vscode.window.visibleTextEditors) {
    validate(editor.document, collection);
  }

  return vscode.Disposable.from(...disposables, collection);
}
