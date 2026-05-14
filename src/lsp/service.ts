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

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
