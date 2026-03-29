#!/usr/bin/env node
import { createRequire } from "module";
import { Command } from "commander";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { auditCommand } from "./commands/audit.js";
import { homeDir } from "./utils/paths.js";
import { PermissionModeSchema } from "./core/schemas.js";

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
  .version(version);

// Default action: TUI when TTY, list otherwise
program.action(async () => {
  // If any non-option args were passed, they didn't match a known subcommand
  const unknownArgs = program.args.filter((a) => !a.startsWith("-"));
  if (unknownArgs.length > 0) {
    process.stderr.write(`Error: Unknown command '${unknownArgs[0]}'\nRun 'cpm --help' for usage.\n`);
    process.exit(1);
  }
  if (process.stdout.isTTY) {
    const { uiCommand } = await import("./commands/ui.js");
    await uiCommand({ root: homeDir(), maxDepth: 8, includeGlobal: true });
  } else {
    await listCommand({ root: homeDir(), maxDepth: 8, includeGlobal: true });
  }
});

program
  .command("ui")
  .description("Launch interactive TUI")
  .option("--root <dir>", "Root directory to scan from", homeDir())
  .option("--depth <n>", "Max scan depth", "8")
  .option("--no-global", "Skip user and managed global settings")
  .action(async (opts) => {
    const { uiCommand } = await import("./commands/ui.js");
    await uiCommand({
      root: opts.root,
      maxDepth: parseDepth(opts.depth),
      includeGlobal: opts.global !== false,
    });
  });

program
  .command("list")
  .description("List all discovered Claude projects and their permissions")
  .option("--root <dir>", "Root directory to scan from", homeDir())
  .option("--depth <n>", "Max scan depth", "8")
  .option("--json", "Output as JSON")
  .option("--no-global", "Skip user and managed global settings")
  .action(async (opts) => {
    await listCommand({
      root: opts.root,
      maxDepth: parseDepth(opts.depth),
      json: opts.json,
      includeGlobal: opts.global !== false,
    });
  });

program
  .command("show [path]")
  .description("Show detailed permissions for a project (default: cwd)")
  .option("--json", "Output as JSON")
  .action(async (path, opts) => {
    await showCommand(path, { json: opts.json });
  });

program
  .command("audit")
  .description("Report risky or suspicious permissions across all projects")
  .option("--root <dir>", "Root directory to scan from", homeDir())
  .option("--depth <n>", "Max scan depth", "8")
  .option("--json", "Output as JSON")
  .option("--no-global", "Skip user and managed global settings")
  .option("--exit-code", "Exit with code 1 (issues found) or 2 (critical issues) for CI use")
  .action(async (opts) => {
    await auditCommand({
      root: opts.root,
      maxDepth: parseDepth(opts.depth),
      json: opts.json,
      includeGlobal: opts.global !== false,
      exitCode: opts.exitCode,
    });
  });

program
  .command("diff <path1> <path2>")
  .description("Compare effective permissions between two projects")
  .option("--json", "Output as JSON")
  .action(async (path1, path2, opts) => {
    const { diffCommand } = await import("./commands/diff.js");
    await diffCommand(path1, path2, { json: opts.json });
  });

program
  .command("allow <rule>")
  .description('Add a rule to the allow list (e.g. cpm allow "Bash(npm run *)")')
  .option("--scope <scope>", "Settings scope: local|project|user (default: local)", "local")
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { allowCommand } = await import("./commands/manage.js");
    await allowCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("deny <rule>")
  .description('Add a rule to the deny list (e.g. cpm deny "Read(**/.env)")')
  .option("--scope <scope>", "Settings scope: local|project|user (default: local)", "local")
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { denyCommand } = await import("./commands/manage.js");
    await denyCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("ask <rule>")
  .description('Add a rule to the ask list (always prompt for confirmation)')
  .option("--scope <scope>", "Settings scope: local|project|user (default: local)", "local")
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (rule, opts) => {
    const { askCommand } = await import("./commands/manage.js");
    await askCommand(rule, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("reset [rule]")
  .description("Remove a rule from all lists, or --all to clear all rules")
  .option("--scope <scope>", "Settings scope: local|project|user (default: local)", "local")
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--all", "Clear all permission rules")
  .option("--yes", "Skip confirmation prompt (with --all)")
  .option("--dry-run", "Preview what would be cleared without modifying any files (with --all)")
  .action(async (rule, opts) => {
    const { resetRuleCommand, resetAllCommand } = await import("./commands/manage.js");
    if (opts.all) {
      await resetAllCommand({ ...opts, dryRun: opts.dryRun });
    } else if (rule) {
      await resetRuleCommand(rule, opts);
    } else {
      console.error("Provide a rule to remove, or --all to clear everything");
      process.exit(1);
    }
  });

program
  .command("mode <mode>")
  .description(`Set defaultMode: ${PermissionModeSchema.options.join("|")}`)
  .option("--scope <scope>", "Settings scope: local|project|user (default: local)", "local")
  .option("--project <path>", "Project path for local/project scope (default: cwd)")
  .option("--dry-run", "Preview what would be written without modifying any files")
  .action(async (mode, opts) => {
    const { modeCommand } = await import("./commands/manage.js");
    await modeCommand(mode, { ...opts, dryRun: opts.dryRun });
  });

program
  .command("export")
  .description("Export all permissions data (JSON or CSV)")
  .option("--root <dir>", "Root directory to scan from", homeDir())
  .option("--depth <n>", "Max scan depth", "8")
  .option("--format <fmt>", "Output format: json|csv", "json")
  .option("--output <file>", "Write to file instead of stdout")
  .option("--no-global", "Skip user and managed global settings")
  .action(async (opts) => {
    const { exportCommand } = await import("./commands/export.js");
    await exportCommand({
      root: opts.root,
      maxDepth: parseDepth(opts.depth),
      format: opts.format,
      output: opts.output,
      includeGlobal: opts.global !== false,
    });
  });

program
  .command("init")
  .description("Create a starter settings.json from a preset template")
  .option("--project <path>", "Project path (default: current directory)")
  .option("--scope <scope>", "Settings scope: local|project|user (default: project)", "project")
  .option("--preset <preset>", "Template preset: safe|node|strict (default: safe)", "safe")
  .option("--mode <mode>", "Override defaultMode")
  .option("--yes", "Overwrite existing settings without prompting")
  .action(async (opts) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(opts);
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
