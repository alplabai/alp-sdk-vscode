// SPDX-License-Identifier: Apache-2.0

import {
  normalizeBoardModel,
  parseBoardModel,
} from "@alp-sdk/core/configurator/service";
import { ProjectContext, ProjectSettings } from "@alp-sdk/core/project/models";
import type { SdkCompletionCatalog } from "./sdkCatalog";

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  sdkPath: "",
  pythonPath: "",
  boardYamlPath: "board.yaml",
  westCwd: "",
};

export interface LineZeroRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface BoardYamlCompletionSuggestion {
  label: string;
  insertText: string;
  detail: string;
  kind: "key" | "value";
}

export interface BoardYamlHoverInfo {
  title: string;
  description: string;
  defaultValue?: string;
  allowedValues?: readonly string[];
}

export interface BoardYamlDocumentSymbolNode {
  name: string;
  path: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
  children: BoardYamlDocumentSymbolNode[];
}

export interface BoardYamlQuickFix {
  title: string;
  line: number;
  character: number;
  newText: string;
  /** If defined, replaces [line:character..endLine:endCharacter] instead of inserting. */
  endLine?: number;
  endCharacter?: number;
}

/** Diagnostic message emitted when a v2 document still has a top-level `os:` key. */
export const V2_LEGACY_OS_FIELD_MSG =
  "board.yaml v2: top-level 'os:' is not supported; move it into a 'cores:' block";

export interface EffectiveConfigPreviewPayload {
  schemaVersion: "1";
  generatedAt: string;
  boardYamlPath: string;
  projectContext: ProjectContext;
  effectiveConfig: unknown;
}

const ISSUE_KEY_ALIASES: ReadonlyArray<{
  pattern: RegExp;
  keys: readonly string[];
}> = [
  {
    pattern: /\bsom\b/i,
    keys: ["som", "som_preset", "som-preset", "som_variant", "som-variant"],
  },
  {
    pattern: /\bcarrier\b/i,
    keys: ["carrier", "carrier_preset", "carrier-preset"],
  },
  {
    pattern: /\bhw[\s_-]*rev\b/i,
    keys: ["hw_rev", "hw-rev"],
  },
  {
    pattern: /\bsku\b/i,
    keys: ["sku"],
  },
  {
    pattern: /\bos\b/i,
    keys: ["os"],
  },
];

const TOP_LEVEL_KEYS: readonly string[] = [
  "schema_version",
  "som",
  "carrier",
  "os",
  "inference",
  "libraries",
  "iot",
  "diagnostics",
];
const TOP_LEVEL_KEYS_V2: readonly string[] = [
  "schema_version",
  "som",
  "carrier",
  "cores",
  "ipc",
  "inference",
  "libraries",
  "iot",
  "diagnostics",
];

const CHILD_KEYS: Readonly<Record<string, readonly string[]>> = {
  som: ["sku"],
  carrier: ["name", "populated"],
  inference: ["backend", "default_arena_kib"],
  iot: ["wifi", "mqtt", "ble", "tls"],
  diagnostics: ["last_error", "log_level"],
  "carrier.populated": ["wifi", "mqtt", "ble", "tls"],
};

const VALUE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  os: ["zephyr", "yocto", "baremetal"],
  "som.sku": ["E1M-AEN701"],
  "carrier.name": ["E1M-EVK"],
  "inference.backend": ["auto", "cpu", "ethos_u", "drpai", "deepx_dx"],
  "diagnostics.log_level": ["error", "warn", "info", "debug", "trace"],
  "diagnostics.last_error": ["true", "false"],
  "iot.wifi": ["true", "false"],
  "iot.mqtt": ["true", "false"],
  "iot.ble": ["true", "false"],
  "iot.tls": ["true", "false"],
  "carrier.populated.wifi": ["true", "false"],
  "carrier.populated.mqtt": ["true", "false"],
  "carrier.populated.ble": ["true", "false"],
  "carrier.populated.tls": ["true", "false"],
  "libraries[]": [
    "etl",
    "fmt",
    "nlohmann_json",
    "doctest",
    "lvgl",
    "mbedtls",
    "cmsis_dsp",
    "littlefs",
  ],
};

const FIELD_DOCS: Readonly<Record<string, BoardYamlHoverInfo>> = {
  schema_version: {
    title: "schema_version",
    description:
      "Board configuration schema version. Use 2 for heterogeneous multi-core boards.",
    defaultValue: "1",
  },
  cores: {
    title: "cores",
    description:
      "Per-core OS and application configuration block (schema v2). Keys are core IDs from the SoM topology (e.g. a55_cluster, m33_sm, m55_hp).",
  },
  ipc: {
    title: "ipc",
    description:
      "IPC shared-memory carve-out list (schema v2). Each entry names a carve-out, its endpoints, and size in KiB.",
  },
  som: {
    title: "som",
    description: "System-on-module settings block.",
  },
  "som.sku": {
    title: "som.sku",
    description: "Selected SoM preset identifier.",
    defaultValue: "E1M-AEN701",
    allowedValues: VALUE_CHOICES["som.sku"],
  },
  carrier: {
    title: "carrier",
    description: "Carrier-board settings block.",
  },
  "carrier.name": {
    title: "carrier.name",
    description: "Selected carrier preset name.",
    defaultValue: "E1M-EVK",
    allowedValues: VALUE_CHOICES["carrier.name"],
  },
  "carrier.populated": {
    title: "carrier.populated",
    description: "Populated optional peripherals on the selected carrier.",
  },
  os: {
    title: "os",
    description: "Target operating system for generated artifacts.",
    defaultValue: "zephyr",
    allowedValues: VALUE_CHOICES.os,
  },
  inference: {
    title: "inference",
    description: "Inference runtime and memory configuration.",
  },
  "inference.backend": {
    title: "inference.backend",
    description: "Preferred inference backend.",
    defaultValue: "auto",
    allowedValues: VALUE_CHOICES["inference.backend"],
  },
  "inference.default_arena_kib": {
    title: "inference.default_arena_kib",
    description: "Default tensor arena size in KiB.",
  },
  libraries: {
    title: "libraries",
    description: "Optional libraries enabled for the build.",
  },
  "libraries[]": {
    title: "libraries[]",
    description: "A library entry enabled under libraries list.",
    allowedValues: VALUE_CHOICES["libraries[]"],
  },
  iot: {
    title: "iot",
    description: "IoT feature toggle block.",
  },
  "iot.wifi": {
    title: "iot.wifi",
    description: "Enable Wi-Fi stack support.",
    allowedValues: VALUE_CHOICES["iot.wifi"],
  },
  "iot.mqtt": {
    title: "iot.mqtt",
    description: "Enable MQTT feature support.",
    allowedValues: VALUE_CHOICES["iot.mqtt"],
  },
  "iot.ble": {
    title: "iot.ble",
    description: "Enable Bluetooth Low Energy support.",
    allowedValues: VALUE_CHOICES["iot.ble"],
  },
  "iot.tls": {
    title: "iot.tls",
    description: "Enable TLS support.",
    allowedValues: VALUE_CHOICES["iot.tls"],
  },
  diagnostics: {
    title: "diagnostics",
    description: "Diagnostic and logging controls.",
  },
  "diagnostics.last_error": {
    title: "diagnostics.last_error",
    description: "Request reporting the last error on boot.",
    allowedValues: VALUE_CHOICES["diagnostics.last_error"],
  },
  "diagnostics.log_level": {
    title: "diagnostics.log_level",
    description: "Runtime diagnostics log verbosity level.",
    defaultValue: "info",
    allowedValues: VALUE_CHOICES["diagnostics.log_level"],
  },
};

export function normalizeProjectSettings(raw: unknown): ProjectSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PROJECT_SETTINGS };
  }

  const settings = raw as Record<string, unknown>;
  return {
    sdkPath: readString(settings.path),
    pythonPath: readString(settings.pythonPath),
    boardYamlPath:
      readString(settings.boardYamlPath) ||
      DEFAULT_PROJECT_SETTINGS.boardYamlPath,
    westCwd: readString(settings.westCwd),
  };
}

export function createLineZeroRange(lineLength: number): LineZeroRange {
  const length = Number.isFinite(lineLength)
    ? Math.max(0, Math.trunc(lineLength))
    : 0;

  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: length },
  };
}

export function createIssueRange(
  documentText: string,
  issueMessage: string,
): LineZeroRange {
  const lines = documentText.split(/\r?\n/);
  const candidates = inferIssueKeyCandidates(issueMessage);

  for (const candidate of candidates) {
    const lineIndex = findKeyLine(lines, candidate);
    if (lineIndex >= 0) {
      const lineText = lines[lineIndex] ?? "";
      return {
        start: { line: lineIndex, character: 0 },
        end: { line: lineIndex, character: lineText.length },
      };
    }
  }

  const firstLine = lines[0] ?? "";
  return createLineZeroRange(firstLine.length);
}

export function createBoardYamlCompletionSuggestions(
  documentText: string,
  line: number,
  character: number,
  catalog?: SdkCompletionCatalog,
): BoardYamlCompletionSuggestion[] {
  const lines = splitLines(documentText);
  const valueContext = resolveValueContext(lines, line, character);
  if (valueContext) {
    const choices = resolveValueChoices(valueContext.path, catalog);
    return toValueSuggestions(choices, valueContext.prefix);
  }

  const keyContext = resolveKeyContext(lines, line, character);
  if (!keyContext) {
    return [];
  }

  const schemaVersion = parseBoardModel(documentText).schema_version;
  const choices = resolveKeyChoices(keyContext.containerPath, schemaVersion);
  return toKeySuggestions(choices, keyContext.prefix);
}

export function createBoardYamlHoverInfo(
  documentText: string,
  line: number,
  character: number,
  catalog?: SdkCompletionCatalog,
): BoardYamlHoverInfo | null {
  const lines = splitLines(documentText);
  const path = resolvePathAtPosition(lines, line, character);
  if (!path) {
    return null;
  }

  const info = FIELD_DOCS[path] ?? null;
  if (info && catalog) {
    // Show the active SDK's SKUs / libraries in hover, not the built-in list.
    if (path === "som.sku" && catalog.skus.length > 0) {
      return { ...info, allowedValues: catalog.skus };
    }
    if (path === "libraries[]" && catalog.libraries.length > 0) {
      return { ...info, allowedValues: catalog.libraries };
    }
  }
  return info;
}

export function createBoardYamlDocumentSymbols(
  documentText: string,
): BoardYamlDocumentSymbolNode[] {
  const lines = splitLines(documentText);
  const roots: BoardYamlDocumentSymbolNode[] = [];
  const stack: Array<{ indent: number; node: BoardYamlDocumentSymbolNode }> =
    [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? "";
    const keyMatch = parseKeyLine(lineText);
    if (!keyMatch) {
      continue;
    }

    while (
      stack.length > 0 &&
      stack[stack.length - 1]!.indent >= keyMatch.indent
    ) {
      finalizeSymbolNode(stack.pop()!.node, index - 1, lines);
    }

    const parentPath = stack.length ? stack[stack.length - 1]!.node.path : "";
    const path = parentPath ? `${parentPath}.${keyMatch.key}` : keyMatch.key;
    const node: BoardYamlDocumentSymbolNode = {
      name: keyMatch.key,
      path,
      start: { line: index, character: keyMatch.indent },
      end: { line: index, character: lineText.length },
      children: [],
    };

    if (stack.length > 0) {
      stack[stack.length - 1]!.node.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push({ indent: keyMatch.indent, node });
  }

  const lastLine = Math.max(0, lines.length - 1);
  while (stack.length > 0) {
    finalizeSymbolNode(stack.pop()!.node, lastLine, lines);
  }

  return roots;
}

/**
 * Detects schema v2 structural issues that cannot be caught by the Python
 * validator alone (e.g. a legacy top-level `os:` key in a v2 document).
 */
export function detectV2StructuralIssues(documentText: string): Array<{
  message: string;
  severity: "warning" | "error" | "suggestion";
}> {
  const model = parseBoardModel(documentText);
  if (model.schema_version >= 2 && model.os !== undefined) {
    return [{ message: V2_LEGACY_OS_FIELD_MSG, severity: "error" }];
  }
  return [];
}

function inferCoreIdFromSkuAndOs(sku: string | undefined, os: string): string {
  const skuUpper = (sku ?? "").toUpperCase();
  const isYocto = os.toLowerCase() === "yocto";
  if (skuUpper.includes("AEN301") || skuUpper.includes("AEN401")) {
    // M55-only SoMs — no A-class core
    return "m55_hp";
  }
  if (skuUpper.includes("AEN")) {
    return isYocto ? "a32_cluster" : "m55_hp";
  }
  if (skuUpper.includes("V2N") || skuUpper.includes("V2M")) {
    return isYocto ? "a55_cluster" : "m33_sm";
  }
  if (skuUpper.includes("NX9")) {
    return isYocto ? "a55_cluster" : "m33";
  }
  // Unknown SKU — use generic fallback
  return isYocto ? "a55_cluster" : "m33_sm";
}

export function createBoardYamlQuickFixes(
  documentText: string,
  issueMessage: string,
): BoardYamlQuickFix[] {
  const lines = splitLines(documentText);
  const fixes: BoardYamlQuickFix[] = [];

  // v2 migration: replace top-level os: with cores: block
  if (issueMessage.startsWith(V2_LEGACY_OS_FIELD_MSG)) {
    const osLineIndex = findKeyLine(lines, "os");
    if (osLineIndex >= 0) {
      const osLine = lines[osLineIndex] ?? "";
      const osValueMatch = /^os:\s*(.+)$/.exec(osLine);
      const osValue = osValueMatch?.[1]?.trim() ?? "zephyr";
      const model = parseBoardModel(documentText);
      const coreId = inferCoreIdFromSkuAndOs(model.som?.sku, osValue);
      fixes.push({
        title: `Migrate 'os: ${osValue}' to cores: block (schema v2)`,
        line: osLineIndex,
        character: 0,
        endLine: osLineIndex,
        endCharacter: osLine.length,
        newText: `cores:\n  ${coreId}:\n    os: ${osValue}`,
      });
    }
    return fixes;
  }

  const message = issueMessage.toLowerCase();
  const model = parseBoardModel(documentText);
  const isV2 = model.schema_version >= 2;

  if (message.includes("som") && !hasTopLevelKey(lines, "som")) {
    fixes.push(
      createAppendFix(
        documentText,
        "Add missing som.sku block",
        "som:\n  sku: E1M-AEN701\n",
      ),
    );
  }

  if (message.includes("carrier") && !hasTopLevelKey(lines, "carrier")) {
    fixes.push(
      createAppendFix(
        documentText,
        "Add missing carrier.name block",
        "carrier:\n  name: E1M-EVK\n",
      ),
    );
  }

  // Only suggest adding os: for v1 documents; v2 uses cores: block
  if (!isV2 && message.includes("os") && !hasTopLevelKey(lines, "os")) {
    fixes.push(
      createAppendFix(documentText, "Add missing os field", "os: zephyr\n"),
    );
  }

  return fixes;
}

export function createDiagnosticMessageWithContext(
  issueMessage: string,
  documentText: string,
): string {
  const parsed = parseBoardModel(documentText);
  const effectiveConfig: unknown = normalizeBoardModel(parsed);
  const paths = detectRelevantContextPaths(issueMessage);

  const contextParts = paths.map((path) => {
    const value = getValueAtPath(effectiveConfig, path);
    return `${path}=${formatContextValue(value)}`;
  });

  const originParts = paths.map((path) => `${path}=board.yaml inline`);

  return [
    issueMessage,
    `Context: ${contextParts.join("; ")}`,
    `Preset origin: ${originParts.join("; ")}`,
  ].join("\n");
}

export function createEffectiveConfigPreviewPayload(
  documentText: string,
  boardYamlPath: string,
  projectContext: ProjectContext,
): EffectiveConfigPreviewPayload {
  const parsed = parseBoardModel(documentText);
  const effectiveConfig = normalizeBoardModel(parsed);

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    boardYamlPath,
    projectContext,
    effectiveConfig,
  };
}

function detectRelevantContextPaths(issueMessage: string): string[] {
  const lowerMessage = issueMessage.toLowerCase();
  const paths: string[] = [];

  if (lowerMessage.includes("som") || lowerMessage.includes("sku")) {
    paths.push("som.sku");
  }

  if (lowerMessage.includes("carrier")) {
    paths.push("carrier.name");
  }

  if (lowerMessage.includes("os")) {
    paths.push("os");
  }

  if (paths.length === 0) {
    paths.push("som.sku", "carrier.name", "os");
  }

  return paths;
}

function getValueAtPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function formatContextValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "n/a";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function inferIssueKeyCandidates(issueMessage: string): string[] {
  const candidates = new Set<string>();
  const fieldMatch = /^\s*fail\s+([^:]+):/i.exec(issueMessage);
  if (fieldMatch?.[1]) {
    addCandidateVariants(candidates, fieldMatch[1]);
  }

  for (const alias of ISSUE_KEY_ALIASES) {
    if (alias.pattern.test(issueMessage)) {
      for (const key of alias.keys) {
        addCandidateVariants(candidates, key);
      }
    }
  }

  return [...candidates];
}

function addCandidateVariants(
  candidates: Set<string>,
  rawCandidate: string,
): void {
  const normalized = rawCandidate.trim().toLowerCase();
  if (!normalized) return;

  candidates.add(normalized);
  candidates.add(normalized.replace(/\s+/g, "_"));
  candidates.add(normalized.replace(/\s+/g, "-"));
  candidates.add(normalized.replace(/-/g, "_"));
  candidates.add(normalized.replace(/_/g, "-"));
}

function findKeyLine(lines: readonly string[], key: string): number {
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    if (matcher.test(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finalizeSymbolNode(
  node: BoardYamlDocumentSymbolNode,
  endLineInclusive: number,
  lines: readonly string[],
): void {
  const clampedLine = Math.max(
    node.start.line,
    Math.min(endLineInclusive, Math.max(0, lines.length - 1)),
  );
  const lineText = lines[clampedLine] ?? "";
  node.end = { line: clampedLine, character: lineText.length };
}

function hasTopLevelKey(lines: readonly string[], key: string): boolean {
  for (const lineText of lines) {
    const keyMatch = parseKeyLine(lineText ?? "");
    if (!keyMatch) {
      continue;
    }

    if (keyMatch.indent === 0 && keyMatch.key === key) {
      return true;
    }
  }

  return false;
}

function createAppendFix(
  documentText: string,
  title: string,
  block: string,
): BoardYamlQuickFix {
  const lines = splitLines(documentText);
  const line = Math.max(0, lines.length - 1);
  const character = (lines[line] ?? "").length;
  const needsLeadingNewline =
    documentText.trim().length > 0 && !documentText.endsWith("\n");

  return {
    title,
    line,
    character,
    newText: `${needsLeadingNewline ? "\n" : ""}${block}`,
  };
}

function splitLines(documentText: string): string[] {
  return documentText.split(/\r?\n/);
}

function clampLine(lines: readonly string[], line: number): number {
  if (lines.length === 0) return 0;
  if (!Number.isFinite(line)) return 0;
  return Math.max(0, Math.min(lines.length - 1, Math.trunc(line)));
}

function resolveKeyContext(
  lines: readonly string[],
  line: number,
  character: number,
): { containerPath: string; prefix: string } | null {
  const lineIndex = clampLine(lines, line);
  const lineText = lines[lineIndex] ?? "";
  const prefixText = lineText.slice(0, Math.max(0, character));

  if (prefixText.includes(":")) {
    return null;
  }

  if (/^\s*-/.test(prefixText)) {
    return null;
  }

  const stack = buildKeyStack(lines, lineIndex - 1);
  const currentIndent = leadingWhitespace(lineText);
  while (stack.length > 0 && stack[stack.length - 1]!.indent >= currentIndent) {
    stack.pop();
  }

  const containerPath = stack.map((item) => item.key).join(".");
  const prefix = prefixText.trim();
  return { containerPath, prefix };
}

function resolveValueContext(
  lines: readonly string[],
  line: number,
  character: number,
): { path: string; prefix: string } | null {
  const lineIndex = clampLine(lines, line);
  const lineText = lines[lineIndex] ?? "";

  const keyMatch = parseKeyLine(lineText);
  if (keyMatch) {
    if (character <= keyMatch.colonIndex) {
      return null;
    }

    const stack = buildKeyStack(lines, lineIndex);
    const path = stack.map((item) => item.key).join(".");
    const prefix = lineText
      .slice(keyMatch.colonIndex + 1, Math.max(0, character))
      .trim();
    return { path, prefix };
  }

  const arrayMatch = parseArrayItemLine(lineText);
  if (!arrayMatch) {
    return null;
  }

  const stack = buildKeyStack(lines, lineIndex - 1);
  const currentIndent = leadingWhitespace(lineText);
  while (stack.length > 0 && stack[stack.length - 1]!.indent >= currentIndent) {
    stack.pop();
  }

  const parentPath = stack.map((item) => item.key).join(".");
  if (parentPath !== "libraries") {
    return null;
  }

  const prefix = lineText
    .slice(arrayMatch.prefixStart, Math.max(0, character))
    .trim();
  return { path: "libraries[]", prefix };
}

function resolvePathAtPosition(
  lines: readonly string[],
  line: number,
  character: number,
): string | null {
  const lineIndex = clampLine(lines, line);
  const lineText = lines[lineIndex] ?? "";
  const keyMatch = parseKeyLine(lineText);
  if (keyMatch) {
    const stack = buildKeyStack(lines, lineIndex);
    const path = stack.map((item) => item.key).join(".");
    const keyStart = keyMatch.indent;
    const keyEnd = keyStart + keyMatch.key.length;
    if (character >= keyStart && character <= keyEnd + 1) {
      return path;
    }

    if (character > keyMatch.colonIndex) {
      return path;
    }
  }

  if (parseArrayItemLine(lineText)) {
    const stack = buildKeyStack(lines, lineIndex - 1);
    const parentPath = stack.map((item) => item.key).join(".");
    if (parentPath === "libraries") {
      return "libraries[]";
    }
  }

  return null;
}

function resolveKeyChoices(
  containerPath: string,
  schemaVersion: number,
): readonly string[] {
  if (!containerPath) {
    return schemaVersion >= 2 ? TOP_LEVEL_KEYS_V2 : TOP_LEVEL_KEYS;
  }

  return CHILD_KEYS[containerPath] ?? [];
}

function resolveValueChoices(
  path: string,
  catalog?: SdkCompletionCatalog,
): readonly string[] {
  // Concrete value lists come from the selected SDK's metadata when scanned
  // (see sdkCatalog.ts); fall back to the built-in defaults when no SDK is
  // active or the scan is empty.
  if (catalog) {
    if (path === "som.sku" && catalog.skus.length > 0) {
      return catalog.skus;
    }
    if (path === "libraries[]" && catalog.libraries.length > 0) {
      return catalog.libraries;
    }
  }
  return VALUE_CHOICES[path] ?? [];
}

function toKeySuggestions(
  choices: readonly string[],
  prefix: string,
): BoardYamlCompletionSuggestion[] {
  return choices
    .filter((choice) => choice.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((choice) => ({
      label: choice,
      insertText: `${choice}: `,
      detail: FIELD_DOCS[choice]?.description ?? "Board configuration key",
      kind: "key",
    }));
}

function toValueSuggestions(
  choices: readonly string[],
  prefix: string,
): BoardYamlCompletionSuggestion[] {
  return choices
    .filter((choice) => choice.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((choice) => ({
      label: choice,
      insertText: choice,
      detail: "Allowed value",
      kind: "value",
    }));
}

function buildKeyStack(
  lines: readonly string[],
  endLineInclusive: number,
): Array<{ indent: number; key: string }> {
  const stack: Array<{ indent: number; key: string }> = [];
  if (endLineInclusive < 0) {
    return stack;
  }

  for (
    let index = 0;
    index <= endLineInclusive && index < lines.length;
    index += 1
  ) {
    const keyMatch = parseKeyLine(lines[index] ?? "");
    if (!keyMatch) {
      continue;
    }

    while (
      stack.length > 0 &&
      stack[stack.length - 1]!.indent >= keyMatch.indent
    ) {
      stack.pop();
    }

    stack.push({ indent: keyMatch.indent, key: keyMatch.key });
  }

  return stack;
}

function parseKeyLine(
  lineText: string,
): { indent: number; key: string; colonIndex: number } | null {
  const match = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(lineText);
  if (!match?.[2]) {
    return null;
  }

  const colonIndex = lineText.indexOf(":");
  if (colonIndex < 0) {
    return null;
  }

  return {
    indent: match[1]?.length ?? 0,
    key: match[2],
    colonIndex,
  };
}

function parseArrayItemLine(
  lineText: string,
): { indent: number; prefixStart: number } | null {
  const match = /^(\s*)-\s*/.exec(lineText);
  if (!match) {
    return null;
  }

  return {
    indent: match[1]?.length ?? 0,
    prefixStart: match[0].length,
  };
}

function leadingWhitespace(lineText: string): number {
  const match = /^\s*/.exec(lineText);
  return match?.[0]?.length ?? 0;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface TokenRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** Locate the first occurrence of a token in the document; document start when absent. */
export function findTokenRange(
  documentText: string,
  token: string,
): TokenRange {
  if (token) {
    const lines = documentText.split(/\r?\n/);
    for (let line = 0; line < lines.length; line += 1) {
      const character = lines[line].indexOf(token);
      if (character >= 0) {
        return {
          start: { line, character },
          end: { line, character: character + token.length },
        };
      }
    }
  }

  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
