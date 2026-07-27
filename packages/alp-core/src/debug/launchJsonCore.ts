// SPDX-License-Identifier: Apache-2.0

import { LaunchConfigurationDraft } from "./models";
import { isResolvedValue } from "./service";

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
    document.configurations[existingIndex] = mergeConfiguration(
      document.configurations[existingIndex],
      nextConfiguration,
    );
    replaced = true;
  } else {
    document.configurations.push(nextConfiguration);
  }

  return {
    content: `${JSON.stringify(document, null, 2)}\n`,
    replaced,
  };
}

/**
 * Merge the freshly generated configuration over the one already in the file
 * instead of replacing it, because this runs before EVERY session and the
 * configuration names are fixed per target/server.
 *
 * The rule is narrow: an incoming `<placeholder>` never overwrites a value that
 * is already resolved. A customer told to hand-fill `"device": "AE822F4M55_HP"`
 * used to get it silently reset to `"<resolved-device>"` on their next F5 — data
 * loss on their own file, with no confirm and no backup, and an unexitable loop
 * around the advice we had just given them.
 *
 * Everything else still refreshes — `type`, `executable`, `cwd`, `servertype` —
 * so repairs such as `codelldb` → `lldb` still land on an existing entry. Keys
 * the customer added that we never write (`preLaunchTask`, `serverArgs`, …)
 * survive untouched, and key order follows the existing entry with any new key
 * appended.
 */
function mergeConfiguration(
  existing: LaunchConfigurationDraft,
  next: LaunchConfigurationDraft,
): LaunchConfigurationDraft {
  const merged: LaunchConfigurationDraft = { ...existing };
  for (const [key, value] of Object.entries(next)) {
    merged[key] = mergeValue(existing[key], value);
  }
  return merged;
}

function mergeValue(existingValue: unknown, nextValue: unknown): unknown {
  // Arrays (cortex-debug `configFiles`): an all-placeholder incoming list keeps
  // the existing list whole — a hand-added second .cfg would be lost to a
  // per-index merge against a one-element draft. A mixed list still merges per
  // element, so a resolved entry we computed wins.
  if (Array.isArray(nextValue) && Array.isArray(existingValue)) {
    if (
      nextValue.length > 0 &&
      existingValue.length > 0 &&
      nextValue.every(isUnresolvedString)
    ) {
      return existingValue;
    }
    return nextValue.map((entry, index) =>
      mergeValue(existingValue[index], entry),
    );
  }

  return isUnresolvedString(nextValue) && isResolvedString(existingValue)
    ? existingValue
    : nextValue;
}

function isUnresolvedString(value: unknown): boolean {
  return typeof value === "string" && !isResolvedValue(value);
}

function isResolvedString(value: unknown): boolean {
  return typeof value === "string" && isResolvedValue(value);
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
