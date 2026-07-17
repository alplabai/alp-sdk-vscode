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
import { checkE1mCompliance } from "@alp-sdk/core/board/e1mCompliance";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { loadPinmuxTable } from "../pinmux/loader";
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
  detectV2StructuralIssues,
  findTokenRange,
  normalizeProjectSettings,
} from "./service";
import {
  completePrjConf,
  hoverPrjConf,
  isPrjConfPath,
  lintPrjConf,
} from "./kconfig";
import { EMPTY_SDK_CATALOG, SdkCompletionCatalog } from "./sdkCatalog";

const PREVIEW_EFFECTIVE_CONFIG_COMMAND = "alp.lsp.previewEffectiveConfig";

const connection = createConnection(ProposedFeatures.all);
let hasConfigurationCapability = false;
let workspaceFolderPaths: string[] = [];
const documentCache = new Map<string, string>();

// The board.yaml completion catalog (SoM SKUs + libraries). The client pushes it
// from `alp presets` (the single CLI source — see client.ts) via the
// `alp/updateSdkCatalog` notification; before the first push it stays empty and
// completion falls back to the built-in defaults in service.ts.
let sdkCatalog: SdkCompletionCatalog = EMPTY_SDK_CATALOG;

connection.onNotification(
  "alp/updateSdkCatalog",
  (catalog: SdkCompletionCatalog | null) => {
    sdkCatalog = catalog ?? EMPTY_SDK_CATALOG;
  },
);

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

  connection.onDidChangeConfiguration(() => {
    for (const uri of documentCache.keys()) {
      void validateDocument(uri);
    }
  });

  connection.onDidChangeWatchedFiles(() => {
    for (const uri of documentCache.keys()) {
      void validateDocument(uri);
    }
  });

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
    const filePath = uriToFsPath(params.textDocument.uri);
    if (filePath && isPrjConfPath(filePath)) {
      validatePrjConf(params.textDocument.uri, params.textDocument.text);
      return;
    }
    void validateDocument(params.textDocument.uri, params.textDocument.text);
  });

  connection.onDidChangeTextDocument((params) => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath) {
      return;
    }
    // prj.conf: cheap, local lint → re-validate live on every change.
    if (isPrjConfPath(filePath)) {
      const current = getDocumentText(params.textDocument.uri, filePath);
      const updated = applyContentChanges(current, params.contentChanges);
      documentCache.set(params.textDocument.uri, updated);
      validatePrjConf(params.textDocument.uri, updated);
      return;
    }
    if (!isBoardYamlPath(filePath)) {
      return;
    }

    const current = getDocumentText(params.textDocument.uri, filePath);
    const updated = applyContentChanges(current, params.contentChanges);
    documentCache.set(params.textDocument.uri, updated);
  });

  connection.onDidSaveTextDocument((params) => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath) {
      return;
    }
    if (isPrjConfPath(filePath)) {
      const persisted = readDocumentText(filePath);
      documentCache.set(params.textDocument.uri, persisted);
      validatePrjConf(params.textDocument.uri, persisted);
      return;
    }
    if (!isBoardYamlPath(filePath)) {
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
    if (!filePath) {
      return [];
    }
    if (isPrjConfPath(filePath)) {
      const text = getDocumentText(params.textDocument.uri, filePath);
      const linePrefix = lineTextAt(text, params.position.line).slice(
        0,
        params.position.character,
      );
      return completePrjConf(linePrefix).map((c) => ({
        label: c.label,
        insertText: c.insertText,
        detail: c.detail,
        documentation: c.doc,
        kind: CompletionItemKind.Constant,
      }));
    }
    if (!isBoardYamlPath(filePath)) {
      return [];
    }

    const documentText = getDocumentText(params.textDocument.uri, filePath);
    const suggestions = createBoardYamlCompletionSuggestions(
      documentText,
      params.position.line,
      params.position.character,
      sdkCatalog,
    );

    return suggestions.map(toCompletionItem);
  });

  connection.onHover((params): Hover | null => {
    const filePath = uriToFsPath(params.textDocument.uri);
    if (!filePath) {
      return null;
    }
    if (isPrjConfPath(filePath)) {
      const text = getDocumentText(params.textDocument.uri, filePath);
      const word = wordAt(
        text,
        params.position.line,
        params.position.character,
      );
      const markdown = word ? hoverPrjConf(word) : null;
      return markdown
        ? { contents: { kind: MarkupKind.Markdown, value: markdown } }
        : null;
    }
    if (!isBoardYamlPath(filePath)) {
      return null;
    }

    const documentText = getDocumentText(params.textDocument.uri, filePath);
    const hoverInfo = createBoardYamlHoverInfo(
      documentText,
      params.position.line,
      params.position.character,
      sdkCatalog,
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
      readDocumentText,
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

  connection.console.info("Alp SDK language server initialized.");
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
    readDocumentText,
  );

  if (!context.sdkRoot) {
    const v2Issues = detectV2StructuralIssues(documentText);
    connection.sendDiagnostics({
      uri,
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          message:
            "Alp SDK not resolved — full board.yaml validation is disabled. Set alpSdk.path.",
          severity: DiagnosticSeverity.Warning,
          source: "alp-sdk",
        },
        ...createDiagnostics(documentText, v2Issues),
      ],
    });
    return;
  }

  const complianceDiagnostics = createComplianceDiagnostics(
    documentText,
    context.sdkRoot,
  );

  const plan = createValidatorPlan(context, filePath);
  const execution = executeValidatorPlanWithSpawn(context, plan, cp.spawnSync);
  connection.console.log(`$ ${plan.commandLine} (rv=${execution.status})`);

  const validation = analyzeValidationResult(execution);
  const v2Issues = detectV2StructuralIssues(documentText);

  if (validation.outcome === "clean" && v2Issues.length === 0) {
    connection.sendDiagnostics({ uri, diagnostics: complianceDiagnostics });
    return;
  }

  const allIssues = [...validation.issues, ...v2Issues];
  const diagnostics = [
    ...createDiagnostics(documentText, allIssues),
    ...complianceDiagnostics,
  ];
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

function createComplianceDiagnostics(
  documentText: string,
  sdkRoot: string | null | undefined,
): Diagnostic[] {
  if (!sdkRoot) {
    return [];
  }

  let boardConfig;
  try {
    boardConfig = parseBoardConfig(documentText);
  } catch {
    return [];
  }

  // Defense in depth: malformed board.yaml content (e.g. non-array route
  // sections/pins) must never let a compliance-check failure drop the
  // pre-existing Python-validator diagnostics for the whole document.
  try {
    const sku = boardConfig?.som?.sku;
    if (typeof sku !== "string" || !sku) {
      return [];
    }

    const table = loadPinmuxTable(sdkRoot, sku);
    if (!table) {
      return [];
    }

    return checkE1mCompliance(boardConfig, table).map((issue) => ({
      range: findTokenRange(documentText, issue.token),
      message: issue.message,
      severity:
        issue.severity === "error"
          ? DiagnosticSeverity.Error
          : DiagnosticSeverity.Warning,
      source: "alp-sdk",
    }));
  } catch {
    return [];
  }
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
  const edit =
    fix.endLine !== undefined
      ? TextEdit.replace(
          {
            start: { line: fix.line, character: fix.character },
            end: { line: fix.endLine, character: fix.endCharacter ?? 0 },
          },
          fix.newText,
        )
      : TextEdit.insert(
          { line: fix.line, character: fix.character },
          fix.newText,
        );

  return {
    title: fix.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [uri]: [edit],
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

// ── prj.conf (Kconfig fragment) helpers ──────────────────────────────────────

/** Lint a prj.conf and publish the diagnostics. */
function validatePrjConf(uri: string, text: string): void {
  const diagnostics: Diagnostic[] = lintPrjConf(text).map((d) => ({
    range: {
      start: { line: d.line, character: d.startCol },
      end: { line: d.line, character: d.endCol },
    },
    message: d.message,
    severity:
      d.severity === "error"
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
    source: "alp-kconfig",
  }));
  connection.sendDiagnostics({ uri, diagnostics });
}

/** The text of a 0-based line. */
function lineTextAt(text: string, line: number): string {
  return text.split(/\r?\n/)[line] ?? "";
}

/** The CONFIG_ symbol under the cursor on a line, if any. */
function wordAt(text: string, line: number, character: number): string | null {
  const lineText = lineTextAt(text, line);
  const re = /CONFIG_[A-Z0-9_]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(lineText)) !== null) {
    if (
      character >= match.index &&
      character <= match.index + match[0].length
    ) {
      return match[0];
    }
  }
  return null;
}

connection.listen();
