// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    CodeAction,
    CodeActionKind,
    CompletionItem,
    CompletionItemKind,
    createConnection,
    Diagnostic,
    DiagnosticSeverity,
    DidChangeConfigurationNotification,
    DocumentSymbol,
    Hover,
    InitializeParams,
    InitializeResult,
    MarkupKind,
    ProposedFeatures,
    SymbolKind,
    TextDocumentSyncKind,
    TextEdit,
} from "vscode-languageserver/node";
import { resolveProjectContext } from "../project/service";
import { executeValidatorPlanWithSpawn } from "../validation/adapterCore";
import {
    analyzeValidationResult,
    createValidatorPlan,
    isBoardYamlPath,
} from "../validation/service";
import {
    BoardYamlCompletionSuggestion,
    BoardYamlDocumentSymbolNode,
    BoardYamlHoverInfo,
    BoardYamlQuickFix,
    createBoardYamlCompletionSuggestions,
    createBoardYamlDocumentSymbols,
    createBoardYamlHoverInfo,
    createBoardYamlQuickFixes,
    createIssueRange,
    normalizeProjectSettings,
} from "./service";

const connection = createConnection(ProposedFeatures.all);
let hasConfigurationCapability = false;
let workspaceFolderPaths: string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = Boolean(
    params.capabilities.workspace?.configuration,
  );
  workspaceFolderPaths = (params.workspaceFolders ?? [])
    .map((folder) => uriToFsPath(folder.uri))
    .filter((path): path is string => Boolean(path));

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      completionProvider: {
        resolveProvider: false,
      },
      hoverProvider: true,
      documentSymbolProvider: true,
      codeActionProvider: true,
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    void connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
  }

  connection.workspace.onDidChangeWorkspaceFolders((event) => {
    const removed = new Set(
      event.removed
        .map((folder) => uriToFsPath(folder.uri))
        .filter((path): path is string => Boolean(path)),
    );

    workspaceFolderPaths = workspaceFolderPaths.filter(
      (folderPath) => !removed.has(folderPath),
    );

    for (const folder of event.added) {
      const folderPath = uriToFsPath(folder.uri);
      if (folderPath && !workspaceFolderPaths.includes(folderPath)) {
        workspaceFolderPaths.push(folderPath);
      }
    }
  });

  connection.onDidOpenTextDocument((params) => {
    void validateDocument(params.textDocument.uri);
  });

  connection.onDidSaveTextDocument((params) => {
    void validateDocument(params.textDocument.uri);
  });

  connection.onDidCloseTextDocument((params) => {
    connection.sendDiagnostics({
      uri: params.textDocument.uri,
      diagnostics: [],
    });
  });

  connection.onCompletion((params): CompletionItem[] => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return [];
    }

    const documentText = readDocumentText(filePath);
    const suggestions = createBoardYamlCompletionSuggestions(
      documentText,
      params.position.line,
      params.position.character,
    );

    return suggestions.map(toCompletionItem);
  });

  connection.onHover((params): Hover | null => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return null;
    }

    const documentText = readDocumentText(filePath);
    const hoverInfo = createBoardYamlHoverInfo(
      documentText,
      params.position.line,
      params.position.character,
    );

    if (!hoverInfo) {
      return null;
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: formatHoverMarkdown(hoverInfo),
      },
    };
  });

  connection.onDocumentSymbol((params): DocumentSymbol[] => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return [];
    }

    const documentText = readDocumentText(filePath);
    return createBoardYamlDocumentSymbols(documentText).map(toDocumentSymbol);
  });

  connection.onCodeAction((params): CodeAction[] => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return [];
    }

    const documentText = readDocumentText(filePath);
    const actions: CodeAction[] = [];
    const seenTitles = new Set<string>();

    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.source !== "alp-sdk") {
        continue;
      }

      for (const fix of createBoardYamlQuickFixes(
        documentText,
        diagnostic.message,
      )) {
        if (seenTitles.has(fix.title)) {
          continue;
        }

        seenTitles.add(fix.title);
        actions.push(toCodeAction(params.textDocument.uri, diagnostic, fix));
      }
    }

    return actions;
  });

  connection.console.info("ALP SDK language server initialized.");
});

async function validateDocument(uri: string): Promise<void> {
  const filePath = uriToFsPath(uri);
  if (!filePath || !isBoardYamlPath(filePath)) {
    return;
  }

  const settings = await readProjectSettings(uri);
  const context = resolveProjectContext(
    {
      workspaceFolders: workspaceFolderPaths,
      settings,
      platform: process.platform,
    },
    fs.existsSync,
  );

  if (!context.sdkRoot) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  const plan = createValidatorPlan(context, filePath);
  const execution = executeValidatorPlanWithSpawn(context, plan, cp.spawnSync);
  connection.console.log(`$ ${plan.commandLine} (rv=${execution.status})`);

  const validation = analyzeValidationResult(execution);
  if (validation.outcome === "clean") {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  const diagnostics = createDiagnostics(filePath, validation.issues);
  connection.sendDiagnostics({ uri, diagnostics });
}

function createDiagnostics(
  filePath: string,
  issues: ReadonlyArray<{ message: string; severity: "warning" | "error" }>,
): Diagnostic[] {
  const documentText = readDocumentText(filePath);

  return issues.map((issue) => ({
    range: createIssueRange(documentText, issue.message),
    message: issue.message,
    severity:
      issue.severity === "warning"
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error,
    source: "alp-sdk",
  }));
}

function readDocumentText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function toCompletionItem(
  suggestion: BoardYamlCompletionSuggestion,
): CompletionItem {
  return {
    label: suggestion.label,
    insertText: suggestion.insertText,
    detail: suggestion.detail,
    kind:
      suggestion.kind === "key"
        ? CompletionItemKind.Field
        : CompletionItemKind.Value,
  };
}

function formatHoverMarkdown(hoverInfo: BoardYamlHoverInfo): string {
  const lines = [`**${hoverInfo.title}**`, hoverInfo.description];
  if (hoverInfo.defaultValue) {
    lines.push(`Default: ${hoverInfo.defaultValue}`);
  }

  if (hoverInfo.allowedValues && hoverInfo.allowedValues.length > 0) {
    lines.push(`Allowed: ${hoverInfo.allowedValues.join(", ")}`);
  }

  return lines.join("\n\n");
}

function toDocumentSymbol(node: BoardYamlDocumentSymbolNode): DocumentSymbol {
  const selectionCharacterEnd = node.start.character + node.name.length;
  return {
    name: node.name,
    detail: node.path,
    kind: node.children.length > 0 ? SymbolKind.Object : SymbolKind.Property,
    range: {
      start: node.start,
      end: node.end,
    },
    selectionRange: {
      start: node.start,
      end: {
        line: node.start.line,
        character: selectionCharacterEnd,
      },
    },
    children: node.children.map(toDocumentSymbol),
  };
}

function toCodeAction(
  uri: string,
  diagnostic: Diagnostic,
  fix: BoardYamlQuickFix,
): CodeAction {
  return {
    title: fix.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [uri]: [
          TextEdit.insert(
            { line: fix.line, character: fix.character },
            fix.newText,
          ),
        ],
      },
    },
  };
}

async function readProjectSettings(resourceUri: string) {
  if (!hasConfigurationCapability) {
    return normalizeProjectSettings(undefined);
  }

  const config = await connection.workspace.getConfiguration({
    scopeUri: resourceUri,
    section: "alpSdk",
  });
  return normalizeProjectSettings(config);
}

function uriToFsPath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") {
      return null;
    }

    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

connection.listen();
