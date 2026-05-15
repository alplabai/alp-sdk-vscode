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
  TextDocumentContentChangeEvent,
  TextDocumentSyncKind,
  TextEdit,
} from "vscode-languageserver/node";
import { resolveProjectContext } from "@alp-sdk/core/project/service";
import { executeValidatorPlanWithSpawn } from "@alp-sdk/core/validation/adapterCore";
import {
  analyzeValidationResult,
  createValidatorPlan,
  isBoardYamlPath,
} from "@alp-sdk/core/validation/service";
import {
  BoardYamlCompletionSuggestion,
  BoardYamlDocumentSymbolNode,
  BoardYamlHoverInfo,
  BoardYamlQuickFix,
  createBoardYamlCompletionSuggestions,
  createBoardYamlDocumentSymbols,
  createBoardYamlHoverInfo,
  createBoardYamlQuickFixes,
  createDiagnosticMessageWithContext,
  createEffectiveConfigPreviewPayload,
  createIssueRange,
  normalizeProjectSettings,
} from "./service";

const PREVIEW_EFFECTIVE_CONFIG_COMMAND = "alp.lsp.previewEffectiveConfig";

const connection = createConnection(ProposedFeatures.all);
let hasConfigurationCapability = false;
let workspaceFolderPaths: string[] = [];
const documentCache = new Map<string, string>();

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
      executeCommandProvider: {
        commands: [PREVIEW_EFFECTIVE_CONFIG_COMMAND],
      },
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
    documentCache.set(params.textDocument.uri, params.textDocument.text);
    void validateDocument(params.textDocument.uri, params.textDocument.text);
  });

  connection.onDidChangeTextDocument((params) => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return;
    }

    const current = getDocumentText(params.textDocument.uri, filePath);
    const updated = applyContentChanges(current, params.contentChanges);
    documentCache.set(params.textDocument.uri, updated);
  });

  connection.onDidSaveTextDocument((params) => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return;
    }

    const persisted = readDocumentText(filePath);
    documentCache.set(params.textDocument.uri, persisted);
    void validateDocument(params.textDocument.uri, persisted);
  });

  connection.onDidCloseTextDocument((params) => {
    documentCache.delete(params.textDocument.uri);
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

    const documentText = getDocumentText(params.textDocument.uri, filePath);
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

    const documentText = getDocumentText(params.textDocument.uri, filePath);
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

    const documentText = getDocumentText(params.textDocument.uri, filePath);
    return createBoardYamlDocumentSymbols(documentText).map(toDocumentSymbol);
  });

  connection.onCodeAction((params): CodeAction[] => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return [];
    }

    const documentText = getDocumentText(params.textDocument.uri, filePath);
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

  connection.onExecuteCommand(async (params) => {
    if (params.command !== PREVIEW_EFFECTIVE_CONFIG_COMMAND) {
      return null;
    }

    const resourceUri =
      typeof params.arguments?.[0] === "string" ? params.arguments[0] : null;
    if (!resourceUri) {
      return {
        schemaVersion: "1",
        ok: false,
        error: "Missing board.yaml URI argument.",
      };
    }

    const filePath = uriToFsPath(resourceUri);
    if (!filePath || !isBoardYamlPath(filePath)) {
      return {
        schemaVersion: "1",
        ok: false,
        error: "The provided URI is not a board.yaml file.",
      };
    }

    const documentText = readDocumentText(filePath);
    const settings = await readProjectSettings(resourceUri);
    const projectContext = resolveProjectContext(
      {
        workspaceFolders: workspaceFolderPaths,
        settings,
        platform: process.platform,
      },
      fs.existsSync,
    );

    return {
      ok: true,
      ...createEffectiveConfigPreviewPayload(
        documentText,
        filePath,
        projectContext,
      ),
    };
  });

  connection.console.info("ALP SDK language server initialized.");
});

async function validateDocument(
  uri: string,
  documentTextOverride?: string,
): Promise<void> {
  const filePath = uriToFsPath(uri);
  if (!filePath || !isBoardYamlPath(filePath)) {
    return;
  }

  const documentText = documentTextOverride ?? getDocumentText(uri, filePath);

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

  const diagnostics = createDiagnostics(documentText, validation.issues);
  connection.sendDiagnostics({ uri, diagnostics });
}

function createDiagnostics(
  documentText: string,
  issues: ReadonlyArray<{
    message: string;
    severity: "warning" | "error" | "suggestion";
  }>,
): Diagnostic[] {
  return issues.map((issue) => ({
    range: createIssueRange(documentText, issue.message),
    message: createDiagnosticMessageWithContext(issue.message, documentText),
    severity: mapDiagnosticSeverity(issue.severity),
    source: "alp-sdk",
  }));
}

function mapDiagnosticSeverity(
  severity: "warning" | "error" | "suggestion",
): DiagnosticSeverity {
  switch (severity) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "suggestion":
      return DiagnosticSeverity.Hint;
    case "error":
    default:
      return DiagnosticSeverity.Error;
  }
}

function readDocumentText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function getDocumentText(uri: string, filePath: string): string {
  return documentCache.get(uri) ?? readDocumentText(filePath);
}

function applyContentChanges(
  currentText: string,
  changes: readonly TextDocumentContentChangeEvent[],
): string {
  let text = currentText;

  for (const change of changes) {
    if (!("range" in change) || !change.range) {
      text = change.text;
      continue;
    }

    const startOffset = offsetAt(
      text,
      change.range.start.line,
      change.range.start.character,
    );
    const endOffset = offsetAt(
      text,
      change.range.end.line,
      change.range.end.character,
    );

    const safeStart = Math.max(0, Math.min(startOffset, text.length));
    const safeEnd = Math.max(safeStart, Math.min(endOffset, text.length));
    text = `${text.slice(0, safeStart)}${change.text}${text.slice(safeEnd)}`;
  }

  return text;
}

function offsetAt(text: string, line: number, character: number): number {
  let offset = 0;
  let currentLine = 0;

  while (currentLine < line && offset < text.length) {
    const nextNewline = text.indexOf("\n", offset);
    if (nextNewline < 0) {
      return text.length;
    }

    offset = nextNewline + 1;
    currentLine += 1;
  }

  return Math.min(text.length, offset + Math.max(0, character));
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
