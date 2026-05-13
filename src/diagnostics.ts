// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { log } from "./util";
import {
    analyzeValidationResult,
    createValidatorPlan,
    isBoardYamlPath,
} from "./validation/service";
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
 * Line ranges: the validator emits text like
 *     `FAIL som preset: no preset for E1M-NX9999 at ...`
 * without a column.  We attach all entries to line 1 of the
 * document so the user gets a Problems-panel summary; opening the
 * file shows a single squiggle on the first line linking to the
 * full text.  Targeted ranges per field land in v0.4 when we add
 * a YAML AST parser (js-yaml-ast or similar) to map field paths.
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

  // Pin everything to line 0 -- columnless validator output, so a
  // single squiggle on the first line is the honest representation.
  const range = new vscode.Range(0, 0, 0, doc.lineAt(0).text.length);
  const diags = validation.issues.map(
    (issue) =>
      new vscode.Diagnostic(
        range,
        issue.message,
        issue.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error,
      ),
  );
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
