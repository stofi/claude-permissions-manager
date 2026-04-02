# claude-permissions-manager (`cpm`)

[![CI](https://github.com/stofi/claude-permissions-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/stofi/claude-permissions-manager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-permissions-manager)](https://www.npmjs.com/package/claude-permissions-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Discover, analyze, and manage [Claude Code](https://claude.ai/code) permissions across all your projects.

## Install

```bash
npm install -g claude-permissions-manager
# or run without installing:
npx claude-permissions-manager
```

## Usage

```bash
cpm                         # Launch interactive TUI (when stdout is a TTY)
cpm list                    # List all projects with their permission modes
cpm list --warnings         # Only show projects that have permission warnings
cpm show                    # Show permissions for current project (cwd)
cpm show ~/my-project       # Show detailed permissions for a specific project
cpm audit                   # Report risky permissions across all projects
cpm audit --min-severity high  # Only report high and critical issues
cpm diff <path1> <path2>    # Compare two projects side by side
cpm copy <source> <target>  # Copy project-level permissions to another project
cpm export                  # Dump all permissions as JSON (stdout)
cpm export --format csv     # Dump as CSV
cpm export --output out.json  # Write to file
```

### Initialize a project

```bash
# Create a starter settings.json from a preset
cpm init --project ~/my-project --preset node    # Node.js project
cpm init --project ~/my-project --preset safe    # Read-only + safe git (default)
cpm init --project ~/my-project --preset strict  # Highly restrictive

# Use --scope local to create a personal settings.local.json instead
cpm init --project ~/my-project --preset node --scope local
```

### Managing permissions

```bash
# Add rules
cpm allow "Bash(npm run *)" --project ~/my-project --scope project
cpm deny  "Read(**/.env)"   --project ~/my-project --scope project
cpm ask   "Bash(git push *)" --project ~/my-project --scope project
cpm allow "Read"            --scope user   # applies to all projects

# Remove a rule
cpm reset "Bash(npm run *)" --project ~/my-project --scope project

# Clear all rules (with confirmation)
cpm reset --all --yes --project ~/my-project --scope project

# Set permission mode
cpm mode acceptEdits --project ~/my-project --scope project
```

### Copy permissions between projects

```bash
# Copy project-level rules and mode from one project to another
cpm copy ~/template-project ~/new-project --yes

# Preview without writing
cpm copy ~/template-project ~/new-project --dry-run

# Copy into a project-scope (shared) settings file instead of local
cpm copy ~/template-project ~/new-project --scope project --yes
```

`cpm copy` reads allow/deny/ask rules and `defaultMode` from the **source project's `project` and `local` scope settings files only** (global user/managed rules are excluded — they already apply everywhere). It then merges those rules into the target's settings file, deduplicating any rules already present.

### Open settings in your editor

```bash
cpm edit                                  # Open cwd local settings in $EDITOR
cpm edit --project ~/my-project           # Open a specific project's local settings
cpm edit --scope project                  # Open the project-scope settings.json
cpm edit --scope project --project ~/p   # Both options together
```

Creates the file (empty `{}`) if it doesn't already exist, then opens it in `$VISUAL`, `$EDITOR`, or `vi` as a fallback.

### Scope options

| Scope | File | Applies to |
|---|---|---|
| `local` | `.claude/settings.local.json` | You, this project (default) |
| `project` | `.claude/settings.json` | All collaborators (commit to git) |
| `user` | `~/.claude/settings.json` | You, all projects |

### Flags

```
--root <dir>       Override scan root (default: ~)
--depth <n>        Max directory depth for scanning (default: 8)
--json             Output as JSON (list, show, audit, diff, export)
--no-global        Skip user/managed global settings (list, show, audit, diff, export, ui)
--exit-code        Exit 1 if issues found, 2 if critical issues (audit only — useful in CI)
--dry-run          Preview what would be written without modifying files (allow, deny, ask, reset, mode, init, copy)
--format <fmt>     Output format: json|csv (export only, default: json)
--output <file>    Write output to file instead of stdout (export only)
```

#### Exit codes

All commands exit `0` on success and `1` on error (missing `.claude` directory, invalid arguments, file I/O failure).

`cpm audit --exit-code` uses additional codes:

| Code | Meaning |
|------|---------|
| `0`  | No issues found |
| `1`  | Issues found (any severity below critical) |
| `2`  | Critical issues found |

Combine with `--min-severity` to only trigger on specific severity levels:

```bash
cpm audit --exit-code --min-severity high   # exit non-zero only for high/critical
cpm audit --exit-code --min-severity critical  # exit non-zero only for critical
```

#### Path arguments

`cpm` does **not** expand a bare `~` — use `~/` (with trailing slash) or a full path:

```bash
cpm show ~/my-project   # ✓ works
cpm show ~              # ✗ won't expand to home directory
```

### Audit warnings reference

`cpm audit` (and the TUI warnings tab) surfaces issues at four severity levels:

| Severity | Meaning |
|----------|---------|
| `critical` | Immediate security risk — review before continuing |
| `high` | Significant risk — Claude has broad or unrestricted access |
| `medium` | Notable configuration — worth reviewing |
| `low` | Informational — minor concern or best-practice note |

**Warning catalogue:**

| Severity | Trigger |
|----------|---------|
| `critical` | `bypassPermissions` mode active — all permission checks disabled |
| `high` | `dontAsk` mode active — Claude executes actions without asking |
| `high` | Wildcard `"*"` in allow list — all tools permitted |
| `high` | `Bash`, `Write`, or `Edit` allowed without a specifier |
| `high` | `allowManagedPermissionRulesOnly` set in managed settings |
| `medium` | `acceptEdits` mode active — file edits auto-accepted without prompts |
| `medium` | `WebFetch` or `WebSearch` allowed without a URL/query specifier |
| `medium` | Sensitive path in allow rule (`.env`, `.key`, `secrets`, `~/.ssh`, `~/.aws`) |
| `medium` | MCP server has not been approved or denied (`pending`) |
| `medium` | `allowManagedHooksOnly` or `allowManagedMcpServersOnly` in managed settings |
| `medium` | Wildcard `"*"` in deny list — all tools blocked |
| `low` | `disableBypassPermissionsMode` not set (bypass mode can be activated) |
| `low` | No deny rules configured when non-read-only tools are allowed |
| `low` | MCP server has no `command` (stdio) or no `url` (http) configured |
| `low` | Rule appears in conflicting lists (allow+deny, ask+deny, allow+ask) |
| `low` | Allow/ask rule overridden by bare-tool deny or wildcard deny |
| `low` | `additionalDirectories` configured — filesystem access beyond project root |
| `low` | Wildcard `"*"` in ask list — all tools require approval |

### JSON output format

All `--json` outputs share these conventions:

**Allow/deny/ask rules** — emitted as objects with `rule` and `scope` fields:
```json
{ "rule": "Bash(npm run *)", "scope": "project" }
```
`scope` is one of `"managed"`, `"user"`, `"project"`, or `"local"`.

**MCP servers** — consistent shape across all commands:
```json
{
  "name": "github", "type": "stdio", "scope": "local",
  "approvalState": "approved",
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
  "url": null, "envVarNames": ["GITHUB_TOKEN"], "headerNames": []
}
```
`approvalState` is `"approved"`, `"denied"`, or `"pending"`. `type` defaults to `"stdio"`.

**claudeMdFiles** — objects in both `show` and `export`:
```json
{ "path": "/path/to/CLAUDE.md", "scope": "project", "exists": true, "lineCount": 42 }
```

**settingsFiles** — objects with parse status:
```json
{ "path": "/path/to/settings.json", "scope": "project", "exists": true, "readable": true, "parsed": true, "parseError": null }
```

#### Per-command differences

**Command capability matrix:**

| Field | `list` | `show` | `export` | `audit` |
|-------|--------|--------|----------|---------|
| `mode` / `defaultMode` | `mode` (flat) | `effectivePermissions.defaultMode` (nested) | `mode` (flat) | — |
| `isBypassDisabled` | flat root | inside `effectivePermissions` | flat root | — |
| `envVarNames` / `additionalDirs` | flat root | inside `effectivePermissions` | flat root | — |
| `allow` / `deny` / `ask` | flat root | inside `effectivePermissions` | flat root | — |
| `mcpServers` | ✓ | ✓ | ✓ | — |
| `warnings` | `warningCount` (number) | `warnings` (array of objects) | `warningCount` (number) | `issues` (array) |
| `settingsFiles` | — | ✓ (incl. global) | ✓ (incl. global) | — |
| `claudeMdFiles` | — | ✓ (objects) | ✓ (objects) | — |

`cpm show --json` is the **detail view** for a single project. It nests `defaultMode`, `allow`, `deny`, `ask`, `isBypassDisabled`, `envVarNames`, and `additionalDirs` under an `effectivePermissions` key. It emits `warnings` as a full array of objects.

`cpm list --json` is the **summary** format (compact, no `settingsFiles`/`claudeMdFiles`). Fields are flat at the project root. Use `cpm export --json` for the full data dump.

`cpm audit --json` output structure:
```json
{
  "generatedAt": "...", "scanRoot": "...", "projectCount": 3, "issueCount": 2,
  "issues": [
    { "project": "/path/to/project", "severity": "high", "message": "...", "rule": "Bash" }
  ],
  "errors": []
}
```

`cpm diff --json` structure:
```json
{
  "projectA": "/abs/path/a", "projectB": "/abs/path/b",
  "identical": false,
  "mode": { "a": "default", "b": "acceptEdits" },
  "isBypassDisabled": { "a": false, "b": false },
  "allow":  { "onlyInA": [{"rule":"Read","scope":"project"}], "onlyInB": [], "inBoth": ["Glob"] },
  "deny":   { "onlyInA": [], "onlyInB": [], "inBoth": [] },
  "ask":    { "onlyInA": [], "onlyInB": [], "inBoth": [] },
  "mcpServers": {
    "onlyInA": [{"name":"github","type":"stdio","scope":"local","approvalState":"approved","command":"npx","args":["-y","@mcp/server"],"url":null,"envVarNames":["GITHUB_TOKEN"],"headerNames":[]}],
    "onlyInB": [],
    "inBoth":  ["filesystem"],
    "modified": [{"name":"myserver","a":{...full object...},"b":{...full object...}}]
  },
  "envVarNames":    { "onlyInA": [], "onlyInB": [], "inBoth": [] },
  "additionalDirs": { "onlyInA": [], "onlyInB": [], "inBoth": [] }
}
```
`allow`/`deny`/`ask` `onlyInA`/`onlyInB` entries are `{rule, scope}` objects; `inBoth` is plain strings. `mcpServers.onlyInA`/`onlyInB` are full server objects; `inBoth` is plain strings; `modified` contains `{name, a, b}` with full server objects on both sides. Does not compare `claudeMdFiles` or `settingsFiles`.

## Shell completion

```bash
# Bash — add to ~/.bashrc
eval "$(cpm completion bash)"

# Zsh — add to ~/.zshrc
eval "$(cpm completion zsh)"
```

Tab-completes: commands, `--scope` values, `--format`, `--preset`, mode names, and directory paths.

## Interactive TUI

Run `cpm` (or `cpm ui`) for the interactive terminal UI:

- `↑↓` / `j`/`k` — navigate projects
- `Enter` — view project details
- `/` — filter projects by path (type to narrow, `Esc` to clear)
- `r` — re-scan and refresh the project list (picks up changes made outside the TUI)
- `a` — audit view (security issues)
- `d` — diff two projects
- `q` / `Ctrl+C` — quit

In the audit screen:
- `↑↓` / `j`/`k` — navigate warnings
- `Enter` — jump to that project's detail screen (back returns to audit)
- `←` / `Esc` / `q` — back to list

In the diff screen (press `d` from the project list):
- Step 1 — select project A: `↑↓` / `j`/`k` navigate, `Enter` confirm, `q` cancel back to list
- Step 2 — select project B: `↑↓` / `j`/`k` navigate, `Enter` confirm, `Esc` back to step 1
- Diff view: `←` / `Esc` / `q` — back to project selection

In project detail (permissions tab):
- `1` / `2` / `3` — switch tabs (permissions / MCP / warnings)
- `j`/`k` — move cursor through rules
- `a` — add allow rule, `d` — add deny rule, `s` — add ask rule
- `x` — delete selected rule
- `m` — change defaultMode (writes to local scope)
- `←` / `h` / `Esc` / `q` — back

## What it reads

- `~/.claude/settings.json` — your personal global settings
- `.claude/settings.json` — project-level shared settings
- `.claude/settings.local.json` — project-level personal settings
- `/etc/claude-code/managed-settings.json` — enterprise managed settings
- `.mcp.json` — MCP server configurations
- `~/.claude.json` — Claude Code state (MCP approvals, per-project servers)

Values from all scopes are merged. Deny rules at any scope win absolutely.

## Security

- Never displays environment variable values (only names)
- Never displays MCP header values (only names)
- Warns for dangerous modes (`bypassPermissions` → critical, `dontAsk` → high, `acceptEdits` → medium)
- Atomic file writes (write to temp file, then rename)
- No network access — fully local

## Requirements

Node.js ≥ 20
