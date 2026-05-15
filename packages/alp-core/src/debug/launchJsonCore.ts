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
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Alp: .vscode/launch.json is not valid JSON.");
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

function configurationName(configuration: LaunchConfigurationDraft): string {
  const value = configuration.name;
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error("Alp: debug launch draft is missing a valid name.");
}
