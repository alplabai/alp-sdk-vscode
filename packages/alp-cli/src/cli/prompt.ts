// SPDX-License-Identifier: Apache-2.0

import { ALL_EMIT_MODES } from "@alp-sdk/core/loader/service";
import {
  listModuleTemplates,
  listWizardTemplates,
} from "@alp-sdk/core/wizard/service";
import { parseCliArgs } from "./service";

const DYNAMIC_IMPORT = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<typeof import("@clack/prompts")>;

interface CommandOption {
  value: string;
  label: string;
  hint: string;
}

const INTERACTIVE_COMMANDS: readonly CommandOption[] = [
  {
    value: "validate",
    label: "validate",
    hint: "Validate board.yaml and SDK resolution",
  },
  {
    value: "generate",
    label: "generate",
    hint: "Generate derived artifacts",
  },
  {
    value: "explain",
    label: "explain",
    hint: "Explain templates and generation targets",
  },
  {
    value: "presets",
    label: "presets",
    hint: "List starter and module presets",
  },
  {
    value: "init",
    label: "init",
    hint: "Create a starter project",
  },
  {
    value: "scaffold",
    label: "scaffold",
    hint: "Scaffold a module into an existing project",
  },
  {
    value: "diff",
    label: "diff",
    hint: "Show normalized board diff",
  },
  {
    value: "completion",
    label: "completion",
    hint: "Print shell completion script",
  },
  {
    value: "inspect",
    label: "inspect",
    hint: "Inspect resolved project state",
  },
  {
    value: "trace",
    label: "trace",
    hint: "Trace generation decisions",
  },
  {
    value: "doctor",
    label: "doctor",
    hint: "Run environment and debug checks",
  },
  {
    value: "support-bundle",
    label: "support-bundle",
    hint: "Export troubleshooting support bundle",
  },
];

export async function resolveInteractiveArgv(
  rawArgv: readonly string[],
): Promise<string[]> {
  if (!canUseInteractivePrompts(rawArgv)) {
    return [...rawArgv];
  }

  const clack = await loadClack();
  const parsed = parseCliArgs(rawArgv);

  if (!parsed.command) {
    clack.intro("ALP CLI");

    const selectedCommand = await clack.select({
      message: "Select a command",
      options: [...INTERACTIVE_COMMANDS],
    });

    if (clack.isCancel(selectedCommand)) {
      clack.cancel("Command selection cancelled.");
      return ["--help"];
    }

    const promptedArgs = await promptCommandFlags(
      String(selectedCommand),
      clack,
    );
    clack.outro(`Ready: alp ${[selectedCommand, ...promptedArgs].join(" ")}`);
    return [String(selectedCommand), ...promptedArgs];
  }

  if (parsed.command === "scaffold" && !parsed.flags.name) {
    const moduleName = await clack.text({
      message: "Module name",
      placeholder: "e.g. imu_reader",
      validate: (value) =>
        value?.trim().length ? undefined : "Module name is required.",
    });

    if (clack.isCancel(moduleName)) {
      clack.cancel("Scaffold prompt cancelled.");
      return [...rawArgv, "--help"];
    }

    return [...rawArgv, "--name", String(moduleName).trim()];
  }

  if (parsed.command === "completion" && !parsed.flags.shell) {
    const shell = await clack.select({
      message: "Shell",
      options: [
        { value: "bash", label: "bash" },
        { value: "zsh", label: "zsh" },
        { value: "fish", label: "fish" },
      ],
      initialValue: "zsh",
    });

    if (clack.isCancel(shell)) {
      clack.cancel("Completion prompt cancelled.");
      return [...rawArgv, "--help"];
    }

    return [...rawArgv, "--shell", String(shell)];
  }

  return [...rawArgv];
}

function canUseInteractivePrompts(rawArgv: readonly string[]): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  if (process.env.CI === "true") {
    return false;
  }

  if (rawArgv.includes("--help")) {
    return false;
  }

  if (rawArgv.includes("--non-interactive") || rawArgv.includes("--ci")) {
    return false;
  }

  for (let index = 0; index < rawArgv.length; index += 1) {
    const token = rawArgv[index]!;
    if (token === "--format" && rawArgv[index + 1] === "json") {
      return false;
    }

    if (
      token.startsWith("--format=") &&
      token.slice("--format=".length) === "json"
    ) {
      return false;
    }
  }

  return true;
}

async function promptCommandFlags(
  command: string,
  clack: typeof import("@clack/prompts"),
): Promise<string[]> {
  switch (command) {
    case "generate": {
      const target = await clack.select({
        message: "Generation target",
        options: [
          { value: "all", label: "all", hint: "Generate all outputs" },
          ...ALL_EMIT_MODES.map((mode) => ({ value: mode, label: mode })),
        ],
        initialValue: "all",
      });

      if (clack.isCancel(target)) {
        return ["--help"];
      }

      return target === "all" ? ["--all"] : ["--target", String(target)];
    }
    case "init": {
      const template = await clack.select({
        message: "Starter template",
        options: listWizardTemplates().map((item) => ({
          value: item.id,
          label: item.id,
          hint: item.description,
        })),
        initialValue: "minimal-app",
      });

      if (clack.isCancel(template)) {
        return ["--help"];
      }

      const destination = await clack.text({
        message: "Destination",
        defaultValue: ".",
      });

      if (clack.isCancel(destination)) {
        return ["--help"];
      }

      return [
        "--template",
        String(template),
        "--destination",
        String(destination),
      ];
    }
    case "scaffold": {
      const template = await clack.select({
        message: "Module template",
        options: listModuleTemplates().map((item) => ({
          value: item.id,
          label: item.id,
          hint: item.description,
        })),
        initialValue: "sensor-driver",
      });

      if (clack.isCancel(template)) {
        return ["--help"];
      }

      const moduleName = await clack.text({
        message: "Module name",
        placeholder: "e.g. imu_reader",
        validate: (value) =>
          value?.trim().length ? undefined : "Module name is required.",
      });

      if (clack.isCancel(moduleName)) {
        return ["--help"];
      }

      const destination = await clack.text({
        message: "Destination",
        defaultValue: ".",
      });

      if (clack.isCancel(destination)) {
        return ["--help"];
      }

      return [
        "--template",
        String(template),
        "--name",
        String(moduleName).trim(),
        "--destination",
        String(destination),
      ];
    }
    case "completion": {
      const shell = await clack.select({
        message: "Shell",
        options: [
          { value: "bash", label: "bash" },
          { value: "zsh", label: "zsh" },
          { value: "fish", label: "fish" },
        ],
        initialValue: "zsh",
      });

      if (clack.isCancel(shell)) {
        return ["--help"];
      }

      return ["--shell", String(shell)];
    }
    default:
      return [];
  }
}

async function loadClack(): Promise<typeof import("@clack/prompts")> {
  try {
    return await DYNAMIC_IMPORT("@clack/prompts");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load @clack/prompts: ${message}`);
  }
}
