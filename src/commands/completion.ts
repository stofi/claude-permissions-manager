/**
 * Shell completion for cpm.
 *
 * Usage:
 *   eval "$(cpm completion bash)"   # add to ~/.bashrc
 *   eval "$(cpm completion zsh)"    # add to ~/.zshrc
 */
import { PermissionModeSchema } from "../core/schemas.js";
import { WRITABLE_SCOPES } from "../core/types.js";

const COMMANDS = [
  "ui",
  "list",
  "show",
  "audit",
  "diff",
  "allow",
  "deny",
  "ask",
  "reset",
  "mode",
  "export",
  "init",
  "completion",
];

const SCOPES = WRITABLE_SCOPES;
const MODES = PermissionModeSchema.options;
const PRESETS = ["safe", "node", "strict"];
const FORMATS = ["json", "csv"];

// Bash completion script
function bashScript(): string {
  const commandList = COMMANDS.join(" ");
  const scopeList = SCOPES.join(" ");
  const modeList = MODES.join(" ");
  const presetList = PRESETS.join(" ");
  const formatList = FORMATS.join(" ");

  return `
_cpm_completions() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words="\${COMP_WORDS[@]}"
  cword=\${COMP_CWORD}

  # Complete options that take values
  case "\${prev}" in
    --scope)
      COMPREPLY=( \$(compgen -W "${scopeList}" -- "\${cur}") )
      return 0
      ;;
    --format)
      COMPREPLY=( \$(compgen -W "${formatList}" -- "\${cur}") )
      return 0
      ;;
    --preset)
      COMPREPLY=( \$(compgen -W "${presetList}" -- "\${cur}") )
      return 0
      ;;
    --mode)
      COMPREPLY=( \$(compgen -W "${modeList}" -- "\${cur}") )
      return 0
      ;;
    --root|--project|--output)
      COMPREPLY=( \$(compgen -d -- "\${cur}") )
      return 0
      ;;
  esac

  # Find the subcommand (first non-option word after "cpm")
  local cmd=""
  local i
  for (( i=1; i<cword; i++ )); do
    if [[ "\${COMP_WORDS[i]}" != -* ]]; then
      cmd="\${COMP_WORDS[i]}"
      break
    fi
  done

  # If no subcommand yet, complete command names
  if [[ -z "\${cmd}" ]]; then
    COMPREPLY=( \$(compgen -W "${commandList}" -- "\${cur}") )
    return 0
  fi

  # Subcommand-specific completion
  case "\${cmd}" in
    mode)
      if [[ "\${cur}" != -* ]]; then
        COMPREPLY=( \$(compgen -W "${modeList}" -- "\${cur}") )
      else
        COMPREPLY=( \$(compgen -W "--scope --project --dry-run" -- "\${cur}") )
      fi
      return 0
      ;;
    show)
      if [[ "\${cur}" != -* ]]; then
        COMPREPLY=( \$(compgen -d -- "\${cur}") )
      else
        COMPREPLY=( \$(compgen -W "--json --no-global" -- "\${cur}") )
      fi
      return 0
      ;;
    diff)
      if [[ "\${cur}" != -* ]]; then
        COMPREPLY=( \$(compgen -d -- "\${cur}") )
      else
        COMPREPLY=( \$(compgen -W "--json --no-global" -- "\${cur}") )
      fi
      return 0
      ;;
    completion)
      COMPREPLY=( \$(compgen -W "bash zsh" -- "\${cur}") )
      return 0
      ;;
    list)
      COMPREPLY=( \$(compgen -W "--root --depth --json --no-global" -- "\${cur}") )
      return 0
      ;;
    ui)
      COMPREPLY=( \$(compgen -W "--root --depth --no-global" -- "\${cur}") )
      return 0
      ;;
    audit)
      COMPREPLY=( \$(compgen -W "--root --depth --json --no-global --exit-code" -- "\${cur}") )
      return 0
      ;;
    export)
      COMPREPLY=( \$(compgen -W "--root --depth --format --output --no-global" -- "\${cur}") )
      return 0
      ;;
    allow|deny|ask)
      COMPREPLY=( \$(compgen -W "--scope --project --dry-run" -- "\${cur}") )
      return 0
      ;;
    reset)
      COMPREPLY=( \$(compgen -W "--scope --project --all --yes --dry-run" -- "\${cur}") )
      return 0
      ;;
    init)
      COMPREPLY=( \$(compgen -W "--project --scope --preset --mode --yes --dry-run" -- "\${cur}") )
      return 0
      ;;
  esac

  # Default: complete flags
  COMPREPLY=( \$(compgen -W "--help --version" -- "\${cur}") )
}

complete -F _cpm_completions cpm
`.trim();
}

// Zsh completion script
function zshScript(): string {
  const commandDefs = COMMANDS.map((c) => {
    const desc: Record<string, string> = {
      ui: "Launch interactive TUI",
      list: "List all Claude projects",
      show: "Show project permissions",
      audit: "Report risky permissions",
      diff: "Compare two projects",
      allow: "Add allow rule",
      deny: "Add deny rule",
      ask: "Add ask rule",
      reset: "Remove rule(s)",
      mode: "Set default mode",
      export: "Export permissions data",
      init: "Create starter settings",
      completion: "Print shell completion script",
    };
    return `    '${c}:${desc[c] ?? c}'`;
  }).join("\n");

  const scopeList = SCOPES.join(" ");
  const modeList = MODES.join(" ");
  const presetList = PRESETS.join(" ");
  const formatList = FORMATS.join(" ");

  return `
#compdef cpm

_cpm() {
  local state line
  typeset -A opt_args

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '1: :->command' \\
    '*: :->args'

  case \$state in
    command)
      local commands
      commands=(
${commandDefs}
      )
      _describe 'command' commands
      ;;
    args)
      case \$line[1] in
        mode)
          _arguments \\
            '--scope[Settings scope]:scope:(${scopeList})' \\
            '--project[Project path]:project:_directories' \\
            '--dry-run[Preview without writing]' \\
            '1:mode:(${modeList})'
          ;;
        show)
          _arguments \\
            '1:project:_directories' \\
            '--json[Output as JSON]' \\
            '--no-global[Skip user and managed global settings]'
          ;;
        diff)
          _arguments \\
            '1:project1:_directories' \\
            '2:project2:_directories' \\
            '--json[Output as JSON]' \\
            '--no-global[Skip user and managed global settings]'
          ;;
        allow|deny|ask)
          _arguments \\
            '--scope[Settings scope]:scope:(${scopeList})' \\
            '--project[Project path]:project:_directories' \\
            '--dry-run[Preview without writing]' \\
            '1:rule:'
          ;;
        reset)
          _arguments \\
            '--scope[Settings scope]:scope:(${scopeList})' \\
            '--project[Project path]:project:_directories' \\
            '--all[Clear all rules]' \\
            '--yes[Skip confirmation]' \\
            '--dry-run[Preview without writing]' \\
            '1:rule:'
          ;;
        init)
          _arguments \\
            '--project[Project path]:project:_directories' \\
            '--scope[Settings scope]:scope:(${scopeList})' \\
            '--preset[Template preset]:preset:(${presetList})' \\
            '--mode[Default mode]:mode:(${modeList})' \\
            '--yes[Overwrite without prompting]' \\
            '--dry-run[Preview without writing]'
          ;;
        list)
          _arguments \\
            '--root[Root directory]:root:_directories' \\
            '--depth[Max scan depth]:depth:' \\
            '--json[Output as JSON]' \\
            '--no-global[Skip user and managed global settings]'
          ;;
        ui)
          _arguments \\
            '--root[Root directory]:root:_directories' \\
            '--depth[Max scan depth]:depth:' \\
            '--no-global[Skip user and managed global settings]'
          ;;
        audit)
          _arguments \\
            '--root[Root directory]:root:_directories' \\
            '--depth[Max scan depth]:depth:' \\
            '--json[Output as JSON]' \\
            '--no-global[Skip user and managed global settings]' \\
            '--exit-code[Exit 1 if issues, 2 if critical (for CI)]'
          ;;
        export)
          _arguments \\
            '--root[Root directory]:root:_directories' \\
            '--depth[Max scan depth]:depth:' \\
            '--format[Output format]:format:(${formatList})' \\
            '--output[Output file]:output:_files' \\
            '--no-global[Skip user and managed global settings]'
          ;;
        completion)
          _arguments '1:shell:(bash zsh)'
          ;;
      esac
      ;;
  esac
}

_cpm
`.trim();
}

export async function completionCommand(shell: string): Promise<void> {
  if (shell === "bash") {
    console.log(bashScript());
  } else if (shell === "zsh") {
    console.log(zshScript());
  } else {
    console.error(`Unknown shell: ${shell}. Supported: bash, zsh`);
    process.exit(1);
  }
}
