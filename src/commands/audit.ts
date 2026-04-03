import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";
import { SEVERITY_ORDER } from "../core/types.js";
import type { WarningSeverity } from "../core/types.js";

const SEVERITY_RANK: Record<WarningSeverity, number> = Object.fromEntries(
  SEVERITY_ORDER.map((s, i) => [s, i])
) as Record<WarningSeverity, number>;

export async function auditCommand(options: ScanOptions & { json?: boolean; exitCode?: boolean; minSeverity?: WarningSeverity }): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  const effectiveMinIdx = options.minSeverity !== undefined
    ? SEVERITY_RANK[options.minSeverity]
    : SEVERITY_ORDER.length - 1;

  const allIssues: Array<{
    project: string;
    severity: string;
    message: string;
    rule?: string;
    fix?: string;
  }> = [];

  for (const project of result.projects) {
    for (const w of project.effectivePermissions.warnings) {
      if (SEVERITY_RANK[w.severity] <= effectiveMinIdx) {
        allIssues.push({
          project: project.rootPath,
          severity: w.severity,
          message: w.message,
          rule: w.rule,
          fix: w.fixCmd ? `${w.fixCmd} --project ${project.rootPath}` : undefined,
        });
      }
    }
  }

  const exitWithCode = () => {
    if (options.exitCode && allIssues.length > 0) {
      const hasCritical = allIssues.some((i) => i.severity === "critical");
      process.exit(hasCritical ? 2 : 1);
    }
  };

  const affectedProjects = new Set(allIssues.map((i) => i.project)).size;
  const cleanCount = result.projects.length - affectedProjects;

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      projectCount: result.projects.length,
      affectedProjectCount: affectedProjects,
      cleanProjectCount: cleanCount,
      issueCount: allIssues.length,
      minSeverity: options.minSeverity ?? "low",
      issues: allIssues,
      errors: result.errors,
    }, null, 2));
    exitWithCode();
    return;
  }

  if (allIssues.length === 0) {
    console.log(chalk.green(`\n✓ No issues found across ${result.projects.length} project(s).`));
    if (result.errors.length > 0) {
      console.log(chalk.red(`\n${result.errors.length} scan error(s) — some projects could not be checked:`));
      for (const e of result.errors) {
        console.log(chalk.red(`  ${collapseHome(e.path)}: ${e.error}`));
      }
    }
    return; // exit 0
  }

  const bySeverity = {
    critical: allIssues.filter((i) => i.severity === "critical"),
    high: allIssues.filter((i) => i.severity === "high"),
    medium: allIssues.filter((i) => i.severity === "medium"),
    low: allIssues.filter((i) => i.severity === "low"),
  };

  const filterNote = options.minSeverity && options.minSeverity !== "low"
    ? chalk.gray(` (showing ${options.minSeverity}+ only)`)
    : "";
  console.log(`\nFound ${chalk.bold(allIssues.length)} issue(s) in ${chalk.bold(affectedProjects)} of ${result.projects.length} project(s)${filterNote}:\n`);

  for (const [severity, issues] of Object.entries(bySeverity)) {
    if (issues.length === 0) continue;
    console.log(chalk.bold(`${severity.toUpperCase()} (${issues.length})`));
    for (const issue of issues) {
      console.log(`  ${chalk.dim(collapseHome(issue.project))}`);
      console.log(`    ${issue.message}`);
      if (issue.rule) console.log(`    Rule: ${chalk.italic(issue.rule)}`);
      if (issue.fix) console.log(`    Fix:  ${chalk.cyan(issue.fix)}`);
    }
    console.log("");
  }

  if (cleanCount > 0) {
    console.log(chalk.green(`✓ ${cleanCount} project(s) have no issues${filterNote}.`));
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n${result.errors.length} scan error(s) — some projects could not be checked:`));
    for (const e of result.errors) {
      console.log(chalk.red(`  ${collapseHome(e.path)}: ${e.error}`));
    }
  }

  exitWithCode();
}
