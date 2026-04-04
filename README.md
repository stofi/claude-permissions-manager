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
cpm list                           # List all projects with their permission modes
cpm list --warnings                # Only show projects that have permission warnings
cpm list --min-severity high       # Only show projects with high or critical warnings
cpm list --min-severity critical   # Only show projects with critical warnings
cpm list --sort warnings           # Sort by warning count (most warnings first)
cpm list --sort name               # Sort alphabetically by path
cpm list --sort mode               # Sort by permission mode
cpm stats                   # Show aggregate statistics (modes, warnings, MCP usage)
cpm stats --json            # Machine-readable statistics
cpm search bash             # Find all projects with rules matching "bash"
cpm search "npm run" --type allow  # Only search allow rules
cpm search "Bash(npm run *)" --exact  # Exact rule match
cpm rules                   # List all unique rules ranked by frequency across projects
cpm rules --type allow      # Only allow rules
cpm rules --top 10          # Show top 10 most common rules
cpm rules --json            # Machine-readable output
cpm show                    # Show permissions for current project (cwd)
cpm show ~/my-project       # Show detailed permissions for a specific project
cpm audit                   # Report risky permissions across all projects
cpm audit --min-severity high  # Only report high and critical issues
cpm audit --fix             # Auto-apply all available fixes (prompts for confirmation), then re-scans
cpm audit --fix --yes       # Auto-apply all available fixes without prompting, then re-scans
cpm audit --fix --yes --exit-code  # Fix, re-scan, exit non-zero if issues remain
cpm diff <path1> <path2>    # Compare two projects side by side
cpm copy <source> <target>  # Copy project-level permissions to another project
cpm preset safe             # Apply the "safe" security preset to current project
cpm preset                  # List all available presets
cpm dedup                   # Remove duplicate rules from current project's settings
cpm dedup --all --yes       # Remove duplicates across all discovered projects
cpm export                  # Dump all permissions as JSON (stdout)
cpm export --format csv     # Dump as CSV
cpm export --format markdown  # Generate a Markdown report
cpm export --output out.json  # Write to file
cpm export --format markdown --output report.md  # Markdown report to file
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
# Add rules to a specific project
cpm allow "Bash(npm run *)" --project ~/my-project --scope project
cpm deny  "Read(**/.env)"   --project ~/my-project --scope project
cpm ask   "Bash(git push *)" --project ~/my-project --scope project
cpm allow "Read"            --scope user   # applies to all projects

# Batch: add a rule to ALL discovered projects at once
cpm deny "Read(**/.env)" --all --scope project --dry-run  # preview
cpm deny "Read(**/.env)" --all --scope project --yes      # apply
cpm allow "Bash(git *)"  --all --scope local              # local scope to all

# Remove a rule from one project
cpm reset "Bash(npm run *)" --project ~/my-project --scope project

# Batch: remove a rule from ALL discovered projects at once
cpm reset "Bash(npm run *)" --all --scope project --dry-run  # preview
cpm reset "Bash(npm run *)" --all --scope project --yes      # apply

# Clear all rules from one project (with confirmation)
cpm reset --all --yes --project ~/my-project --scope project

# Clear all rules across ALL discovered projects (batch)
cpm reset --all --dry-run   # preview
cpm reset --all --yes       # apply

# Set permission mode for one project
cpm mode acceptEdits --project ~/my-project --scope project

# Batch: set mode across ALL discovered projects at once
cpm mode default --all --scope project --dry-run  # preview
cpm mode default --all --scope project --yes      # apply
```

### Replace / rename a rule

```bash
# Replace a rule in one project (useful after tool renames or typo fixes)
cpm replace "Bash(npm run dev)" "Bash(npm run start)" --project ~/my-project --scope project

# Batch: replace a rule across ALL discovered projects
cpm replace "Bash(npm run dev)" "Bash(npm run start)" --all --scope project --dry-run  # preview
cpm replace "Bash(npm run dev)" "Bash(npm run start)" --all --scope project --yes      # apply
```

The rule is replaced in whichever list (allow/deny/ask) it currently lives in. If the new rule already exists in the same list, it is deduplicated automatically.

### Copy permissions between projects

```bash
# Copy project-level rules and mode from one project to another
cpm copy ~/template-project ~/new-project --yes

# Preview without writing
cpm copy ~/template-project ~/new-project --dry-run

# Copy into a project-scope (shared) settings file instead of local
cpm copy ~/template-project ~/new-project --scope project --yes

# Copy from a template to ALL discovered projects at once
cpm copy ~/template-project --all --dry-run   # preview
cpm copy ~/template-project --all --yes       # apply
```

`cpm copy` reads allow/deny/ask rules and `defaultMode` from the **source project's `project` and `local` scope settings files only** (global user/managed rules are excluded — they already apply everywhere). It then merges those rules into the target's settings file, deduplicating any rules already present.

### Lock out bypassPermissions mode

```bash
# Prevent Claude from ever activating bypassPermissions (recommended for shared/CI projects)
cpm bypass-lock on --project ~/my-project --scope project

# Remove the lock (allow bypassPermissions to be set again)
cpm bypass-lock off --project ~/my-project --scope project

# Preview without writing
cpm bypass-lock on --scope project --dry-run

# Apply to ALL discovered projects at once
cpm bypass-lock on --all --dry-run   # preview
cpm bypass-lock on --all --yes       # apply
```

Setting `disableBypassPermissionsMode` to `"disable"` in a settings file prevents the `bypassPermissions` mode from being activated in that project. This is also auto-applied by `cpm audit --fix` when the corresponding LOW-severity warning is present.

### Apply security presets

```bash
# List all available presets with descriptions
cpm preset

# Apply a preset to the current project (local scope by default)
cpm preset safe             # Block shell + writes; keep read access
cpm preset readonly         # Block shell, writes, and network fetch
cpm preset locked           # Block shell + writes + enable bypass-lock
cpm preset open             # Allow all tools (removes restrictive deny rules)
cpm preset cautious         # Deny shell + writes; set dontAsk mode

# Target a specific scope or project
cpm preset safe --scope project --project ~/my-project

# Apply to ALL discovered projects at once
cpm preset safe --all --dry-run   # preview
cpm preset safe --all --yes       # apply

# Preview without writing
cpm preset locked --dry-run
```

**Preset reference:**

| Preset | Effect |
|--------|--------|
| `safe` | Deny `Bash(*)`, `Write(**)`, `Edit(**)`, `MultiEdit(**)` — blocks shell and writes |
| `readonly` | `safe` + deny `WebFetch(*)`, `WebSearch(*)` — fully read-only |
| `locked` | `safe` + enable `bypass-lock` (`disableBypassPermissionsMode`) |
| `open` | Allow all major tools (removes existing restrictive deny rules) |
| `cautious` | Deny shell + writes; set `dontAsk` mode (Claude must ask before all actions) |

Presets **merge** with existing rules — they never remove rules you've already added. Rules are deduplicated if already present. Use `cpm reset` or `cpm dedup` to clean up after applying a preset.

### Remove duplicate rules

```bash
# Remove duplicate rules from the current project (local scope)
cpm dedup

# Target a specific scope or project
cpm dedup --scope project --project ~/my-project

# Preview without writing
cpm dedup --dry-run

# Remove duplicates across ALL discovered projects
cpm dedup --all --dry-run   # preview
cpm dedup --all --yes       # apply

# Machine-readable output
cpm dedup --json
```

`cpm dedup` removes rules that appear more than once in the same allow/deny/ask list (keeping the first occurrence). It also detects **cross-list conflicts** — when the same rule appears in both `allow` and `deny` — and reports them as warnings without auto-removing (since the resolution depends on intent; use `cpm reset` or `cpm allow`/`cpm deny` to resolve manually).

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
--json             Output as JSON (list, show, audit, diff, export, stats, search)
--no-global        Skip user/managed global settings (list, show, audit, diff, export, ui, search)
--sort <field>     Sort projects by: name | warnings | mode (list only; warnings = most warnings first)
--min-severity     Only show/report issues at or above severity: critical | high | medium | low (list and audit)
--exit-code        Exit 1 if issues found, 2 if critical issues (audit only — useful in CI)
--fix              Auto-apply all available fix commands (audit only)
--all              Apply to all discovered projects (allow, deny, ask, reset <rule>, mode, bypass-lock, preset, dedup, copy); or clear all rules across all projects (reset without rule + no --project)
--yes / -y         Skip confirmation prompt (--fix for audit; --all for allow/deny/ask/reset/mode/preset/dedup/copy)
--dry-run          Preview what would be written without modifying files (allow, deny, ask, reset, mode, init, copy, preset, dedup)
--format <fmt>     Output format: json|csv|markdown (export only, default: json)
--output <file>    Write output to file instead of stdout (export only)
--exact            Exact rule match instead of substring (search only)
--type <type>      Filter to rule list: allow | deny | ask (search and rules)
--scope <scope>    Only match rules in this scope: local | project | user | managed (search only)
--top <n>          Show only top N rules by frequency (rules only)
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

### Audit output format

`cpm audit` text output groups issues by severity. When multiple projects share the same user-scope issue (e.g. `bypassPermissions` in `~/.claude/settings.json`), the output collapses them into a single line with a project count:

```
CRITICAL (17)
  [17 projects] bypassPermissions mode is active — all permission checks disabled
    Fix:  cpm mode default --scope user

HIGH (2)
  ~/proj-a
    Bash is allowed without any specifier — all shell commands permitted
    Rule: Bash
    Fix:  cpm reset "Bash" --scope project --project ~/proj-a
  ~/proj-b
    Write is allowed without any specifier
    Rule: Write
    Fix:  cpm reset "Write" --scope project --project ~/proj-b

ℹ  3 fix(es) available. Run: cpm audit --fix
```

When you run `cpm audit --fix`, the fix list deduplicates by target file and shows how many projects are affected:

```
Auto-fixable: 2 fix(es) available
  cpm mode default --scope user (affects 17 projects)
  cpm reset "Bash" --scope project --project ~/proj-a

Apply fixes? [Y/n]
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
| `low` | `disableBypassPermissionsMode` not set (bypass mode can be activated) — fix with `cpm bypass-lock on` |
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

`cpm show --json` is the **detail view** for a single project. It nests `defaultMode`, `allow`, `deny`, `ask`, `isBypassDisabled`, `envVarNames`, and `additionalDirs` under an `effectivePermissions` key. It emits `warnings` as a full array of objects (each warning may include `rule`, `fixCmd`, and `fixOp` fields). The text output also shows `Rule:` and `Fix:` lines under each warning — the same hints as `cpm audit`.

`cpm list --json` is the **summary** format (compact, no `settingsFiles`/`claudeMdFiles`). Fields are flat at the project root. Use `cpm export --json` for the full data dump.

`cpm audit --json` output structure:
```json
{
  "generatedAt": "...", "scanRoot": "...",
  "projectCount": 3, "affectedProjectCount": 2, "cleanProjectCount": 1,
  "issueCount": 4, "minSeverity": "low",
  "issues": [
    {
      "project": "/path/to/project",
      "severity": "high",
      "message": "Bash is allowed without any specifier — all shell commands permitted",
      "rule": "Bash",
      "fix": "cpm reset \"Bash\" --scope project --project /path/to/project",
      "fixOp": { "kind": "reset", "rule": "Bash", "scope": "project" }
    }
  ],
  "errors": []
}
```
`affectedProjectCount` is the number of projects that have at least one issue. `cleanProjectCount` is projects with no issues. `minSeverity` reflects the `--min-severity` option used (default `"low"`). `fix` is the exact `cpm` command to resolve the issue (omitted when no automated fix is available). `fixOp` is the structured fix operation for programmatic use (`kind: "reset"` or `kind: "mode"`; omitted when no fix is available).

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

Tab-completes: commands, `--scope` values, `--format`, `--preset`, mode names, directory paths, and built-in tool names for `allow`/`deny`/`ask`/`reset` rules (e.g. `Bash`, `Read`, `WebFetch`).

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
