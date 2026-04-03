import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import { SEVERITY_ORDER } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";
import type { WarningSeverity } from "../core/types.js";

export async function statsCommand(options: ScanOptions & { json?: boolean }): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);
  const projects = result.projects;

  // Mode breakdown — count projects per defaultMode
  const byMode: Record<string, number> = {};
  for (const p of projects) {
    const mode = p.effectivePermissions.defaultMode;
    byMode[mode] = (byMode[mode] ?? 0) + 1;
  }

  // Warning breakdown — count warning instances per severity
  const warningsBySeverity: Record<WarningSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalWarnings = 0;
  const affectedProjectPaths = new Set<string>();
  for (const p of projects) {
    for (const w of p.effectivePermissions.warnings) {
      warningsBySeverity[w.severity]++;
      totalWarnings++;
      affectedProjectPaths.add(p.rootPath);
    }
  }
  const cleanProjects = projects.length - affectedProjectPaths.size;

  // MCP servers — unique server names and projects using them
  const allMcpNames = new Set<string>();
  const projectsWithMcpPaths = new Set<string>();
  for (const p of projects) {
    for (const s of p.effectivePermissions.mcpServers) {
      allMcpNames.add(s.name);
      projectsWithMcpPaths.add(p.rootPath);
    }
  }

  // Projects with at least one explicit allow or deny rule
  const projectsWithRules = projects.filter(
    (p) => p.effectivePermissions.allow.length > 0 || p.effectivePermissions.deny.length > 0
  ).length;

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      totalProjects: projects.length,
      byMode,
      totalWarnings,
      warningsBySeverity,
      affectedProjects: affectedProjectPaths.size,
      cleanProjects,
      mcpServers: {
        uniqueNames: allMcpNames.size,
        projectsWithMcp: projectsWithMcpPaths.size,
      },
      projectsWithRules,
      errors: result.errors,
    }, null, 2));
    return;
  }

  if (projects.length === 0) {
    console.log(chalk.yellow("\nNo Claude projects found."));
    console.log(chalk.gray(`Scanned: ${collapseHome(result.scanRoot)}`));
    return;
  }

  console.log(`\n${chalk.bold(projects.length)} project(s) in ${chalk.dim(collapseHome(result.scanRoot))}\n`);

  // Mode breakdown
  console.log(chalk.bold("Permission modes"));
  const sortedModes = Object.entries(byMode).sort(([, a], [, b]) => b - a);
  const maxModeLen = Math.max(...sortedModes.map(([m]) => m.length));
  for (const [mode, count] of sortedModes) {
    const pct = ((count / projects.length) * 100).toFixed(1);
    console.log(`  ${mode.padEnd(maxModeLen)}  ${String(count).padStart(4)}  (${pct.padStart(5)}%)`);
  }

  // Warning breakdown
  console.log(`\n${chalk.bold("Warnings")}  ${totalWarnings} issue(s) across ${affectedProjectPaths.size} project(s)`);
  for (const sev of SEVERITY_ORDER) {
    const count = warningsBySeverity[sev];
    if (count > 0) {
      console.log(`  ${sev.padEnd(8)}  ${String(count).padStart(4)}`);
    }
  }
  if (cleanProjects > 0) {
    const pct = ((cleanProjects / projects.length) * 100).toFixed(1);
    console.log(chalk.green(`  clean     ${String(cleanProjects).padStart(4)}  (${pct.padStart(5)}%)`));
  }

  // MCP servers
  if (allMcpNames.size > 0) {
    console.log(`\n${chalk.bold("MCP servers")}  ${allMcpNames.size} unique across ${projectsWithMcpPaths.size} project(s)`);
  }

  // Explicit rules
  console.log(`\n${chalk.bold("Allow/deny rules")}  ${projectsWithRules} of ${projects.length} project(s) have explicit rules`);

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n${result.errors.length} scan error(s) — some projects could not be checked`));
  }
}
