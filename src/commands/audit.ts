import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";

export async function auditCommand(options: ScanOptions & { json?: boolean; exitCode?: boolean }): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  const allIssues: Array<{
    project: string;
    severity: string;
    message: string;
    rule?: string;
  }> = [];

  for (const project of result.projects) {
    for (const w of project.effectivePermissions.warnings) {
      allIssues.push({
        project: project.rootPath,
        severity: w.severity,
        message: w.message,
        rule: w.rule,
      });
    }
  }

  const exitWithCode = () => {
    if (options.exitCode && allIssues.length > 0) {
      const hasCritical = allIssues.some((i) => i.severity === "critical");
      process.exit(hasCritical ? 2 : 1);
    }
  };

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      projectCount: result.projects.length,
      issueCount: allIssues.length,
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

  console.log(`\nFound ${chalk.bold(allIssues.length)} issue(s) across ${result.projects.length} project(s):\n`);

  for (const [severity, issues] of Object.entries(bySeverity)) {
    if (issues.length === 0) continue;
    console.log(chalk.bold(`${severity.toUpperCase()} (${issues.length})`));
    for (const issue of issues) {
      console.log(`  ${chalk.dim(collapseHome(issue.project))}`);
      console.log(`    ${issue.message}`);
      if (issue.rule) console.log(`    Rule: ${chalk.italic(issue.rule)}`);
    }
    console.log("");
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`${result.errors.length} scan error(s) — some projects could not be checked:`));
    for (const e of result.errors) {
      console.log(chalk.red(`  ${collapseHome(e.path)}: ${e.error}`));
    }
  }

  exitWithCode();
}
