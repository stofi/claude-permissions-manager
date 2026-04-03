import chalk from "chalk";
import { createInterface } from "readline";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import { resolveSettingsPath, setMode, removeRule } from "../core/writer.js";
import type { ScanOptions } from "../core/discovery.js";
import { SEVERITY_ORDER } from "../core/types.js";
import type { WarningSeverity, FixOp } from "../core/types.js";

const SEVERITY_RANK: Record<WarningSeverity, number> = Object.fromEntries(
  SEVERITY_ORDER.map((s, i) => [s, i])
) as Record<WarningSeverity, number>;

/** Apply a single fix op to a project path. Returns null on success, error message on failure. */
async function applyFixOp(op: FixOp, projectPath: string): Promise<string | null> {
  try {
    const settingsPath = resolveSettingsPath(op.scope, projectPath);
    if (op.kind === "mode") {
      await setMode(op.mode, settingsPath);
    } else {
      await removeRule(op.rule, settingsPath);
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Prompt the user for a yes/no answer. Returns true if they answer yes. */
async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes" || answer.trim() === "");
    });
  });
}

export async function auditCommand(options: ScanOptions & {
  json?: boolean;
  exitCode?: boolean;
  minSeverity?: WarningSeverity;
  fix?: boolean;
  yes?: boolean;
  /** Override confirmation prompt for testing (avoids ESM readline mocking issues) */
  _confirmFn?: (question: string) => Promise<boolean>;
}): Promise<void> {
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
    fixOp?: FixOp;
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
          fixOp: w.fixOp,
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

  // --json output (never applies fixes)
  if (options.json) {
    const jsonIssues = allIssues.map(({ fixOp: _ignored, ...rest }) => rest);
    console.log(JSON.stringify({
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      projectCount: result.projects.length,
      affectedProjectCount: affectedProjects,
      cleanProjectCount: cleanCount,
      issueCount: allIssues.length,
      minSeverity: options.minSeverity ?? "low",
      issues: jsonIssues,
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

  // --fix: apply all available fix ops
  if (options.fix) {
    const fixable = allIssues.filter((i) => i.fixOp !== undefined);
    const unfixable = allIssues.filter((i) => i.fixOp === undefined);

    if (fixable.length === 0) {
      console.log(chalk.yellow("\nNo auto-fixable issues found."));
      exitWithCode();
      return;
    }

    // Deduplicate by (project, kind, rule/mode, scope)
    const seen = new Set<string>();
    const uniqueFixes: Array<{ project: string; fixOp: FixOp; fix: string }> = [];
    for (const issue of fixable) {
      const key = JSON.stringify({ project: issue.project, op: issue.fixOp });
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFixes.push({ project: issue.project, fixOp: issue.fixOp!, fix: issue.fix! });
      }
    }

    console.log(`\n${chalk.bold("Auto-fixable:")} ${uniqueFixes.length} fix(es) available`);
    for (const f of uniqueFixes) {
      console.log(`  ${chalk.cyan(f.fix)}`);
    }
    if (unfixable.length > 0) {
      console.log(chalk.gray(`  (${unfixable.length} issue(s) require manual intervention)`));
    }

    const confirmFn = options._confirmFn ?? promptConfirm;
    const proceed = options.yes || await confirmFn(chalk.yellow("\nApply fixes? [Y/n] "));
    if (!proceed) {
      console.log(chalk.gray("Aborted."));
      exitWithCode();
      return;
    }

    let successCount = 0;
    let failCount = 0;
    for (const f of uniqueFixes) {
      const err = await applyFixOp(f.fixOp, f.project);
      if (err) {
        console.log(chalk.red(`  ✗ ${f.fix}`));
        console.log(chalk.red(`    Error: ${err}`));
        failCount++;
      } else {
        console.log(chalk.green(`  ✓ ${f.fix}`));
        successCount++;
      }
    }

    console.log("");
    if (failCount === 0) {
      console.log(chalk.green(`✓ Applied ${successCount} fix(es) successfully.`));
    } else {
      console.log(chalk.yellow(`Applied ${successCount} fix(es); ${failCount} failed.`));
    }
    if (unfixable.length > 0) {
      console.log(chalk.gray(`Run \`cpm audit\` again to check remaining issues.`));
    }
    return;
  }

  exitWithCode();
}
