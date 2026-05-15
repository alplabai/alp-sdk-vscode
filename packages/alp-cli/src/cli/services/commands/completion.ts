// SPDX-License-Identifier: Apache-2.0

import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
    CliShell,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

interface CompletionCommandData {
  schemaVersion: "1";
  shell: CliShell;
  script: string;
}

export function runCompletionCommand(
  flags: CliGlobalFlags,
  _input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<CompletionCommandData> {
  const shell = resolveShell(flags.shell);
  if (!shell) {
    return createFailureResult(
      "completion",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      ["completion: unsupported shell. Use --shell bash|zsh|fish."],
      [
        {
          code: "completion.shell-unsupported",
          severity: "error",
          message: "Unsupported shell. Allowed values: bash, zsh, fish.",
        },
      ],
      {
        schemaVersion: "1",
        shell: "bash",
        script: "",
      },
    );
  }

  const script = createCompletionScript(shell);

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines: flags.format === "json" ? [] : script.split("\n"),
    envelope: createEnvelope(
      "completion",
      {
        root: null,
        boardYaml: null,
      },
      {
        schemaVersion: "1",
        shell,
        script,
      },
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

function resolveShell(rawShell: string | null): CliShell | null {
  const value = (rawShell ?? "bash").trim().toLowerCase();
  if (value === "bash" || value === "zsh" || value === "fish") {
    return value;
  }

  return null;
}

function createCompletionScript(shell: CliShell): string {
  switch (shell) {
    case "bash":
      return createBashCompletion();
    case "zsh":
      return createZshCompletion();
    case "fish":
      return createFishCompletion();
  }
}

function createBashCompletion(): string {
  return `# ALP CLI bash completion
_alp_complete() {
  local cur prev words cword

  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cword=\${COMP_CWORD}

  local commands="validate generate explain presets init scaffold diff completion inspect trace doctor support-bundle"
  local global_flags="--project --board-yaml --sdk-root --format --verbose --quiet --no-color --non-interactive --ci --help"

  if [[ "$prev" == "--format" ]]; then
    COMPREPLY=( $(compgen -W "text json" -- "$cur") )
    return
  fi

  if [[ "$prev" == "--shell" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
    return
  fi

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    generate)
      COMPREPLY=( $(compgen -W "$global_flags --target --all" -- "$cur") )
      ;;
    explain)
      COMPREPLY=( $(compgen -W "$global_flags --template --target" -- "$cur") )
      ;;
    init|scaffold)
      COMPREPLY=( $(compgen -W "$global_flags --template --name --destination --preview --force" -- "$cur") )
      ;;
    diff)
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "--shell --format --help" -- "$cur") )
      ;;
    doctor)
      COMPREPLY=( $(compgen -W "$global_flags --target-kind --server" -- "$cur") )
      ;;
    inspect)
      COMPREPLY=( $(compgen -W "$global_flags --path --show-origin" -- "$cur") )
      ;;
    trace)
      COMPREPLY=( $(compgen -W "$global_flags --target --path" -- "$cur") )
      ;;
    support-bundle)
      COMPREPLY=( $(compgen -W "$global_flags --destination --target-kind --server --target --path" -- "$cur") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      ;;
  esac
}

complete -F _alp_complete alp`;
}

function createZshCompletion(): string {
  return `#compdef alp

_alp() {
  local -a commands
  commands=(
    'validate:Validate board.yaml config'
    'generate:Generate derived artifacts'
    'explain:Explain templates and targets'
    'presets:List SDK presets'
    'init:Initialize a starter project'
    'scaffold:Scaffold module files'
    'diff:Show board normalization diff'
    'completion:Generate shell completion script'
    'inspect:Inspect effective resolved values'
    'trace:Trace generation decisions'
    'doctor:Run debug and environment checks'
    'support-bundle:Export support bundle payload'
  )

  _arguments -C \
    '1:command:->command' \
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        completion)
          _arguments '--shell[Shell type]:shell:(bash zsh fish)' '--format[Output format]:format:(text json)' '--help[Show help]'
          ;;
        generate)
          _arguments '--target[Generation target]' '--all[Generate all targets]' '--format[Output format]:format:(text json)' '--project[Project root]:path:_files -/' '--board-yaml[board.yaml path]:path:_files' '--sdk-root[SDK root]:path:_files -/'
          ;;
        explain)
          _arguments '--template[Template id]' '--target[Target id]' '--format[Output format]:format:(text json)'
          ;;
        init|scaffold)
          _arguments '--template[Template id]' '--name[Name value]' '--destination[Output directory]:path:_files -/' '--preview[Preview only]' '--force[Overwrite existing files]' '--format[Output format]:format:(text json)'
          ;;
        doctor)
          _arguments '--target-kind[Debug target]:target:(zephyr-mcu baremetal-mcu yocto-userspace native-host)' '--server[Debug server]:server:(jlink openocd pyocd gdbserver none)' '--format[Output format]:format:(text json)'
          ;;
        inspect)
          _arguments '--path[Field path]' '--show-origin[Include source metadata]' '--format[Output format]:format:(text json)'
          ;;
        trace)
          _arguments '--target[Generation target]:target:(zephyr-conf dts-overlay cmake-args yocto-conf)' '--path[Field path]' '--format[Output format]:format:(text json)'
          ;;
        support-bundle)
          _arguments '--destination[Output directory]:path:_files -/' '--target-kind[Debug target]:target:(zephyr-mcu baremetal-mcu yocto-userspace native-host)' '--server[Debug server]:server:(jlink openocd pyocd gdbserver none)' '--target[Generation target]:target:(zephyr-conf dts-overlay cmake-args yocto-conf)' '--path[Field path]' '--format[Output format]:format:(text json)'
          ;;
        *)
          _arguments '--project[Project root]:path:_files -/' '--board-yaml[board.yaml path]:path:_files' '--sdk-root[SDK root]:path:_files -/' '--format[Output format]:format:(text json)' '--help[Show help]'
          ;;
      esac
      ;;
  esac
}

compdef _alp alp`;
}

function createFishCompletion(): string {
  return `complete -c alp -f
complete -c alp -n '__fish_use_subcommand' -a 'validate generate explain presets init scaffold diff completion inspect trace doctor support-bundle'
complete -c alp -l project -d 'Project root'
complete -c alp -l board-yaml -d 'board.yaml path'
complete -c alp -l sdk-root -d 'SDK root path'
complete -c alp -l format -d 'Output format' -a 'text json'
complete -c alp -l verbose -d 'Verbose output'
complete -c alp -l quiet -d 'Quiet output'
complete -c alp -l no-color -d 'Disable color output'
complete -c alp -l non-interactive -d 'Disable prompts'
complete -c alp -l ci -d 'CI mode'
complete -c alp -l help -d 'Show help'
complete -c alp -n '__fish_seen_subcommand_from generate' -l target -d 'Generation target' -a 'zephyr-conf dts-overlay cmake-args yocto-conf'
complete -c alp -n '__fish_seen_subcommand_from generate' -l all -d 'Generate all targets'
complete -c alp -n '__fish_seen_subcommand_from explain' -l template -d 'Template id'
complete -c alp -n '__fish_seen_subcommand_from explain' -l target -d 'Generation target'
complete -c alp -n '__fish_seen_subcommand_from init scaffold' -l template -d 'Template id'
complete -c alp -n '__fish_seen_subcommand_from init scaffold' -l name -d 'Name value'
complete -c alp -n '__fish_seen_subcommand_from init scaffold' -l destination -d 'Destination path'
complete -c alp -n '__fish_seen_subcommand_from init scaffold' -l preview -d 'Preview only'
complete -c alp -n '__fish_seen_subcommand_from init scaffold' -l force -d 'Overwrite existing files'
complete -c alp -n '__fish_seen_subcommand_from doctor' -l target-kind -d 'Debug target kind' -a 'zephyr-mcu baremetal-mcu yocto-userspace native-host'
complete -c alp -n '__fish_seen_subcommand_from doctor' -l server -d 'Debug server' -a 'jlink openocd pyocd gdbserver none'
complete -c alp -n '__fish_seen_subcommand_from inspect trace support-bundle' -l path -d 'Field path'
complete -c alp -n '__fish_seen_subcommand_from inspect' -l show-origin -d 'Include source metadata'
complete -c alp -n '__fish_seen_subcommand_from trace support-bundle' -l target -d 'Generation target' -a 'zephyr-conf dts-overlay cmake-args yocto-conf'
complete -c alp -n '__fish_seen_subcommand_from support-bundle' -l destination -d 'Destination path'
complete -c alp -n '__fish_seen_subcommand_from support-bundle' -l target-kind -d 'Debug target kind' -a 'zephyr-mcu baremetal-mcu yocto-userspace native-host'
complete -c alp -n '__fish_seen_subcommand_from support-bundle' -l server -d 'Debug server' -a 'jlink openocd pyocd gdbserver none'
complete -c alp -n '__fish_seen_subcommand_from completion' -l shell -d 'Shell type' -a 'bash zsh fish'`;
}
