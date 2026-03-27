# Claude Permissions Manager — Specification

## Overview

`claude-permissions-manager` (`cpm`) is a CLI tool that discovers all Claude Code project configurations on your machine, summarizes the granted permissions, and lets you interactively manage them. It runs via `npx claude-permissions-manager` (or `cpm` when installed globally).

## Goals

1. **Discover**: Find every `.claude/` directory on the filesystem
2. **Analyze**: Parse and summarize permissions at all scopes (managed, user, project, local)
3. **Display**: Present a readable, navigable view of permissions across projects
4. **Manage**: Allow/deny/reset permissions interactively or via CLI flags

## Non-Goals

- Does not modify or interact with the Claude Code process
- Does not manage Claude Code sessions or conversations
- Does not interpret or enforce CLAUDE.md content

---

## Data Model

### Permission Rule

```typescript
interface PermissionRule {
  tool: string;           // e.g., "Bash", "Read", "mcp__github"
  specifier?: string;     // e.g., "npm run *", "**/.env"
  raw: string;            // original string e.g. "Bash(npm run *)"
}
```

### Settings File

```typescript
interface SettingsFile {
  path: string;
  scope: "managed" | "user" | "project" | "local";
  exists: boolean;
  parsed: boolean;        // false if file exists but couldn't be parsed
  data?: {
    permissions?: {
      allow?: string[];
      deny?: string[];
      ask?: string[];
      defaultMode?: PermissionMode;
      disableBypassPermissionsMode?: "disable";
    };
    env?: Record<string, string>;
    additionalDirectories?: string[];
    model?: string;
    enableAllProjectMcpServers?: boolean;
    allowedMcpServers?: McpServerFilter[];
    deniedMcpServers?: McpServerFilter[];
    allowManagedPermissionRulesOnly?: boolean;
    allowManagedMcpServersOnly?: boolean;
    claudeMdExcludes?: string[];
    autoMode?: AutoModeConfig;
  };
}
```

### MCP Server Config

```typescript
interface McpServerConfig {
  name: string;
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;  // variable names only (values may be secret)
  headers?: Record<string, string>;  // variable names only
  scope: "managed" | "user" | "project";
  approvalState?: "approved" | "denied" | "pending";
}
```

### Claude Project

```typescript
interface ClaudeProject {
  rootPath: string;                    // project directory containing .claude/
  claudeDir: string;                   // .claude/ directory path
  settingsFiles: SettingsFile[];       // project + local settings
  mcpFile?: McpFile;                   // .mcp.json if present
  claudeMdFiles: ClaudeMdFile[];       // CLAUDE.md files in project
  effectivePermissions: EffectivePermissions;  // merged view
}
```

### Effective Permissions (merged across scopes)

```typescript
interface EffectivePermissions {
  defaultMode: PermissionMode;
  allow: PermissionRule[];             // merged from all scopes (deduped)
  deny: PermissionRule[];             // merged from all scopes (deduped)
  ask: PermissionRule[];              // merged from all scopes (deduped)
  isBypassDisabled: boolean;
  mcpServers: McpServerConfig[];
  envVarsSet: string[];               // names of env vars (not values)
  additionalDirs: string[];
  warnings: string[];                  // e.g., "bypassPermissions mode is active"
}
```

### Permission Mode

```typescript
type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";
```

---

## Discovery Algorithm

### Phase 1: Global contexts

1. Managed settings: check `/etc/claude-code/managed-settings.json` (Linux) or platform equivalent
2. User settings: check `~/.claude/settings.json`
3. User MCP configs: parse `~/.claude.json` (extract per-project `mcpServers` and global)

### Phase 2: Project discovery

Starting from a root directory (default: `~`), scan for `.claude/` directories:

```
find ~ -name ".claude" -type d 2>/dev/null
```

Exclusions:
- `node_modules/`
- `.git/` (but don't skip the `.git` directory itself)
- Paths matching user-configured excludes

For each `.claude/` directory found:
1. Determine project root = parent of `.claude/`
2. Look for `settings.json` and `settings.local.json` inside `.claude/`
3. Look for `.mcp.json` in project root
4. Look for `CLAUDE.md` in project root and `.claude/CLAUDE.md`
5. Extract MCP project entry from `~/.claude.json` if present

### Phase 3: Merge effective permissions

For each project, compute effective permissions by merging:
1. Managed settings (highest priority for deny)
2. User settings
3. Project settings (`.claude/settings.json`)
4. Local settings (`.claude/settings.local.json`)

Rules:
- `allow`, `deny`, `ask` arrays are concatenated and deduplicated
- `deny` at any level wins absolutely
- `defaultMode` — most restrictive (or first-set) wins; user can override per-project
- `model` — local > project > user > managed

---

## CLI Interface

### Commands

```
cpm                          # Launch interactive TUI (default)
cpm list                     # List all discovered projects (table, non-interactive)
cpm show <path>              # Show full permissions for a specific project
cpm allow <tool> [--project <path>] [--scope local|project|user]
cpm deny <tool>  [--project <path>] [--scope local|project|user]
cpm reset <tool> [--project <path>] [--scope local|project|user]
cpm diff <path1> <path2>     # Compare permissions between two projects
cpm audit                    # Report suspicious/risky permissions across all projects
cpm export [--format json|yaml|csv]  # Export all permissions data
```

### Flags

```
--root <dir>       Override discovery root (default: ~)
--depth <n>        Max directory depth for scanning (default: 8)
--exclude <glob>   Additional paths to exclude
--no-global        Skip user and managed settings
--json             Output as JSON (for piping to other tools)
--color/--no-color
--help, -h
--version, -v
```

---

## Interactive TUI

Built with [Ink](https://github.com/vadimdemedes/ink) (React for terminal).

### Main Screen: Project List

```
╔══════════════════════════════════════════════════════════════╗
║  Claude Permissions Manager                        v0.1.0   ║
╠══════════════════════════════════════════════════════════════╣
║  Found 12 projects  │  3 warnings  │  Mode: acceptEdits     ║
╠══════════════════════════════════════════════════════════════╣
║ > ~/code/my-project          [default]  2 allow  1 deny      ║
║   ~/code/other-project       [auto]     5 allow  0 deny  ⚠  ║
║   ~/code/work/api            [bypass]   0 allow  0 deny  🚨  ║
║   ~/code/clawdius            [accept]   8 allow  3 deny      ║
║   [global user settings]     [default]  3 allow  1 deny      ║
╠══════════════════════════════════════════════════════════════╣
║  ↑↓ navigate  Enter: details  d: diff  a: audit  q: quit    ║
╚══════════════════════════════════════════════════════════════╝
```

### Detail Screen: Project Permissions

```
╔══════════════════════════════════════════════════════════════╗
║  ~/code/my-project                              [←] back     ║
╠══════════════════════════════════════════════════════════════╣
║  SETTINGS FILES                                              ║
║    .claude/settings.json       ✓ (project, shared)           ║
║    .claude/settings.local.json ✗ (not present)               ║
║    ~/.claude/settings.json     ✓ (user global)               ║
╠══════════════════════════════════════════════════════════════╣
║  EFFECTIVE PERMISSIONS  (merged)                             ║
║  Mode: acceptEdits                                           ║
║                                                              ║
║  ALLOW                                                       ║
║    Bash(npm run *)             [project]                     ║
║    Read                        [user]                        ║
║    Edit(/src/**)               [project]                     ║
║                                                              ║
║  DENY                                                        ║
║    Read(**/.env)               [project]                     ║
║                                                              ║
║  ASK                                                         ║
║    Bash(git push *)            [project]                     ║
╠══════════════════════════════════════════════════════════════╣
║  MCP SERVERS                                                 ║
║    github    [user]      stdio  approved                     ║
║    platform  [project]   http   pending                      ║
╠══════════════════════════════════════════════════════════════╣
║  CLAUDE.md                                                   ║
║    ./CLAUDE.md           ✓ (113 lines)                       ║
║    ./.claude/CLAUDE.md   ✗                                   ║
╠══════════════════════════════════════════════════════════════╣
║  a: allow  d: deny  r: reset  e: edit raw  ←: back          ║
╚══════════════════════════════════════════════════════════════╝
```

### Audit Screen

Lists all risky permissions across all discovered projects:

- `bypassPermissions` mode enabled (critical)
- `disableBypassPermissionsMode` is NOT set in managed (warning)
- `Bash(*)` or `Bash` with no specifier (high)
- `allow: ["*"]` (high)
- MCP servers with pending/unapproved state (medium)
- Sensitive file paths in allow rules (e.g., `~/.ssh/*`, `**/.env`) (medium)
- No deny rules at all (low)

### Diff Screen

Side-by-side comparison of two projects' effective permissions.

---

## Management Operations

### Add a rule

```
cpm allow "Bash(npm run *)" --project ~/code/my-project --scope project
```

1. Parse the target settings file (or create it if missing with `{}`)
2. Add the rule to `permissions.allow` array
3. Deduplicate
4. Write back to file (pretty-print JSON, preserve comments where possible)

### Remove a rule

```
cpm reset "Bash(npm run *)" --project ~/code/my-project --scope project
```

Removes from all three lists (allow/deny/ask) in the target scope file.

### Change mode

```
cpm mode acceptEdits --project ~/code/my-project --scope project
```

Sets `permissions.defaultMode` in the target file.

### Interactive editing

From the detail screen:
- `a` → prompt for tool name/specifier → select list (allow/deny/ask) → select scope → write
- `d` → select rule from list → confirm → remove from file
- `r` → remove all rules for this project (with confirmation)
- `e` → open raw settings.json in `$EDITOR`

---

## Output Formats

### Table (default CLI output)

```
Project                    Mode          Allow  Deny  Ask  MCP  Warnings
~/code/my-project          acceptEdits       3     1    1    2
~/code/other-project       auto              5     0    0    0       ⚠
```

### JSON export

```json
{
  "generatedAt": "2026-03-26T12:00:00Z",
  "globalSettings": { ... },
  "managedSettings": { ... },
  "projects": [
    {
      "path": "~/code/my-project",
      "settings": { ... },
      "effectivePermissions": { ... },
      "mcpServers": [ ... ],
      "warnings": []
    }
  ]
}
```

---

## Edge Cases

1. **Unreadable settings.json**: Show as `[parse error]`, display raw content preview
2. **Symlinked .claude dirs**: Detect and warn (to avoid infinite loops)
3. **Very deep trees**: Enforce `--depth` limit (default 8)
4. **No `.claude/` found**: Clear message with hint to create one
5. **Managed settings present**: Show with different color/label, note it cannot be edited
6. **Empty settings files**: Treat as no rules configured
7. **Unknown fields in settings.json**: Pass through / display as "other settings"
8. **Concurrent file writes**: Use atomic write (write to temp file, rename)
9. **Home directory as project root**: Detect `~/.claude/` as user-global scope
10. **Root/system dirs**: Skip `/proc`, `/sys`, `/dev`, etc.
11. **Env var secrets in MCP config**: Display variable NAMES only, not values

---

## Security Considerations

- Never display env var values from settings files (only names)
- Never display MCP header values (only names)
- Warn prominently for `bypassPermissions` mode
- Warn for overly broad allow rules
- Atomic file writes to prevent corruption

---

## Packaging

- **Package name**: `claude-permissions-manager` (npm)
- **Binary name**: `cpm`
- **Runs via**: `npx claude-permissions-manager`
- **Node.js version**: ≥18 (for native `fetch`, `fs.promises`, etc.)
- **Runtime**: TypeScript compiled to ESM, no bundler needed (uses `tsc`)
- **No sudo required**: Reads/writes only user-owned files

### package.json essentials

```json
{
  "name": "claude-permissions-manager",
  "version": "0.1.0",
  "bin": { "cpm": "./dist/cli.js" },
  "type": "module",
  "engines": { "node": ">=18" }
}
```

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `ink` + `react` | Interactive TUI |
| `ink-table` or custom | Table rendering in TUI |
| `commander` | CLI argument parsing |
| `zod` | Schema validation for settings JSON |
| `fast-glob` | Efficient filesystem scanning |
| `chalk` | Terminal colors (non-TUI output) |
| `@sindresorhus/execa` or `execa` | (optional) Open editor |
| `typescript` | Development only |
