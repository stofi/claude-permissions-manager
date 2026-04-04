import chalk from "chalk";
import { resolve } from "path";
import {
  readSettingsOrEmpty,
  resolveSettingsPath,
  writeSettings,
} from "../core/writer.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import { promptConfirm } from "../utils/prompt.js";
import { scan } from "../core/discovery.js";
import { WRITABLE_SCOPES } from "../core/types.js";
import type { SettingsScope } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";

type RuleList = "allow" | "deny" | "ask";

export interface DedupRemoval {
  list: RuleList;
  rule: string;
}

export interface DedupConflict {
  rule: string;
  lists: string[];
}

export interface DedupResult {
  settingsPath: string;
  removed: DedupRemoval[];
  conflicts: DedupConflict[];
}

function resolveProject(projectOpt?: string): string {
  if (!projectOpt) return process.cwd();
  return resolve(expandHome(projectOpt));
}

function resolveScope(scopeOpt?: string): SettingsScope {
  const scope = scopeOpt ?? "local";
  if (!WRITABLE_SCOPES.includes(scope as SettingsScope)) {
    console.error(
      chalk.red(`Invalid scope "${scope}". Valid scopes: ${WRITABLE_SCOPES.join(", ")}`)
    );
    process.exit(1);
  }
  return scope as SettingsScope;
}

/** Deduplicate a rule list, returning cleaned list and removed duplicates */
function deduplicateList(rules: string[]): { deduped: string[]; removed: string[] } {
  const seen = new Set<string>();
  const deduped: string[] = [];
  const removed: string[] = [];
  for (const rule of rules) {
    const lower = rule.toLowerCase();
    if (seen.has(lower)) {
      removed.push(rule);
    } else {
      seen.add(lower);
      deduped.push(rule);
    }
  }
  return { deduped, removed };
}

/** Find cross-list conflicts (same rule in allow AND deny) */
function findConflicts(allow: string[], deny: string[], ask: string[]): DedupConflict[] {
  const conflicts: DedupConflict[] = [];
  const allLists: [RuleList, string[]][] = [
    ["allow", allow],
    ["deny", deny],
    ["ask", ask],
  ];
  // Build map of lowercase rule → lists it appears in
  const ruleListMap = new Map<string, Set<RuleList>>();
  for (const [list, rules] of allLists) {
    for (const rule of rules) {
      const lower = rule.toLowerCase();
      if (!ruleListMap.has(lower)) ruleListMap.set(lower, new Set());
      ruleListMap.get(lower)!.add(list);
    }
  }
  for (const [lower, lists] of ruleListMap) {
    if (lists.size > 1) {
      // Find an original-case version to display
      const original = allow.find((r) => r.toLowerCase() === lower)
        ?? deny.find((r) => r.toLowerCase() === lower)
        ?? ask.find((r) => r.toLowerCase() === lower)
        ?? lower;
      conflicts.push({ rule: original, lists: [...lists] });
    }
  }
  return conflicts;
}

/** Compute dedup result for a single settings file without writing anything */
export async function computeDedup(settingsPath: string): Promise<DedupResult> {
  const existing = await readSettingsOrEmpty(settingsPath);
  const perms = existing.permissions ?? {};
  const allow = Array.isArray(perms.allow) ? (perms.allow as string[]) : [];
  const deny = Array.isArray(perms.deny) ? (perms.deny as string[]) : [];
  const ask = Array.isArray(perms.ask) ? (perms.ask as string[]) : [];

  const removed: DedupRemoval[] = [];
  const { deduped: dedupedAllow, removed: removedAllow } = deduplicateList(allow);
  const { deduped: dedupedDeny, removed: removedDeny } = deduplicateList(deny);
  const { deduped: dedupedAsk, removed: removedAsk } = deduplicateList(ask);

  for (const rule of removedAllow) removed.push({ list: "allow", rule });
  for (const rule of removedDeny) removed.push({ list: "deny", rule });
  for (const rule of removedAsk) removed.push({ list: "ask", rule });

  const conflicts = findConflicts(dedupedAllow, dedupedDeny, dedupedAsk);
  return { settingsPath, removed, conflicts };
}

/** Apply a computed dedup result, writing the cleaned settings file */
async function applyDedup(result: DedupResult): Promise<void> {
  const existing = await readSettingsOrEmpty(result.settingsPath);
  const perms = existing.permissions ?? {};
  const allow = Array.isArray(perms.allow) ? (perms.allow as string[]) : [];
  const deny = Array.isArray(perms.deny) ? (perms.deny as string[]) : [];
  const ask = Array.isArray(perms.ask) ? (perms.ask as string[]) : [];

  const { deduped: dedupedAllow } = deduplicateList(allow);
  const { deduped: dedupedDeny } = deduplicateList(deny);
  const { deduped: dedupedAsk } = deduplicateList(ask);

  const updatedPerms: Record<string, unknown> = { ...perms };
  if (dedupedAllow.length) updatedPerms.allow = dedupedAllow;
  else delete updatedPerms.allow;
  if (dedupedDeny.length) updatedPerms.deny = dedupedDeny;
  else delete updatedPerms.deny;
  if (dedupedAsk.length) updatedPerms.ask = dedupedAsk;
  else delete updatedPerms.ask;

  await writeSettings({ ...existing, permissions: updatedPerms as typeof perms }, result.settingsPath);
}

function printDedupResult(result: DedupResult, prefix = ""): void {
  if (result.removed.length > 0) {
    for (const { list, rule } of result.removed) {
      const listColor = list === "allow" ? chalk.green : list === "deny" ? chalk.red : chalk.yellow;
      console.log(`${prefix}  ${chalk.dim("remove duplicate")} ${listColor(list)}  ${rule}`);
    }
  }
  if (result.conflicts.length > 0) {
    for (const { rule, lists } of result.conflicts) {
      console.log(`${prefix}  ${chalk.yellow("⚠ conflict")}  ${rule}  ${chalk.dim(`appears in: ${lists.join(", ")}`)}`);
    }
  }
}

/** Dedup a single project's settings file */
export async function dedupCommand(opts: {
  project?: string;
  scope?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  _confirmFn?: (q: string) => Promise<boolean>;
}): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  const result = await computeDedup(settingsPath);

  if (opts.json) {
    console.log(JSON.stringify({
      settingsPath: collapseHome(settingsPath),
      removedCount: result.removed.length,
      conflictCount: result.conflicts.length,
      removed: result.removed,
      conflicts: result.conflicts,
    }, null, 2));
    return;
  }

  if (result.removed.length === 0 && result.conflicts.length === 0) {
    console.log(chalk.green(`✓ No duplicates found in ${collapseHome(settingsPath)}`));
    return;
  }

  console.log(`\n${collapseHome(settingsPath)} [${scope}]:`);
  printDedupResult(result);

  if (result.removed.length === 0) {
    // Only conflicts — nothing to write
    console.log(chalk.yellow(`\n⚠ ${result.conflicts.length} conflict(s) found. Resolve manually with cpm allow/deny/reset.`));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.cyan(`\n[dry-run] Would remove ${result.removed.length} duplicate(s). No files modified.`));
    return;
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow(`\nRemove ${result.removed.length} duplicate(s)? [Y/n] `));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  await applyDedup(result);
  console.log(chalk.green(`\n✓ Removed ${result.removed.length} duplicate(s) from ${collapseHome(settingsPath)}`));
  if (result.conflicts.length > 0) {
    console.log(chalk.yellow(`⚠ ${result.conflicts.length} conflict(s) remain. Resolve manually with cpm allow/deny/reset.`));
  }
}

/** Dedup all discovered projects */
export async function batchDedupCommand(
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  if (scope === "user") {
    console.log(chalk.yellow(`⚠ --scope user applies globally. Use: cpm dedup --scope user (without --all)`));
    return;
  }

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const scanResult = await scan(opts);
  const projects = scanResult.projects;

  if (projects.length === 0) {
    console.log(chalk.yellow("No Claude projects found."));
    return;
  }

  // Compute dedup for all projects
  const results: (DedupResult & { projectPath: string })[] = [];
  for (const project of projects) {
    const settingsPath = resolveSettingsPath(scope, project.rootPath);
    const result = await computeDedup(settingsPath);
    results.push({ ...result, projectPath: project.rootPath });
  }

  const withDuplicates = results.filter((r) => r.removed.length > 0);
  const withConflicts = results.filter((r) => r.conflicts.length > 0);
  const totalRemoved = withDuplicates.reduce((sum, r) => sum + r.removed.length, 0);

  if (opts.json) {
    console.log(JSON.stringify({
      projectCount: projects.length,
      projectsWithDuplicates: withDuplicates.length,
      totalDuplicatesRemoved: totalRemoved,
      results: results.map((r) => ({
        project: collapseHome(r.projectPath),
        settingsPath: collapseHome(r.settingsPath),
        removedCount: r.removed.length,
        conflictCount: r.conflicts.length,
        removed: r.removed,
        conflicts: r.conflicts,
      })),
    }, null, 2));
    return;
  }

  if (withDuplicates.length === 0 && withConflicts.length === 0) {
    console.log(chalk.green(`✓ No duplicates found across ${projects.length} project(s).`));
    return;
  }

  console.log(`\nFound duplicates in ${chalk.bold(withDuplicates.length)} of ${projects.length} project(s):`);
  for (const r of withDuplicates) {
    console.log(`\n  ${chalk.bold(collapseHome(r.projectPath))}`);
    printDedupResult(r, " ");
  }
  if (withConflicts.length > 0 && withDuplicates.length === 0) {
    console.log(`\nConflicts found in ${chalk.bold(withConflicts.length)} project(s) — resolve manually.`);
  }

  if (withDuplicates.length === 0) return;

  if (opts.dryRun) {
    console.log(chalk.cyan(`\n[dry-run] Would remove ${totalRemoved} duplicate(s) from ${withDuplicates.length} project(s). No files modified.`));
    return;
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(
    chalk.yellow(`\nRemove ${totalRemoved} duplicate(s) from ${withDuplicates.length} project(s)? [Y/n] `)
  );
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let successCount = 0;
  const errors: string[] = [];
  for (const r of withDuplicates) {
    try {
      await applyDedup(r);
      successCount++;
    } catch (e) {
      errors.push(`${collapseHome(r.projectPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(chalk.green(`\n✓ Removed duplicates from ${successCount} project(s).`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n✗ ${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
  }
  if (withConflicts.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${withConflicts.length} project(s) have cross-list conflicts. Resolve manually.`));
  }
}
