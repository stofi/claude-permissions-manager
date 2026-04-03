import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";

type RuleType = "allow" | "deny" | "ask";

interface RuleEntry {
  rule: string;
  type: RuleType;
  count: number;
  projects: string[];
}

export async function rulesCommand(
  options: ScanOptions & {
    json?: boolean;
    type?: string;
    top?: number;
  }
): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  const ruleTypes: RuleType[] = options.type
    ? [options.type as RuleType]
    : ["allow", "deny", "ask"];

  // Aggregate: (rule, type) → set of project paths
  const map = new Map<string, { type: RuleType; projects: Set<string> }>();

  for (const project of result.projects) {
    for (const type of ruleTypes) {
      for (const rule of project.effectivePermissions[type]) {
        const key = `${type}:${rule.raw}`;
        if (!map.has(key)) {
          map.set(key, { type, projects: new Set() });
        }
        map.get(key)!.projects.add(project.rootPath);
      }
    }
  }

  // Build sorted list: frequency desc, then alphabetically
  const entries: RuleEntry[] = [...map.entries()]
    .map(([key, { type, projects }]) => ({
      rule: key.slice(type.length + 1),
      type,
      count: projects.size,
      projects: [...projects].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));

  const limited = options.top ? entries.slice(0, options.top) : entries;

  if (options.json) {
    console.log(JSON.stringify({
      typeFilter: options.type ?? null,
      top: options.top ?? null,
      totalProjects: result.projects.length,
      totalRules: entries.length,
      rules: limited.map((e) => ({
        rule: e.rule,
        type: e.type,
        count: e.count,
        projects: e.projects,
      })),
    }, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(chalk.yellow("\nNo rules found."));
    return;
  }

  const typeLabel = options.type ? ` (${options.type})` : "";
  const topLabel = options.top ? ` (top ${options.top})` : "";
  console.log(`\n${chalk.bold(limited.length)} unique rule(s)${typeLabel}${topLabel} across ${chalk.bold(result.projects.length)} project(s):\n`);

  for (const e of limited) {
    const typeColor = e.type === "allow" ? chalk.green : e.type === "deny" ? chalk.red : chalk.yellow;
    const countStr = e.count === 1 ? "1 project" : `${e.count} projects`;
    console.log(
      `  ${typeColor(e.type.padEnd(5))}  ${e.rule.padEnd(40)}  ${chalk.dim(countStr)}`
    );
    if (result.projects.length <= 20) {
      // For small scans show project names; for large ones it's too noisy
      for (const p of e.projects) {
        console.log(`           ${chalk.dim(collapseHome(p))}`);
      }
    }
  }
}
