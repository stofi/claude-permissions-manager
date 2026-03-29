import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { formatProjectTable } from "../utils/format.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";

export async function listCommand(options: ScanOptions & { json?: boolean }): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));

  const result = await scan(options);

  if (options.json) {
    const output = {
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      projectCount: result.projects.length,
      projects: result.projects.map((p) => ({
        path: p.rootPath,
        mode: p.effectivePermissions.defaultMode,
        isBypassDisabled: p.effectivePermissions.isBypassDisabled,
        allow: p.effectivePermissions.allow.map((r) => ({ rule: r.raw, scope: r.scope })),
        deny: p.effectivePermissions.deny.map((r) => ({ rule: r.raw, scope: r.scope })),
        ask: p.effectivePermissions.ask.map((r) => ({ rule: r.raw, scope: r.scope })),
        mcpServers: p.effectivePermissions.mcpServers.map((s) => ({
          name: s.name,
          type: s.type ?? "stdio",
          scope: s.scope,
          approvalState: s.approvalState ?? "pending",
          command: s.command,
          args: s.args,
          url: s.url,
          envVarNames: s.envVarNames,
          headerNames: s.headerNames,
        })),
        warnings: p.effectivePermissions.warnings.length,
      })),
      errors: result.errors,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (result.projects.length === 0) {
    console.log(chalk.yellow("\nNo Claude projects found."));
    console.log(chalk.gray(`Scanned: ${collapseHome(result.scanRoot)}`));
    console.log(chalk.gray("Tip: Create a .claude/settings.json file in your project."));
    return;
  }

  // Show global settings if present
  if (result.global.user?.exists) {
    console.log(chalk.dim(`\nUser settings: ${collapseHome(result.global.user.path)}`));
  }
  if (result.global.managed?.exists) {
    console.log(chalk.dim(`Managed settings: ${collapseHome(result.global.managed.path)}`));
  }

  console.log(`\nFound ${chalk.bold(result.projects.length)} project(s)\n`);
  console.log(formatProjectTable(result.projects));

  const totalWarnings = result.projects.reduce(
    (sum, p) => sum + p.effectivePermissions.warnings.length,
    0
  );
  if (totalWarnings > 0) {
    console.log(chalk.yellow(`\n⚠ ${totalWarnings} warning(s) across all projects. Run 'cpm audit' for details.`));
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n${result.errors.length} error(s) during scan:`));
    for (const e of result.errors) {
      console.log(chalk.red(`  ${collapseHome(e.path)}: ${e.error}`));
    }
  }
}
