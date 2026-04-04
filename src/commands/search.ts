import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";
import type { SettingsScope } from "../core/types.js";

type RuleType = "allow" | "deny" | "ask";

interface SearchMatch {
  project: string;
  type: RuleType;
  rule: string;
  scope: SettingsScope;
}

export async function searchCommand(
  pattern: string,
  options: ScanOptions & {
    json?: boolean;
    type?: string;
    exact?: boolean;
    scope?: string;
    exitCode?: boolean;
  }
): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  const normalPattern = pattern.toLowerCase();
  const ruleTypes: RuleType[] = options.type
    ? [options.type as RuleType]
    : ["allow", "deny", "ask"];

  const matches: SearchMatch[] = [];

  for (const project of result.projects) {
    for (const type of ruleTypes) {
      for (const rule of project.effectivePermissions[type]) {
        if (options.scope && rule.scope !== options.scope) continue;
        const ruleStr = rule.raw.toLowerCase();
        const matched = options.exact
          ? ruleStr === normalPattern
          : ruleStr.includes(normalPattern);
        if (matched) {
          matches.push({ project: project.rootPath, type, rule: rule.raw, scope: rule.scope });
        }
      }
    }
  }

  const projectPaths = new Set(matches.map((m) => m.project));

  if (options.json) {
    console.log(JSON.stringify({
      pattern,
      exact: options.exact ?? false,
      typeFilter: options.type ?? null,
      scopeFilter: options.scope ?? null,
      matchCount: matches.length,
      projectCount: projectPaths.size,
      matches,
    }, null, 2));
    if (options.exitCode && matches.length === 0) process.exit(1);
    return;
  }

  if (matches.length === 0) {
    console.log(chalk.yellow(`\nNo rules matching "${pattern}" found.`));
    if (options.exitCode) process.exit(1);
    return;
  }

  const projectWord = projectPaths.size === 1 ? "project" : "projects";
  console.log(`\nFound ${chalk.bold(matches.length)} match(es) in ${chalk.bold(projectPaths.size)} ${projectWord}:\n`);

  // Group by project (sorted for stable output)
  for (const projectPath of [...projectPaths].sort()) {
    const projectMatches = matches.filter((m) => m.project === projectPath);
    console.log(chalk.bold(collapseHome(projectPath)));
    for (const m of projectMatches) {
      const typeColor = m.type === "allow" ? chalk.green : m.type === "deny" ? chalk.red : chalk.yellow;
      console.log(`  ${typeColor(m.type.padEnd(5))}  ${m.rule}  ${chalk.dim(`[${m.scope}]`)}`);
    }
  }
}
