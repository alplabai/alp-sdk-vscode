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

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
