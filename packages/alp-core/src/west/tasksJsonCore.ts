// SPDX-License-Identifier: Apache-2.0

import { BuildTarget } from "./buildTarget";

export interface TaskDraft {
  label: string;
  type: string;
  command: string;
  problemMatcher?: string[];
  group?: { kind: string; isDefault: boolean };
  [key: string]: unknown;
}

interface TasksJsonDocument {
  version: string;
  tasks: TaskDraft[];
  [key: string]: unknown;
}

export interface TasksJsonWritePlan {
  content: string;
  replaced: boolean;
}

/** The two Alp west tasks for a given build target. */
export function buildAlpWestTasks(target: BuildTarget): TaskDraft[] {
  return [
    {
      label: "alp: west build",
      type: "shell",
      command: `alp generate --all && west build -b ${target.board} ${target.example} -p auto`,
      problemMatcher: ["$alp-west"],
      group: { kind: "build", isDefault: true },
    },
    {
      label: "alp: west flash",
      type: "shell",
      command: "west flash",
    },
  ];
}

/**
 * Merge `tasks` into an existing tasks.json document (by label) or create a new
 * one. Mirrors createLaunchJsonWritePlan. `replaced` is true if any incoming
 * task replaced a same-label task already present.
 */
export function createTasksJsonWritePlan(
  existingContent: string | null,
  tasks: TaskDraft[],
): TasksJsonWritePlan {
  const document = parseTasksJsonOrDefault(existingContent);
  let replaced = false;

  for (const next of tasks) {
    const index = document.tasks.findIndex((t) => taskLabel(t) === next.label);
    if (index >= 0) {
      document.tasks[index] = next;
      replaced = true;
    } else {
      document.tasks.push(next);
    }
  }

  return { content: `${JSON.stringify(document, null, 2)}\n`, replaced };
}

function parseTasksJsonOrDefault(content: string | null): TasksJsonDocument {
  if (!content || content.trim().length === 0) {
    return { version: "2.0.0", tasks: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Alp: .vscode/tasks.json is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Alp: .vscode/tasks.json must be a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;
  const version =
    typeof candidate.version === "string" && candidate.version.trim().length > 0
      ? candidate.version
      : "2.0.0";
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks.filter(
        (entry): entry is TaskDraft =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];

  return { ...candidate, version, tasks };
}

function taskLabel(task: TaskDraft): string {
  return typeof task.label === "string" ? task.label : "";
}
