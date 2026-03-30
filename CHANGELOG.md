# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.4] - 2026-03-30

### Tests
- **`showCommand --no-global`: verify `settingsFiles` also excludes global entries**: The existing test checked that `effectivePermissions` rules had no user/managed scope, but did not verify that `settingsFiles` in the JSON output also excludes global file entries. Added a second test mirroring the equivalent check in `exportCommand`.

## [1.3.3] - 2026-03-30

### Internal
- **`manage.ts`: replaced unsafe chalk cast with typed function map**: `modeCommand` was using `(chalk as unknown as Record<string, fn>)[color]` to apply colour by string name. Replaced with a `Record<string, (s: string) => string>` map of chalk function references — the same pattern used in `format.ts` — eliminating the double cast entirely. No behaviour change.

## [1.3.2] - 2026-03-30

### Internal
- **`diff.ts`: removed duplicated `mcpBothNames` computation**: `mcpBothNames` was computed inside the JSON branch and then recomputed as `mcpBothNamesText` with identical logic in the text branch. Hoisted to a single variable shared by both paths. No behaviour change.

## [1.3.1] - 2026-03-30

### Fixed
- **TUI Diff: footer hint text shows `↑↓/jk`**: The Diff screen's footer for the selectA and selectB phases showed `↑↓ select` even though j/k navigation was implemented. Updated to `↑↓/jk select` for consistency with the ProjectList and Audit screens.

## [1.3.0] - 2026-03-30

### Added
- **`cpm show --no-global`**: The `show` command now supports `--no-global` to skip user and managed global settings when scanning, consistent with `list`, `audit`, `export`, and `ui`. Global settings are still included by default.
- **`cpm diff --no-global`**: The `diff` command now supports `--no-global` to exclude user/managed settings from the effective permissions comparison on both sides.
- Shell completion updated: `--no-global` tab-completes for both `show` and `diff` in bash and zsh.

### Internal
- Tests: 247 (+2 `showCommand --no-global` and `diffCommand --no-global` tests).

## [1.2.9] - 2026-03-30

### Improved
- **`cpm init --mode` parse-time validation**: The `--mode` override option on the `init` command now uses `Option.choices(PermissionModeSchema.options)`, completing the Commander choices coverage across all mode-bearing inputs. Invalid modes like `--mode bogus` fail at parse time with a clear error listing all 6 valid choices.
- **README: Audit warnings reference**: Added a complete warnings catalogue table documenting all warning severities and triggers, including the `acceptEdits` (MEDIUM) and `additionalDirs` (LOW) warnings added in v1.2.6.

## [1.2.8] - 2026-03-30

### Improved
- **`cpm mode <mode>` parse-time validation**: The mode positional argument now uses `Argument.choices()` — invalid modes like `cpm mode bogus` are rejected immediately with a Commander error listing all valid choices, instead of failing inside `modeCommand()`. Help text shows `(choices: "default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions")`.
- **`cpm init --preset` parse-time validation**: The `--preset` option now uses `Option.choices(["safe","node","strict"])` — invalid presets fail at parse time with a Commander error. Consistent with the `--scope` fix in v1.2.5.

## [1.2.7] - 2026-03-30

### Fixed
- **`additionalDirs` warning suppressed when `bypassPermissions` is active**: When `bypassPermissions` mode is the effective mode, the LOW "N additional directories configured" warning is now suppressed. It was redundant noise alongside the CRITICAL bypass warning, following the same suppression pattern already used for the `disableBypassPermissionsMode` LOW warning.

### Internal
- Test coverage: 245 tests (+1 additionalDirs bypass-suppression test).

## [1.2.6] - 2026-03-30

### Added
- **`acceptEdits` mode audit warning (MEDIUM)**: `cpm audit` now emits a MEDIUM severity warning when `acceptEdits` mode is active — "acceptEdits mode is active — file edits are accepted without confirmation prompts". This alerts users in shared/project settings when Claude will silently accept all file edits without showing them for review.
- **`additionalDirs` expansion audit warning (LOW)**: `cpm audit` now emits a LOW severity warning when `additionalDirectories` are configured — "N additional director(y/ies) configured — Claude has filesystem access beyond the project root". Helps users notice when Claude's filesystem access scope has been expanded.

### Internal
- Test coverage: 244 tests (+6: 2 acceptEdits warnings tests, 4 additionalDirs warning tests).

## [1.2.5] - 2026-03-30

### Improved
- **`--scope` option now shows valid choices in `--help`**: All write commands (`allow`, `deny`, `ask`, `mode`, `reset`, `init`) now use Commander's `Option.choices()` for `--scope`. This produces `(choices: "local", "project", "user")` in the help text and rejects invalid scope values at parse time with a clear error message instead of at runtime. E.g. `cpm allow "Read" --scope managed` now immediately errors: `option '--scope <scope>' argument 'managed' is invalid. Allowed choices are local, project, user.`

## [1.2.4] - 2026-03-30

### Fixed
- **`mcpServerChanged` now detects `headerNames` differences**: Both `cpm diff` and the TUI Diff screen were missing `headerNames` from the comparison function — servers with identical commands but different HTTP headers would incorrectly appear identical. Fixed in both `diff.ts` and `Diff.tsx`.
- **`cpm diff` text: false "identical" banner when same-named MCPs have different config**: `hasChanges` used name-set comparison only (same bug as JSON in v1.2.3). Two projects with modified same-named MCPs would show `~ name (modified)` correctly but still print `✓ Projects have identical effective permissions.` Fixed.
- **`cpm diff` text: envVarNames/headerNames changes missing from modified MCP detail lines**: When a same-named server differed only in env vars or headers, the `~ name (modified)` indicator appeared but no detail line was printed. Fixed: now prints `env:` and `headers:` change lines.
- **TUI Diff screen: envVarNames/headerNames changes missing from modified MCP display**: Same issue in `Diff.tsx`. Fixed.

### Documentation
- **README `cpm diff --json` section**: Fully documented all JSON fields including `mode`, `isBypassDisabled`, `envVarNames`, `additionalDirs`, `mcpServers.modified`, and the object shapes.

### Internal
- Test coverage: 238 tests (+4 diff text output tests).

## [1.2.3] - 2026-03-30

### Fixed
- **`cpm diff` MCP server config comparison**: Same-named MCP servers with different configurations (command, args, url, type, approvalState, or env var names) were incorrectly reported as identical. Now correctly detected as "modified" with a `~` indicator in text output and a `modified` array in `--json` output.
- **`cpm diff --json` `identical` flag**: Was `true` when two projects had same-named MCP servers but with different configs. Now correctly `false`.
- **`cpm diff --json` `mcpServers.inBoth`**: Previously included same-named servers even when their configs differed. Now `inBoth` only contains truly unchanged servers; changed servers appear in the new `mcpServers.modified` array.
- **TUI Diff screen `isIdentical`**: Fixed the same name-only comparison bug so the "✓ Projects have identical effective permissions" message is no longer shown when same-named MCP servers have different configs.
- **TUI Diff MCP display**: Same-named modified servers now show a `~` indicator with per-field change lines (type, cmd, url, approval state) instead of displaying as identical.

### Internal
- Test coverage: 234 tests (+2 diff MCP tests).

## [1.2.2] - 2026-03-30

### Added
- **`cpm init --dry-run`**: Preview what `init` would create or overwrite without writing any files. Shows the target file path (with "would create", "already exists", or "would overwrite" status), the mode, and all allow/deny/ask rules the preset would apply. Consistent with `--dry-run` on all other write commands.
- **Audit warnings for wildcard `*` in deny/ask lists**: `cpm audit` now warns when `"*"` appears in the deny list (MEDIUM: "all tools blocked regardless of allow rules") or ask list (LOW: "all tools require explicit approval"). Previously only `allow: ["*"]` triggered a wildcard warning (HIGH).

### Internal
- Test coverage: 232 tests (+4 init --dry-run tests, +3 merger wildcard deny/ask warning tests).
- Shell completion: bash and zsh completions updated for `cpm init --dry-run`.
- README: `--dry-run` flag description updated to include `init`.

## [1.2.1] - 2026-03-30

### Documentation
- **README JSON format matrix**: Added a per-command capability table clarifying which fields each command emits, where they are nested, and the format differences between `list/export` (flat) and `show` (nested under `effectivePermissions`). Also notes that `diff --json` does not compare `claudeMdFiles` or `settingsFiles`.
- **Clarified `effectivePermissions` nesting**: README now explicitly documents that `isBypassDisabled`, `envVarNames`, `additionalDirs`, `allow`, `deny`, and `ask` are nested inside `effectivePermissions` in `show --json` (not just `defaultMode`).

### Internal
- Strengthened `claudeMdFiles` tests: both `export --json` and `show --json` now assert `lineCount` is a number > 0 for existing CLAUDE.md files. Show test was updated to use a temp project with a real CLAUDE.md instead of a fixture with no CLAUDE.md files.

## [1.2.0] - 2026-03-30

### Changed (breaking)
- **`cpm export --json` `claudeMdFiles`**: Each project record now emits `claudeMdFiles` as an array of objects (`{ path, scope, exists, lineCount? }`), consistent with `cpm show --json`. Previously it was a string array of paths filtered to only existing files — this was lossy and inconsistent. Update any consumers that iterated `project.claudeMdFiles` as strings to access `.path` instead.

### Documentation
- Expanded "JSON output format" section in README with per-command format differences: show nesting vs list/export flat structure, `warningCount` vs `warnings`, `claudeMdFiles`/`settingsFiles` object shapes, `mcpServers` full field reference, `audit --json` structure, and `diff --json` conventions.

### Internal
- Test coverage: 225 tests (+2 for claudeMdFiles object shape in export and show JSON).

## [1.1.1] - 2026-03-30

### Fixed
- **`cpm export --json` `settingsFiles`**: Each project record in the export now includes global settings files (user scope: `~/.claude/settings.json`; managed scope) in its `settingsFiles` array, consistent with `cpm show --json`. Previously only local and project-scope settings files were included. Pass `--no-global` to exclude global entries.

### Internal
- Test coverage: 223 tests (+2 export `settingsFiles` shape and `--no-global` exclusion tests).

## [1.1.0] - 2026-03-30

### Changed (breaking)
- **`cpm list --json` and `cpm export --json`**: The `warnings` field (which was a count integer) has been renamed to `warningCount` to disambiguate it from `cpm show --json` where `warnings` is a full `Warning[]` array. Update any scripts that read `.warnings` from list/export JSON to use `.warningCount`. The `cpm export --format csv` header column also changed from `warnings` to `warning_count`.

### Internal
- Test coverage: 221 tests (+1 export JSON `warningCount` field assertion).

## [1.0.6] - 2026-03-29

### Added
- **`dontAsk` mode warning**: `cpm audit` now emits a HIGH severity warning when `defaultMode` is `"dontAsk"` — this mode auto-executes all actions without asking for permission (deny rules still apply). Previously only `bypassPermissions` mode was warned about.
- **TUI ProjectList `[lock]` badge**: The project list in the interactive TUI now shows a green `[lock]` indicator for projects where `disableBypassPermissionsMode` is set (`isBypassDisabled: true`), consistent with `cpm list` text output (added in v1.0.5) and the Project Detail screen.

### Internal
- Test coverage: 220 tests (+2 merger tests for `dontAsk` warning, +1 discovery test for empty-directory scan returning 0 projects/0 errors).

## [1.0.5] - 2026-03-29

### Added
- **`cpm list` text output**: A green `[locked]` indicator now appears in the flags/warnings column for projects where `disableBypassPermissionsMode` is set (`isBypassDisabled: true`). Previously this was only visible in `cpm show` text output and `cpm list --json`. The column header is updated from "Warnings" to "Flags/Warnings".

### Internal
- Test coverage: 217 tests (+2 for the `[locked]` indicator in list text output).

## [1.0.4] - 2026-03-29

### Fixed
- **`cpm diff` text output**: "Bypass lock:" line is now always shown (with a "(same)" suffix when equal), consistent with how "Mode:" is displayed. Previously it was only shown when the two projects differed.

## [1.0.3] - 2026-03-29

### Fixed
- **Default action**: Running `cpm` with no subcommand now correctly respects `--root`, `--depth`, and `--no-global` flags. Previously these flags were silently ignored and the hardcoded defaults (root=`~`, depth=8, global=true) were always used. The flags are now defined on the root program and passed through to `uiCommand` / `listCommand`.

### Internal
- Test coverage: 215 tests (+1 for `includeGlobal=false` excluding user-scoped rules from list output).

## [1.0.2] - 2026-03-29

### Changed
- **Discovery scan performance**: Added 16 common build/cache directory names to the skip list (`dist`, `build`, `out`, `target`, `.next`, `.nuxt`, `.output`, `.svelte-kit`, `.astro`, `.turbo`, `.parcel-cache`, `coverage`, `.nyc_output`, `.pytest_cache`, `.tox`, `.gradle`, `env`). Scans on large monorepos and framework projects are significantly faster.

### Fixed
- **Discovery**: Broken symlinks (target deleted or inaccessible) are now recorded in `result.errors` with a `"Broken symlink: ..."` message instead of being silently skipped. Helps diagnose why a project might disappear from scan results.

### Docs
- **README**: Clarified `--exit-code` table — exit code `1` means "any non-critical issue found", not just "warnings of high/medium/low severity".

## [1.0.1] - 2026-03-29

### Fixed
- **discovery**: A `.claude` directory that is a symlink resolving to `~/.claude` was incorrectly treated as a project. The path comparison now uses the canonicalised (resolved) path so symlinks pointing to the user global settings directory are correctly skipped.

### Internal
- Test coverage: 214 tests (+1 symlink regression test in `discovery.test.ts`).

## [1.0.0] - 2026-03-29

### Changed
- **Version**: First stable release. The JSON API, CLI commands, and TUI are considered stable.

### Fixed
- **npm package**: Removed stale `dist/tui/components/KeyHints.*` files that were orphaned when the component was deleted. These were being published unnecessarily (119 → 115 files).

### Internal
- Added `clean` script (`npm run clean` → `rm -rf dist`).
- `prepublishOnly` now runs `clean` before `build` to prevent stale orphaned dist files from ever being published.
- Added `tests/` and `*.tgz` to `.npmignore` for explicit exclusion.

## [0.9.10] - 2026-03-29

### Docs
- **README**: Added `Ctrl+C` as a documented quit option in the TUI.
- **TUI ProjectDetail**: In-screen key hint bar now shows `h` alongside `←`/`Esc`/`q` for back navigation, consistent with README and keyboard handler.

## [0.9.9] - 2026-03-29

### Fixed
- **`cpm list/show/diff --json`**: MCP server `envVarNames` and `headerNames` fields now always emit `[]` instead of `undefined` when not set — consistent with `export --json` behavior.

### Docs
- **README**: Added `h` (Vi-style left navigation) as a documented back shortcut in the Project Detail TUI screen.

## [0.9.8] - 2026-03-29

### Fixed
- **`cpm list --json`**: Each project record now includes `envVarNames` and `additionalDirs` arrays — consistent with `show --json`, `export --json`, and `diff --json`.
- **`cpm export --json` `globalSettings.userMcpServers`**: Now includes the `scope` field — consistent with all other MCP server objects across every JSON output.

### Internal
- Test coverage: 213 tests (+2 assertions for the above fixes).

## [0.9.7] - 2026-03-29

### Fixed
- **TUI Diff screen**: MCP SERVERS section now shows `cmd:` and `url:` connection details below each server name — consistent with the TUI Project Detail screen. Previously only server names were displayed, making it impossible to see *how* a server connects.

## [0.9.6] - 2026-03-29

### Fixed
- **`cpm export --json` globalSettings**: `userMcpServers` now includes `approvalState`, `command`, `args`, and `url` fields — consistent with per-project MCP server objects across all JSON outputs.

### Added
- **merger**: LOW warnings for misconfigured MCP servers — `type: "stdio"` with no `command`, and `type: "http"` with no `url`. These servers would fail at runtime; now surfaced at audit/scan time.

### Internal
- Test coverage: 211 tests (+3 merger tests for MCP config warnings, +1 audit JSON `errors` field assertion).

## [0.9.5] - 2026-03-29

### Fixed
- **`cpm diff --json`**: `mcpServers.onlyInA` and `mcpServers.onlyInB` were plain strings (server names only). Now emit full server objects with `name`, `type`, `scope`, `approvalState`, `command`, `args`, `url`, `envVarNames`, `headerNames` — consistent with list/show/export. `inBoth` remains plain strings.
- **README**: `--dry-run` flag documentation incorrectly listed `reset --all` as the only reset that supports it; updated to `reset` (both single-rule and `--all` support `--dry-run` since v0.9.3).

### Internal
- Test coverage: 208 tests (+2 `removeRule` dryRun unit tests in writer.test.ts, +1 `diffCommand --json` MCP objects test).

## [0.9.4] - 2026-03-29

### Fixed
- **`cpm list --json`**: MCP server records now include `command`, `args`, and `url` fields — consistent with `cpm show --json` and `cpm export --json` (v0.9.2 fixed show/export but overlooked list).
- **`cpm show` text output**: MCP server entries now show connection details — `cmd: npx -y @modelcontextprotocol/server-github` for stdio servers, `url: https://...` for HTTP servers. Previously only name/scope/type/approval were shown.

### Internal
- Test coverage: 205 tests (+1 listCommand --json test for MCP command/args/url).

## [0.9.3] - 2026-03-29

### Fixed
- **`cpm reset <rule> --dry-run`**: `--dry-run` now works for single-rule removal (not just `--all`). Previously `--dry-run` was silently ignored when removing a specific rule. Now previews whether the rule would be found and removed without modifying the file. Also clarified `reset` command help text from "Remove a rule from all lists" (misleading) to "Remove a rule from its list".

### Internal
- Test coverage: 204 tests (+2 `resetRuleCommand --dry-run` tests).

## [0.9.2] - 2026-03-29

### Fixed
- **merger**: missing LOW warning when a rule appears in both `allow` and `ask` — `allow` wins silently, making the `ask` rule unreachable. Now warns "Rule X is in both allow and ask — allow wins, ask prompt never shown", consistent with the existing allow+deny and ask+deny conflict warnings.
- **TUI ProjectDetail**: inconsistent error message for attempting to delete a managed/user scope rule — the confirm-dialog path said "Cannot edit ... scope from here" while the direct-x path said "Cannot delete ... scope rules". Both now use the same "Cannot delete ... scope rules" message.
- **`cpm show --json` / `cpm export --json`**: MCP server records now include `command`, `args`, and `url` fields. Previously these fields were populated in the type but omitted from JSON output, making it impossible to distinguish how servers connect (stdio vs HTTP) from the JSON output alone.

### Internal
- Test coverage: 202 tests (+1 merger test for allow+ask conflict, +2 command tests for MCP command/args/url in show/export JSON).

## [0.9.1] - 2026-03-29

### Fixed
- **`cpm show` text output**: `isBypassDisabled` was shown in TUI and `--json` but not in plain-text output (`formatEffectivePermissions`). Now shows `[bypass locked]` beside the mode line when set.
- **merger**: bare `WebSearch` in allow list now emits a MEDIUM warning ("WebSearch is allowed without any query specifier — arbitrary web searches can be performed"), consistent with the existing bare `WebFetch` warning. Previously only `WebFetch` triggered this check despite both being in the `READ_ONLY_TOOLS` exclusion list.

### Internal
- Test coverage expanded to 199 tests.
  - `denyCommand`: new test for ask-conflict warning (rule exists in ask list — deny takes precedence).
  - `denyCommand --dry-run`: new test for conflict display when rule exists in allow list.
  - `askCommand --dry-run`: two new tests — "already present" (no write, message shown) and "conflict with deny" (deny-takes-precedence shown in preview).
  - `showCommand --json`: new test verifying `isBypassDisabled: true` when `disableBypassPermissionsMode=disable` is present.
  - `listCommand --json`: new test verifying `isBypassDisabled` is a boolean on every project.
  - `exportCommand --json`: assertions for `isBypassDisabled`, `envVarNames`, `additionalDirs` in every project record.
  - `writer`: new tests for `addRule` `conflictsWith` when adding an ask rule that exists in deny or allow lists.
  - `merger`: two new WebSearch warning tests (warning fires for bare WebSearch; suppressed when specifier provided).

## [0.9.0] - 2026-03-28

### Added
- **TUI Audit**: pressing Enter on a warning now navigates to the project detail screen; pressing ←/Esc/q from detail returns to the audit screen (previously Enter did nothing).

### Fixed
- **TUI Diff**: cursor position through the `view` phase — pressing Esc after viewing a diff now restores the project-A cursor position instead of resetting to 0. Previously the fix only covered the selectB→selectA back-navigation; the view→selectA path was also missing preservation.
- **TUI Diff**: pressing ←/Esc/q from the diff view was incorrectly stored as `cursorA: 0`; now correctly uses `state.cursorA` in all `view → selectA` transitions.
- **TUI Diff**: added "Note: comparing a project with itself" warning in the diff view when both selected projects have the same path — matches the existing CLI behaviour.
- **TUI ProjectDetail**: after adding/removing a rule (triggering a background refresh), pressing back now correctly returns to the audit screen when the user navigated from there — the `from` origin was previously lost on refresh.
- **README**: `--format` and `--output` flags (export-only) added to the Flags reference section; previously only documented in usage examples.

### Internal
- Test coverage expanded to 189 tests.
  - `auditCommand` suite: JSON shape, issue detection, `--exit-code` exits 0/1/2 (all three branches now covered).
  - `askCommand` conflict warnings: deny-takes-precedence and allow-list conflict paths.
  - `askCommand --dry-run` coverage added (was the only manage command missing it).
  - `diffCommand --json` envVarNames/additionalDirs fields verified.

## [0.8.0] - 2026-03-28

### Added
- `cpm reset --all --dry-run` — preview what would be cleared (shows allow/deny/ask rule counts) without modifying files; consistent with `--dry-run` on `allow`/`deny`/`ask`/`mode`.
- **merger**: `ask` rules that conflict with `deny` now emit LOW warnings (exact match, bare-tool-deny override, wildcard `*` override) — parallels the existing allow/deny conflict detection.
- `parseClaudeJson` now emits a `stderr` warning when `~/.claude.json` exists but cannot be read (EACCES) or contains invalid JSON, instead of silently returning empty.

### Fixed
- **diff**: `envVarNames` and `additionalDirs` were not compared — projects differing only in these fields incorrectly reported as identical. Both JSON and text output now include ENV VARS and ADDITIONAL DIRS diff sections.
- **diff `--json`**: `identical` flag now correctly accounts for `envVarNames` and `additionalDirs` differences.
- **TUI Diff**: `isIdentical` check was missing `envVarNames` and `additionalDirs`; ENV VARS (magenta) and ADDITIONAL DIRS (cyan) diff sections added to match CLI text output.
- **list `--json`**: `mcpServers` entries now include `type` (with `?? "stdio"` default), `envVarNames`, and `headerNames` — consistent with `show --json` and `export --json` (previously only `name`, `scope`, `approvalState`).
- **show `--json`**: `mcpServers` entries were missing `?? "stdio"` / `?? "pending"` defaults for `type` and `approvalState` — in edge cases these fields could be omitted from JSON output. Now consistent with `export --json` and `list --json`.
- **init**: no tip was printed when using `--scope user`; now says "this applies to all Claude Code projects on this machine."
- **TUI Header**: hardcoded default version `"0.1.0"` was displayed on all TUI screens; removed so no stale version appears.
- **TUI ProjectList**: critical warnings (🚨) now show total count, consistent with non-critical warnings (`⚠ N`).
- **TUI Audit**: scan errors (`scanResult.errors`) are now displayed at the bottom of the audit screen; previously silently ignored.
- **TUI Audit**: pressing Enter on a warning navigates to the project detail screen; pressing ←/Esc/q from detail returns to the audit screen (previously Enter did nothing).
- **TUI ProjectDetail**: after adding/removing a rule (triggering a background refresh), pressing back now correctly returns to the audit screen when the user navigated from there — previously the `from` origin was lost on refresh, causing back to always go to the project list.

### Internal
- `mode` command description in CLI now derived from `PermissionModeSchema.options` instead of being hardcoded.
- Writer temp file names include a monotonic counter (`pid.counter`) to prevent collision when multiple writes occur concurrently within one process.
- Completion scripts (`bash`/`zsh`) updated to suggest `--dry-run` for `reset` command.
- Test coverage expanded to 181 tests.

## [0.7.0] - 2026-03-28

### Added
- `--dry-run` flag for `allow`, `deny`, `ask`, and `mode` commands — preview what would be written without modifying any files. Shows target file path, whether the rule already exists, and conflict warnings.
- `cpm audit --exit-code` flag — exits 1 on warnings, 2 on critical issues. Useful in CI pipelines.
- `--no-global` flag for `audit`, `export`, and `ui` commands (already existed for `list`).
- `cpm ui` now supports `--no-global` for consistency.

### Fixed
- **discovery**: `~/.claude` was incorrectly treated as a project when scanning from `$HOME`; now skipped.
- **discovery**: MCP servers duplicated when defined in both `.mcp.json` and `~/.claude.json`; now deduplicated (real approval state preferred over pending).
- **discovery**: Global user MCP servers from `~/.claude.json` not included in per-project `effectivePermissions`; now merged in.
- **discovery**: `--no-global` flag was wired in CLI but not read by `scan()`; now correctly skips global settings.
- **discovery**: `buildProject` errors reported as `[object Object]`; now correctly formats Error instances.
- **merger**: Invalid `defaultMode` values (e.g. typos like `"auto-mode"`) silently passed through to `effectivePermissions`, violating the type contract. Now validated against the schema; invalid values fall back to `"default"`.
- **merger**: `WebFetch` and `WebSearch` missing from the read-only tools exclusion list, causing false "no deny rules" warnings.
- **merger**: Bare `WebFetch` in allow (no URL specifier) now emits a medium warning.
- **merger**: Wildcard `*` in allow list now emits a HIGH warning.
- **merger**: Wildcard `deny "*"` now emits LOW warnings for each allow rule it overrides.
- **parser**: `parseClaudeJson` was missing `args` and `headerNames` for per-project MCP servers from `~/.claude.json`.
- **writer**: `addRule`/`removeRule` crashed on corrupt files where a list field was a non-array (e.g. `allow: 42`); now guarded with `Array.isArray`.
- **writer**: Rules with surrounding whitespace (e.g. `"Read "`) were stored verbatim; now trimmed before write.
- **paths**: `collapseHome` partial match bug — `/home/bob` matched `/home/bobby`, producing `~by/foo`. Fixed with path-boundary check.
- **cli**: `--depth` accepted non-numeric values (`NaN`), bypassing the depth limit entirely; now validated.
- **cli**: Unknown subcommands silently fell through to `list`; now exit 1 with an "unknown command" error.
- **cli**: Top-level error handler added for clean `EACCES`/unexpected error output (no raw stack traces).
- **manage**: `--scope` flag not validated; invalid values like `--scope bogus` silently proceeded. Now validated against known scopes.
- **manage**: `mode` command warning for `bypassPermissions` now also notes when set at `--scope user` (affects all projects).
- **completion**: Bash `--mode` value completion was missing; `cpm ui` incorrectly suggested `--json`; `show`, `diff`, `mode` missing flag suggestions.
- **diff**: Projects with the same number of rules but different content incorrectly reported as identical; fixed with Set comparison.
- **diff**: `isBypassDisabled` flag not compared; two projects with different values showed as identical.
- **diff**: MCP server differences not shown in diff output.
- **show**: `--json` output omitted user/managed scope settings files.
- **show**: Text output missing `envVarNames` and `additionalDirs`.
- **export**: `--output` path validation: now errors cleanly if parent directory does not exist.
- **export**: Global settings `allow`/`deny`/`ask` not sanitized to arrays when schema validation failed.
- **audit**: Suppress "disableBypassPermissionsMode not set" warning when `bypassPermissions` mode is already active.
- **TUI**: Refresh race condition in `ProjectDetail` — in-flight scan could overwrite screen state after user navigated away; fixed with cancel counter.
- **TUI**: `Diff` screen identical-check ignored `mode` and `isBypassDisabled`; fixed.
- **TUI**: `ProjectList` mode column misaligned for different mode string lengths; fixed.
- **TUI**: `ProjectDetail` pressing `x` on managed/user rules showed a misleading confirm dialog; now shows error immediately.
- **format**: MCP server text display missing `envVarNames` and `headerNames` lines.
- **list `--json`**: `mcpServers` was names-only string array; now objects with `scope` and `approvalState`.
- **list `--json`**: `allow`/`deny`/`ask` rules are now `{ rule, scope }` objects (was plain strings), consistent with `show --json` and `export --json`.
- **diff `--json`**: `onlyInA`/`onlyInB` rule arrays are now `{ rule, scope }` objects (was plain strings).
- **init**: `--scope` is now validated (invalid values like `--scope bogus` exit 1 with a clear error, was silently proceeding).
- **TUI**: Cursor position after rule deletion now stays in place when deleting a middle item; only moves up when the last item is deleted.

### Changed
- `cpm audit --json` output includes `issueCount` field (previously only `issues` array length was available).
- `show --json` and `export --json` now include `headerNames` for MCP servers.
- `show --json` rules use `"rule"` key (was `"raw"`) for consistency with `export --json`.
- Node.js requirement raised to **≥20** (Vitest 4 requires it).

### Internal
- `addRule` accepts optional `{ dryRun: true }` to compute result without writing — eliminates duplicate conflict-detection logic between `previewRuleAdd` and `addRule`.
- `VALID_MODES` in `manage.ts`, `init.ts`, and `completion.ts` all derived from `PermissionModeSchema.options` (single source of truth).
- `WRITABLE_SCOPES` constant extracted to `types.ts` — eliminates duplicated scope arrays across `manage.ts`, `init.ts`, `completion.ts`.
- `diff.ts` JSON path: pre-computed `Set` for O(1) raw lookup (was O(n) `.some()` per item).
- `exitWithCode()` helper extracted in `audit.ts` (was duplicated in JSON and text paths).
- Test coverage expanded from 111 → 163 tests; new `commands.test.ts` covering all manage commands.
- `prepublishOnly` script added to guard against accidental publish of unbuilt/failing code.

## [0.6.0] - 2025-07-15

### Added
- Initial release with full feature set:
  - Discovery of all `.claude/` directories (configurable depth, symlink-safe)
  - Permission analysis across all scopes (managed → user → project → local)
  - `cpm list` — tabular overview of all projects
  - `cpm show` — detailed per-project view
  - `cpm audit` — security warnings (HIGH/MEDIUM/LOW/CRITICAL)
  - `cpm diff` — compare effective permissions between two projects
  - `cpm export` — JSON/CSV export of all permissions data
  - `cpm allow` / `cpm deny` / `cpm ask` — add permission rules
  - `cpm reset` — remove rules; `cpm reset --all` to clear all
  - `cpm mode` — set `defaultMode`
  - `cpm init` — initialize with preset (safe/node/strict)
  - `cpm ui` — interactive TUI (project list, detail, audit, diff screens)
  - `cpm completion bash|zsh` — shell completion scripts
  - MCP server discovery and approval state display
  - Global user settings (`~/.claude/settings.json`) merged with per-project settings
  - `~/.claude.json` parsed for MCP server approval states

[0.8.0]: https://github.com/stofi/claude-permissions-manager/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/stofi/claude-permissions-manager/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/stofi/claude-permissions-manager/releases/tag/v0.6.0
