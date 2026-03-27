# Claude Code Permissions Model — Research Notes

## Settings File Hierarchy

5 levels (highest precedence first):

| Level | Path | Scope | Shared? |
|---|---|---|---|
| Managed | Linux: `/etc/claude-code/managed-settings.json`; macOS: `/Library/Application Support/ClaudeCode/managed-settings.json` | All users on machine | Yes (IT-deployed) |
| CLI args | `--permission-mode`, `--allowedTools`, `--disallowedTools` | Current session | No |
| Local project | `.claude/settings.local.json` (project dir) | You, this project | No (gitignored) |
| Shared project | `.claude/settings.json` (project dir) | All collaborators | Yes (committed to git) |
| User | `~/.claude/settings.json` | You, all projects | No |

**Merging rules:**
- Array fields (`permissions.allow`, `permissions.deny`) are concatenated and deduplicated across scopes
- Deny takes absolute precedence: if denied at ANY level, nothing can allow it

## Core settings.json Structure

```json
{
  "permissions": {
    "allow": ["Bash(npm run *)", "Read"],
    "deny": ["Read(**/.env)", "Bash(sudo:*)"],
    "ask": ["Bash"],
    "defaultMode": "acceptEdits",
    "disableBypassPermissionsMode": "disable"
  },
  "env": { "MY_VAR": "value" },
  "additionalDirectories": ["../docs/"],
  "model": "claude-opus-4-6",
  "cleanupPeriodDays": 30,
  "autoMemoryEnabled": true,
  "enableAllProjectMcpServers": false,
  "allowedMcpServers": [
    { "serverName": "github" },
    { "serverUrl": "https://mcp.company.com/*" }
  ],
  "deniedMcpServers": [{ "serverName": "dangerous-server" }],
  "allowManagedPermissionRulesOnly": true,
  "allowManagedHooksOnly": true,
  "allowManagedMcpServersOnly": true,
  "claudeMdExcludes": ["**/monorepo/CLAUDE.md"],
  "hooks": { ... },
  "autoMode": { ... }
}
```

## Tool Permissions

### Rule evaluation order: deny → ask → allow (first match wins)

### Built-in tools

| Tool | What it does |
|---|---|
| `Bash` | Shell command execution |
| `Read` | File reads |
| `Edit` | File edits |
| `Write` | File writes |
| `Glob` | Glob file search (covered by Read rules) |
| `Grep` | File content search (covered by Read rules) |
| `WebFetch` | HTTP fetch requests |
| `WebSearch` | Web search |
| `Agent(name)` | Subagent execution |
| `mcp__servername` | All tools from named MCP server |
| `mcp__servername__toolname` | Specific MCP tool |

### Rule syntax

```
ToolName                          -- allow/deny all uses of this tool
ToolName(specifier)               -- allow/deny with glob-style specifier
```

**Bash specifiers:**
- `Bash(npm run *)` — prefix wildcard
- `Bash(* --version)` — suffix wildcard
- `Bash(git * main)` — middle wildcard
- Space before `*` = word boundary: `Bash(ls *)` matches `ls -la` but not `lsof`

**File path specifiers (Read/Edit/Write):**
- `//path` — absolute filesystem path
- `~/path` — home-directory relative
- `/path` — project-root relative
- `path` or `./path` — CWD relative
- Pattern: `Read(**/.env)`, `Edit(/src/**/*.ts)`, `Write(~/.zshrc)`

**WebFetch:** `WebFetch(domain:example.com)`

**MCP:** `mcp__github`, `mcp__github__create_issue`

## Permission Modes

Set via `permissions.defaultMode` or `--permission-mode` CLI flag:

| Mode | Value | Behavior |
|---|---|---|
| Default | `"default"` | Read files only; prompts for edits and Bash |
| Accept Edits | `"acceptEdits"` | Read + edit files; still prompts for Bash |
| Plan | `"plan"` | Read only; cannot modify files or run Bash |
| Auto | `"auto"` | All actions reviewed by safety classifier |
| Don't Ask | `"dontAsk"` | Only pre-approved tools; auto-denies rest |
| Bypass Permissions | `"bypassPermissions"` | DANGEROUS — all actions, no checks |

## MCP Servers

### Config file locations

| Scope | File |
|---|---|
| User (personal, all projects) | `~/.claude.json` under `mcpServers` key |
| Local (personal, this project) | `~/.claude.json` under per-project path |
| Project (team) | `.mcp.json` in project root |
| Managed | `/etc/claude-code/managed-mcp.json` |

### .mcp.json format

```json
{
  "mcpServers": {
    "my-server": {
      "command": "/path/to/server",
      "args": ["--flag"],
      "env": { "API_KEY": "${MY_API_KEY}" }
    },
    "http-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://default.com}/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

### MCP trust levels

- **Local/user scoped**: user-added, trusted automatically
- **Project scoped** (`.mcp.json`): prompts for approval on first use
- **Managed**: exclusive control, no user override

## CLAUDE.md Files

CLAUDE.md is **context/instructions**, NOT enforced configuration.

| Scope | Path |
|---|---|
| Managed | `/etc/claude-code/CLAUDE.md` (Linux) |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` |
| User | `~/.claude/CLAUDE.md` |

Also: `.claude/rules/` directory with optional frontmatter `paths:` for file-scoped activation.

CLAUDE.md does NOT grant or restrict permissions. It can indirectly influence `auto` mode classifier behavior.

## ~/.claude.json

This is the main Claude Code state file (not `settings.json`). It contains:
- User preferences
- MCP server configurations per-project
- Project-level MCP approval state
- Session data

The structure is roughly:
```json
{
  "projects": {
    "/path/to/project": {
      "mcpServers": { ... },
      "mcpServerApprovals": { "servername": "approved" | "denied" }
    }
  },
  "mcpServers": {
    "global-server": { ... }
  }
}
```

## Key Behaviors to Model

1. **Discovery**: Find all `.claude/` directories recursively on filesystem
2. **Multi-scope**: Each project may have both `.claude/settings.json` (shared) and `.claude/settings.local.json` (local)
3. **Global settings**: `~/.claude/settings.json` applies to all projects
4. **Managed settings**: `/etc/claude-code/managed-settings.json` applies to all users (enterprise)
5. **MCP configs**: Separate from settings — `.mcp.json` in project root, `~/.claude.json` for user-level
6. **Merge semantics**: Arrays merge, deny wins, managed wins
7. **CLAUDE.md**: Find and display content but note it's not enforced config
