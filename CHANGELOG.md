# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **merger**: missing LOW warning when a rule appears in both `allow` and `ask` — `allow` wins silently, making the `ask` rule unreachable. Now warns "Rule X is in both allow and ask — allow wins, ask prompt never shown", consistent with the existing allow+deny and ask+deny conflict warnings.
- **TUI ProjectDetail**: inconsistent error message for attempting to delete a managed/user scope rule — the confirm-dialog path said "Cannot edit ... scope from here" while the direct-x path said "Cannot delete ... scope rules". Both now use the same "Cannot delete ... scope rules" message.

### Internal
- Test coverage: 200 tests (+1 merger test for allow+ask conflict).

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
