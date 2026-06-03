#compdef alp

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

  _arguments -C     '1:command:->command'     '*::arg:->args'

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

compdef _alp alp