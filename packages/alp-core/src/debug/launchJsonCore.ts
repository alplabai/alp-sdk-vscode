// SPDX-License-Identifier: Apache-2.0

import { LaunchConfigurationDraft } from "./models";

interface LaunchJsonDocument {
  version: string;
  configurations: LaunchConfigurationDraft[];
  [key: string]: unknown;
}

export interface LaunchJsonWritePlan {
  content: string;
  replaced: boolean;
}

export function createLaunchJsonWritePlan(
  existingContent: string | null,
  nextConfiguration: LaunchConfigurationDraft,
): LaunchJsonWritePlan {
  const document = parseLaunchJsonOrDefault(existingContent);
  const nextName = configurationName(nextConfiguration);
  const existingIndex = document.configurations.findIndex(
    (configuration) => configurationName(configuration) === nextName,
  );

  let replaced = false;
  if (existingIndex >= 0) {
    document.configurations[existingIndex] = nextConfiguration;
    replaced = true;
  } else {
    document.configurations.push(nextConfiguration);
  }

  return {
    content: `${JSON.stringify(document, null, 2)}\n`,
    replaced,
  };
}

function parseLaunchJsonOrDefault(content: string | null): LaunchJsonDocument {
  if (!content || content.trim().length === 0) {
    return {
      version: "0.2.0",
      configurations: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(content));
  } catch {
    throw new Error("Alp: .vscode/launch.json is not valid JSON or JSONC.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Alp: .vscode/launch.json must be a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;
  const version =
    typeof candidate.version === "string" && candidate.version.trim().length > 0
      ? candidate.version
      : "0.2.0";
  const configurations = Array.isArray(candidate.configurations)
    ? candidate.configurations.filter(
        (entry): entry is LaunchConfigurationDraft =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];

  return {
    ...candidate,
    version,
    configurations,
  };
}

function stripJsonc(content: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      out.push(char);
      if (char === "\\") {
        if (next !== undefined) {
          out.push(next);
        }
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out.push(char);
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      i += 2;
      while (i < content.length && content[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < content.length) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (char === "}" || char === "]") {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) {
        j -= 1;
      }
      if (j >= 0 && out[j] === ",") {
        out[j] = "";
      }
      out.push(char);
      i += 1;
      continue;
    }

    out.push(char);
    i += 1;
  }

  return out.join("");
}

function configurationName(configuration: LaunchConfigurationDraft): string {
  const value = configuration.name;
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error("Alp: debug launch draft is missing a valid name.");
}
