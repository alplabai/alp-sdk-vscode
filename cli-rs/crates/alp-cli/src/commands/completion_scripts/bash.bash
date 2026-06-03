# ALP CLI bash completion
_alp_complete() {
  local cur prev words cword

  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  cword=${COMP_CWORD}

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

  case "${COMP_WORDS[1]}" in
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

complete -F _alp_complete alp