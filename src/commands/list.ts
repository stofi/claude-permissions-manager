import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { formatProjectTable } from "../utils/format.js";
import { collapseHome } from "../utils/paths.js";
import { SEVERITY_ORDER } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";
import type { WarningSeverity } from "../core/types.js";

type SortField = "name" | "warnings" | "mode";

function sortProjects(projects: Awaited<ReturnType<typeof scan>>["projects"], sort: SortField) {
  return [...projects].sort((a, b) => {
    if (sort === "name") return a.rootPath.localeCompare(b.rootPath);
    if (sort === "warnings") return b.effectivePermissions.warnings.length - a.effectivePermissions.warnings.length;
    // sort === "mode"
    return a.effectivePermissions.defaultMode.localeCompare(b.effectivePermissions.defaultMode);
  });
}

export async function listCommand(options: ScanOptions & { json?: boolean; warningsOnly?: boolean; sort?: string; minSeverity?: WarningSeverity }): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));

  const result = await scan(options);

  // --min-severity filters to projects with at least one warning at that level or higher.
  // --warnings (without --min-severity) shows all projects with any warnings.
  const minSevIdx = options.minSeverity !== undefined
    ? SEVERITY_ORDER.indexOf(options.minSeverity)
    : SEVERITY_ORDER.length - 1; // "low" (all severities)

  const isWarningsFilter = options.warningsOnly || options.minSeverity !== undefined;
  const filtered = isWarningsFilter
    ? result.projects.filter((p) =>
        p.effectivePermissions.warnings.some(
          (w) => SEVERITY_ORDER.indexOf(w.severity) <= minSevIdx
        )
      )
    : result.projects;

  const projects = options.sort && (["name", "warnings", "mode"] as string[]).includes(options.sort)
    ? sortProjects(filtered, options.sort as SortField)
    : filtered;

  if (options.json) {
    const output = {
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      projectCount: projects.length,
      minSeverity: options.minSeverity ?? null,
      projects: projects.map((p) => ({
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
          envVarNames: s.envVarNames ?? [],
          headerNames: s.headerNames ?? [],
        })),
        envVarNames: p.effectivePermissions.envVarNames,
        additionalDirs: p.effectivePermissions.additionalDirs,
        warningCount: p.effectivePermissions.warnings.length,
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

  if (isWarningsFilter && projects.length === 0) {
    const filterNote = options.minSeverity ? ` at ${options.minSeverity}+ severity` : "";
    console.log(chalk.green(`\n✓ No warnings${filterNote} found across ${result.projects.length} project(s).`));
    return;
  }

  // Show global settings if present
  if (result.global.user?.exists) {
    console.log(chalk.dim(`\nUser settings: ${collapseHome(result.global.user.path)}`));
  }
  if (result.global.managed?.exists) {
    console.log(chalk.dim(`Managed settings: ${collapseHome(result.global.managed.path)}`));
  }

  const severityLabel = options.minSeverity ? `${options.minSeverity}+ ` : "";
  const countLabel = isWarningsFilter
    ? `${chalk.bold(projects.length)} of ${result.projects.length} project(s) have ${severityLabel}warnings`
    : `${chalk.bold(projects.length)} project(s)`;
  console.log(`\nFound ${countLabel}\n`);
  console.log(formatProjectTable(projects));

  const totalWarnings = projects.reduce(
    (sum, p) => sum + p.effectivePermissions.warnings.length,
    0
  );
  if (!options.warningsOnly && totalWarnings > 0) {
    console.log(chalk.yellow(`\n⚠ ${totalWarnings} warning(s) across all projects. Run 'cpm audit' for details.`));
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n${result.errors.length} error(s) during scan:`));
    for (const e of result.errors) {
      console.log(chalk.red(`  ${collapseHome(e.path)}: ${e.error}`));
    }
  }
}
