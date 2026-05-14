// SPDX-License-Identifier: Apache-2.0

import { ProjectSettings } from "../project/models";

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
    description: "Board configuration schema version.",
    defaultValue: "1",
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
): BoardYamlCompletionSuggestion[] {
  const lines = splitLines(documentText);
  const valueContext = resolveValueContext(lines, line, character);
  if (valueContext) {
    const choices = resolveValueChoices(valueContext.path);
    return toValueSuggestions(choices, valueContext.prefix);
  }

  const keyContext = resolveKeyContext(lines, line, character);
  if (!keyContext) {
    return [];
  }

  const choices = resolveKeyChoices(keyContext.containerPath);
  return toKeySuggestions(choices, keyContext.prefix);
}

export function createBoardYamlHoverInfo(
  documentText: string,
  line: number,
  character: number,
): BoardYamlHoverInfo | null {
  const lines = splitLines(documentText);
  const path = resolvePathAtPosition(lines, line, character);
  if (!path) {
    return null;
  }

  return FIELD_DOCS[path] ?? null;
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
    const prefix = lineText.slice(keyMatch.colonIndex + 1, Math.max(0, character)).trim();
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

  const prefix = lineText.slice(arrayMatch.prefixStart, Math.max(0, character)).trim();
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

function resolveKeyChoices(containerPath: string): readonly string[] {
  if (!containerPath) {
    return TOP_LEVEL_KEYS;
  }

  return CHILD_KEYS[containerPath] ?? [];
}

function resolveValueChoices(path: string): readonly string[] {
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

  for (let index = 0; index <= endLineInclusive && index < lines.length; index += 1) {
    const keyMatch = parseKeyLine(lines[index] ?? "");
    if (!keyMatch) {
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= keyMatch.indent) {
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
