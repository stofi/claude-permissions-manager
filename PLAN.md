# Implementation Plan

## Phase 1: Scaffold & Core (Milestone: basic list works)

### 1.1 TypeScript project setup
- `package.json` with bin, type=module, deps
- `tsconfig.json`
- `src/` directory structure
- Entry point `src/cli.ts`
- Dev script to run with `tsx`

### 1.2 Settings parser
- Zod schemas for `settings.json`, `.mcp.json`, `~/.claude.json`
- Load and validate each file type
- Handle parse errors gracefully

### 1.3 Discovery engine
- Scan filesystem starting from `~` (or `--root`)
- Find all `.claude/` directories
- Respect depth limit and exclusion list
- Detect and handle symlinks
- Skip `/proc`, `/sys`, `/dev`, system dirs

### 1.4 Permission merger
- Load global (user + managed) settings
- For each project: load project + local settings
- Merge arrays (concat + dedup)
- Compute effective permissions
- Generate warnings

### 1.5 Basic CLI output (no TUI)
- `cpm list` — table of all projects
- `cpm show <path>` — details for one project
- JSON output mode (`--json`)

**Milestone checkpoint**: `npx cpm list` outputs a table of all discovered projects with their modes and permission counts.

---

## Phase 2: Interactive TUI (Milestone: full navigation)

### 2.1 Ink setup
- Basic Ink app structure
- Screen router (main list / detail / audit / diff)
- Keyboard navigation
- Color scheme and styling

### 2.2 Project List screen
- Paginated list with arrow navigation
- Mode badge, counts, warning indicators
- Search/filter bar

### 2.3 Project Detail screen
- Settings file status (present/missing/error)
- Effective permissions grouped by list (allow/deny/ask)
- Source scope label for each rule
- MCP servers section
- CLAUDE.md files section

### 2.4 Audit screen
- Scan all projects for risky permissions
- Group by severity (critical/high/medium/low)
- Show affected project + rule

### 2.5 Diff screen
- Select two projects to compare
- Side-by-side effective permissions diff
- Highlight additions/removals

**Milestone checkpoint**: Full TUI navigation between all screens.

---

## Phase 3: Management Operations (Milestone: can modify settings)

### 3.1 Add permission rule
- From TUI: prompt for tool + specifier + list + scope
- From CLI: `cpm allow <rule> [--project] [--scope]`
- Atomic file write (temp file + rename)
- Validate rule syntax before writing

### 3.2 Remove permission rule
- From TUI: select rule, confirm, remove
- From CLI: `cpm reset <rule> [--project] [--scope]`

### 3.3 Change permission mode
- From TUI: select mode from list
- From CLI: `cpm mode <mode> [--project] [--scope]`

### 3.4 Open in editor
- `cpm edit [--project] [--scope]` → opens in `$EDITOR`
- TUI: press `e` to open raw settings.json

### 3.5 Reset/clear all rules
- `cpm reset --all [--project] [--scope]`
- Confirmation prompt

**Milestone checkpoint**: All CRUD operations on settings files working correctly.

---

## Phase 4: Packaging & Polish (Milestone: publishable)

### 4.1 Build pipeline
- `tsc` compilation to `dist/`
- Test `npx` invocation
- Ensure shebang in entry point

### 4.2 Export command
- `cpm export [--format json|yaml|csv]`
- Full permissions dump for all projects

### 4.3 Error handling & UX polish
- Graceful errors for all file operations
- `--verbose` flag for debug output
- Spinner during filesystem scan

### 4.4 Tests
- Unit tests for parser, merger, discovery
- Integration test: scan fixture directory tree

### 4.5 Documentation
- README.md with install, usage, examples
- Man page or `--help` text

**Milestone checkpoint**: `npx claude-permissions-manager` works cleanly; ready for npm publish.

---

## Directory Structure

```
claude-permissions-manager/
├── src/
│   ├── cli.ts                 # Entry point, command registration
│   ├── commands/
│   │   ├── list.ts
│   │   ├── show.ts
│   │   ├── allow.ts
│   │   ├── deny.ts
│   │   ├── reset.ts
│   │   ├── diff.ts
│   │   ├── audit.ts
│   │   └── export.ts
│   ├── core/
│   │   ├── discovery.ts       # Filesystem scan
│   │   ├── parser.ts          # Parse settings.json, .mcp.json, ~/.claude.json
│   │   ├── merger.ts          # Merge settings across scopes
│   │   ├── schemas.ts         # Zod schemas
│   │   └── writer.ts          # Atomic settings file writes
│   ├── tui/
│   │   ├── app.tsx            # Root Ink component + screen router
│   │   ├── screens/
│   │   │   ├── ProjectList.tsx
│   │   │   ├── ProjectDetail.tsx
│   │   │   ├── Audit.tsx
│   │   │   └── Diff.tsx
│   │   └── components/
│   │       ├── PermissionRule.tsx
│   │       ├── McpServer.tsx
│   │       ├── Badge.tsx
│   │       └── StatusBar.tsx
│   └── utils/
│       ├── paths.ts           # Path utilities, home dir expansion
│       └── format.ts          # Table formatting for non-TUI output
├── dist/                      # Compiled output (gitignored)
├── SPEC.md
├── PLAN.md
├── RESEARCH.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dependencies

### Runtime
- `ink` + `react` — TUI
- `commander` — CLI arg parsing
- `zod` — Settings schema validation
- `fast-glob` — Filesystem scanning
- `chalk` — Colors for non-TUI output

### Dev
- `typescript`
- `tsx` — Dev runner (run TS directly)
- `@types/node`
- `@types/react`

---

## Risk Register

| Risk | Mitigation |
|---|---|
| `~/.claude.json` structure is undocumented | Parse defensively, use Zod `.partial()` schemas |
| Platform differences (macOS vs Linux paths for managed settings) | Abstract platform paths behind utility function |
| Very large home dirs slow to scan | Default depth limit 8, skip common exclusions, async scanning |
| Atomic write fails on read-only fs | Catch and report clearly |
| Ink not compatible with all terminals | Fall back to non-interactive output if stdout is not a TTY |
| Breaking changes to settings format | Version-aware schema with forward compat |
