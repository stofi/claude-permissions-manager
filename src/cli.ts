#!/usr/bin/env node
import { createRequire } from "module";
import { Command, Option, Argument } from "commander";
import chalk from "chalk";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { auditCommand } from "./commands/audit.js";
import { statsCommand } from "./commands/stats.js";
import { searchCommand } from "./commands/search.js";
import { homeDir } from "./utils/paths.js";
import { dedupCommand, batchDedupCommand } from "./commands/dedup.js";
import { mcpCommand } from "./commands/mcp.js";
import { PermissionModeSchema } from "./core/schemas.js";
import { WRITABLE_SCOPES } from "./core/types.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

function parseDepth(raw: string, fallback = 8): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const program = new Command();

program
  .name("cpm")
  .description("Claude Permissions Manager — discover and manage Claude Code permissions")
  .version(version)
  .option("--root <dir>", "Root directory to scan from", homeDir())
  .option("--depth <n>", "Max scan depth", "8")
  .option("--no-global", "Skip user and managed global settings");

// Default action: TUI when TTY, list otherwise
program.action(async () => {
  // If any non-option args were passed, they didn't match a known subcommand
  const unknownArgs = program.args.filter((a) => !a.startsWith("-"));
  if (unknownArgs.length > 0) {
    process.stderr.write(`Error: Unknown command '${unknownArgs[0]}'\nRun 'cpm --help' for usage.\n`);
    process.exit(1);
  }
  const opts = program.opts() as { root: string; depth: string; global: boolean };
  const maxDepth = parseDepth(opts.depth);
  const includeGlobal = opts.global !== false;
  if (process.stdout.isTTY) {
    const { uiCommand } = await import("./commands/ui.js");
    await uiCommand({ root: opts.root, maxDepth, includeGlobal });
  } else {
    await listCommand({ root: opts.root, maxDepth, includeGlobal });
  }
});

program
  .command("ui")
  .description("Launch interactive TUI")
  .action(async () => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { uiCommand } = await import("./commands/ui.js");
    await uiCommand({ root, maxDepth: parseDepth(depth), includeGlobal: g !== false });
  });

program
  .command("list")
  .description("List all discovered Claude projects and their permissions")
  .option("--json", "Output as JSON")
  .option("--warnings", "Only show projects that have permission warnings")
  .addOption(new Option("--min-severity <level>", "Only show projects with warnings at or above this severity").choices(["critical", "high", "medium", "low"]))
  .addOption(new Option("--sort <field>", "Sort projects by field").choices(["name", "warnings", "mode"]))
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await listCommand({ root, maxDepth: parseDepth(depth), json: opts.json, includeGlobal: g !== false, warningsOnly: opts.warnings, minSeverity: opts.minSeverity as import("./core/types.js").WarningSeverity | undefined, sort: opts.sort });
  });

program
  .command("stats")
  .description("Show aggregate permission statistics across all projects")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await statsCommand({ root, maxDepth: parseDepth(depth), json: opts.json, includeGlobal: g !== false });
  });

program
  .command("search <pattern>")
  .description("Search for projects that have rules matching a pattern")
  .option("--json", "Output as JSON")
  .option("--exact", "Exact rule match (default: substring)")
  .option("--exit-code", "Exit 1 if no matches found (useful in CI)")
  .addOption(new Option("--type <type>", "Only search in this rule list").choices(["allow", "deny", "ask"]))
  .addOption(new Option("--scope <scope>", "Only match rules in this scope").choices(["local", "project", "user", "managed"]))
  .action(async (pattern, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await searchCommand(pattern, {
      root, maxDepth: parseDepth(depth), json: opts.json, includeGlobal: g !== false,
      exact: opts.exact, type: opts.type, scope: opts.scope, exitCode: opts.exitCode,
    });
  });

program
  .command("show [path]")
  .description("Show detailed permissions for a project (default: cwd)")
  .option("--json", "Output as JSON")
  .action(async (path, opts) => {
    const { global: g } = program.opts() as { global: boolean };
    await showCommand(path, { json: opts.json, includeGlobal: g !== false });
  });

program
  .command("audit")
  .description("Report risky or suspicious permissions across all projects")
  .option("--json", "Output as JSON")
  .option("--exit-code", "Exit with code 1 (issues found) or 2 (critical issues) for CI use")
  .addOption(new Option("--min-severity <level>", "Only report issues at or above this severity").choices(["critical", "high", "medium", "low"]).default("low"))
  .option("--fix", "Auto-apply all available fix commands")
  .option("-y, --yes", "Skip confirmation prompt when using --fix")
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await auditCommand({
      root,
      maxDepth: parseDepth(depth),
      json: opts.json,
      includeGlobal: g !== false,
      exitCode: opts.exitCode,
      minSeverity: opts.minSeverity as import("./core/types.js").WarningSeverity | undefined,
      fix: opts.fix,
      yes: opts.yes,
    });
  });

program
  .command("diff <path1> <path2>")
  .description("Compare effective permissions between two projects")
  .option("--json", "Output as JSON")
  .action(async (path1, path2, opts) => {
    const { global: g } = program.opts() as { global: boolean };
    const { diffCommand } = await import("./commands/diff.js");
    await diffCommand(path1, path2, { json: opts.json, includeGlobal: g !== false });
  });

program
  .command("allow <rule>")
  .description('Add a rule to the allow list (e.g. cpm allow "Bash(npm run *)")')
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { allowCommand, batchAddCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await batchAddCommand(rule, "allow", { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await allowCommand(rule, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("deny <rule>")
  .description('Add a rule to the deny list (e.g. cpm deny "Read(**/.env)")')
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { denyCommand, batchAddCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await batchAddCommand(rule, "deny", { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await denyCommand(rule, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("ask <rule>")
  .description('Add a rule to the ask list (always prompt for confirmation)')
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { askCommand, batchAddCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await batchAddCommand(rule, "ask", { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await askCommand(rule, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("reset [rule]")
  .description("Remove a rule, or --all to remove rule / clear all rules across all projects")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "With rule: remove from all projects. Without rule: clear all rules in all projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be removed without modifying any files")
  .action(async (rule, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { resetRuleCommand, resetAllCommand, batchRemoveCommand, batchResetAllCommand } = await import("./commands/manage.js");
    if (opts.all && rule) {
      await batchRemoveCommand(rule, { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else if (opts.all && opts.project) {
      // --all + --project: clear all rules from a specific project
      await resetAllCommand({ ...opts, dryRun: opts.dryRun });
    } else if (opts.all) {
      // --all without --project: batch clear all rules from all discovered projects
      await batchResetAllCommand({ root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else if (rule) {
      await resetRuleCommand(rule, { ...opts, dryRun: opts.dryRun });
    } else {
      console.error("Provide a rule to remove, or --all to clear everything");
      process.exit(1);
    }
  });

program
  .command("replace <old> <new>")
  .description("Replace one rule with another (rename a rule across projects)")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be replaced without modifying any files")
  .action(async (oldRule: string, newRule: string, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { replaceRuleCommand, batchReplaceCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await batchReplaceCommand(oldRule, newRule, { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await replaceRuleCommand(oldRule, newRule, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("mode")
  .addArgument(new Argument("<mode>", "Permission mode").choices(PermissionModeSchema.options))
  .description(`Set defaultMode: ${PermissionModeSchema.options.join("|")}`)
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (mode, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { modeCommand, batchModeCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await batchModeCommand(mode, { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await modeCommand(mode, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("copy <source> [target]")
  .description("Copy project-level permissions from one project to another (merges into target)")
  .addOption(new Option("--scope <scope>", "Target scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--all", "Copy to all discovered projects")
  .option("--dry-run", "Show what would be copied without making changes")
  .option("--yes", "Skip confirmation prompt")
  .action(async (source: string, target: string | undefined, opts: { scope?: string; all?: boolean; dryRun?: boolean; yes?: boolean }) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    if (opts.all) {
      const { batchCopyCommand } = await import("./commands/copy.js");
      await batchCopyCommand(source, { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else if (target) {
      const { copyCommand } = await import("./commands/copy.js");
      await copyCommand(source, target, { ...opts, dryRun: opts.dryRun });
    } else {
      console.error(chalk.red("Error: must specify a <target> path or use --all to copy to all projects."));
      process.exit(1);
    }
  });

program
  .command("export")
  .description("Export all permissions data (JSON, CSV, or Markdown)")
  .option("--format <fmt>", "Output format: json|csv|markdown", "json")
  .option("--output <file>", "Write to file instead of stdout")
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { exportCommand } = await import("./commands/export.js");
    await exportCommand({
      root,
      maxDepth: parseDepth(depth),
      format: opts.format,
      output: opts.output,
      includeGlobal: g !== false,
    });
  });

program
  .command("init")
  .description("Create a starter settings.json from a preset template")
  .option("--project <path>", "Project path (default: current directory)")
  .addOption(new Option("--scope <scope>", "Settings scope (default: project)").choices(WRITABLE_SCOPES).default("project"))
  .addOption(new Option("--preset <preset>", "Starter template (default: safe)").choices(["safe", "node", "strict"]).default("safe"))
  .addOption(new Option("--mode <mode>", "Override defaultMode").choices(PermissionModeSchema.options))
  .option("--yes", "Overwrite existing settings without prompting")
  .option("--dry-run", "Preview what would be created without writing any files")
  .action(async (opts) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand({ ...opts, dryRun: opts.dryRun });
  });

program
  .command("edit")
  .description("Open a project settings file in $EDITOR (creates the file if missing)")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path (default: cwd)")
  .action(async (opts) => {
    const { editCommand } = await import("./commands/edit.js");
    await editCommand({ project: opts.project, scope: opts.scope });
  });

program
  .command("bypass-lock")
  .addArgument(new Argument("<state>", "Enable or disable the lock").choices(["on", "off"]))
  .description("Enable or disable disableBypassPermissionsMode (prevents bypassPermissions activation)")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .action(async (state, opts) => {
    if (opts.all) {
      const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
      const { batchBypassLockCommand } = await import("./commands/manage.js");
      await batchBypassLockCommand(state === "on", {
        root,
        maxDepth: parseDepth(depth),
        includeGlobal: g !== false,
        scope: opts.scope,
        dryRun: opts.dryRun,
        yes: opts.yes,
      });
    } else {
      const { bypassLockCommand } = await import("./commands/manage.js");
      await bypassLockCommand(state === "on", { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("rules")
  .description("List all unique rules across projects, ranked by frequency")
  .option("--json", "Output as JSON")
  .addOption(new Option("--type <type>", "Only show this rule list").choices(["allow", "deny", "ask"]))
  .option("--top <n>", "Show only the top N rules by frequency")
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { rulesCommand } = await import("./commands/rules.js");
    await rulesCommand({
      root,
      maxDepth: parseDepth(depth),
      json: opts.json,
      includeGlobal: g !== false,
      type: opts.type,
      top: opts.top !== undefined ? parseInt(opts.top, 10) : undefined,
    });
  });

program
  .command("mcp [name]")
  .description("List MCP servers across projects (optionally filter by server name)")
  .option("--json", "Output as JSON")
  .addOption(new Option("--type <type>", "Only show servers of this type").choices(["stdio", "http"]))
  .addOption(new Option("--approval <state>", "Only show servers with this approval state").choices(["approved", "denied", "pending"]))
  .action(async (name, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await mcpCommand(name, {
      root,
      maxDepth: parseDepth(depth),
      json: opts.json,
      includeGlobal: g !== false,
      type: opts.type,
      approval: opts.approval,
    });
  });

program
  .command("preset [name]")
  .description("Apply a named security preset (safe, readonly, locked, open, cautious). No name = list presets.")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Preview what would be applied without modifying any files")
  .action(async (name, opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    const { listPresetsCommand, presetCommand, batchPresetCommand } = await import("./commands/preset.js");
    if (!name) {
      listPresetsCommand();
      return;
    }
    if (opts.all) {
      await batchPresetCommand(name, { root, maxDepth: parseDepth(depth), includeGlobal: g !== false, ...opts, dryRun: opts.dryRun });
    } else {
      await presetCommand(name, { ...opts, dryRun: opts.dryRun });
    }
  });

program
  .command("dedup")
  .description("Remove duplicate rules from settings files (optionally across all projects)")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Apply to all discovered projects")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Preview what would be removed without modifying any files")
  .option("--json", "Output as JSON")
  .option("--fix-conflicts", "Auto-resolve cross-list conflicts (deny > allow > ask precedence)")
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    if (opts.all) {
      await batchDedupCommand({ root, maxDepth: parseDepth(depth), includeGlobal: g !== false, scope: opts.scope, dryRun: opts.dryRun, yes: opts.yes, json: opts.json, fixConflicts: opts.fixConflicts });
    } else {
      await dedupCommand({ project: opts.project, scope: opts.scope, dryRun: opts.dryRun, yes: opts.yes, json: opts.json, fixConflicts: opts.fixConflicts });
    }
  });

program
  .command("completion <shell>")
  .description("Print shell completion script (bash or zsh). Add to shell profile:")
  .addHelpText("after", "\n  eval \"$(cpm completion bash)\"  # ~/.bashrc\n  eval \"$(cpm completion zsh)\"   # ~/.zshrc")
  .action(async (shell) => {
    const { completionCommand } = await import("./commands/completion.js");
    await completionCommand(shell);
  });

program.parseAsync().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${msg}\n`);
  process.exit(1);
});
