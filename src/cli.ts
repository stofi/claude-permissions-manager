#!/usr/bin/env node
import { createRequire } from "module";
import { Command, Option, Argument } from "commander";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { auditCommand } from "./commands/audit.js";
import { homeDir } from "./utils/paths.js";
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
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await listCommand({ root, maxDepth: parseDepth(depth), json: opts.json, includeGlobal: g !== false });
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
  .action(async (opts) => {
    const { root, depth, global: g } = program.opts() as { root: string; depth: string; global: boolean };
    await auditCommand({
      root,
      maxDepth: parseDepth(depth),
      json: opts.json,
      includeGlobal: g !== false,
      exitCode: opts.exitCode,
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
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { allowCommand } = await import("./commands/manage.js");
    await allowCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("deny <rule>")
  .description('Add a rule to the deny list (e.g. cpm deny "Read(**/.env)")')
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { denyCommand } = await import("./commands/manage.js");
    await denyCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("ask <rule>")
  .description('Add a rule to the ask list (always prompt for confirmation)')
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { askCommand } = await import("./commands/manage.js");
    await askCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("reset [rule]")
  .description("Remove a rule from its list, or --all to clear all rules")
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Clear all permission rules")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be removed without modifying any files")
  .action(async (rule, opts) => {
    const { resetRuleCommand, resetAllCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await resetAllCommand({ ...opts, dryRun: opts.dryRun });
    } else if (rule) {
      await resetRuleCommand(rule, { ...opts, dryRun: opts.dryRun });
    } else {
      console.error("Provide a rule to remove, or --all to clear everything");
      process.exit(1);
    }
  });

program
  .command("mode")
  .addArgument(new Argument("<mode>", "Permission mode").choices(PermissionModeSchema.options))
  .description(`Set defaultMode: ${PermissionModeSchema.options.join("|")}`)
  .addOption(new Option("--scope <scope>", "Settings scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (mode, opts) => {
    const { modeCommand } = await import("./commands/manage.js");
    await modeCommand(mode, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("copy <source> <target>")
  .description("Copy project-level permissions from one project to another (merges into target)")
  .addOption(new Option("--scope <scope>", "Target scope (default: local)").choices(WRITABLE_SCOPES).default("local"))
  .option("--dry-run", "Show what would be copied without making changes")
  .option("--yes", "Skip confirmation prompt")
  .action(async (source: string, target: string, opts: { scope?: string; dryRun?: boolean; yes?: boolean }) => {
    const { copyCommand } = await import("./commands/copy.js");
    await copyCommand(source, target, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("export")
  .description("Export all permissions data (JSON or CSV)")
  .option("--format <fmt>", "Output format: json|csv", "json")
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
