import chalk from "chalk";
import { resolve } from "path";
import { scan } from "../core/discovery.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import {
  readSettingsOrEmpty,
  resolveSettingsPath,
  writeSettings,
} from "../core/writer.js";
import { promptConfirm } from "../utils/prompt.js";
import { WRITABLE_SCOPES } from "../core/types.js";
import type { SettingsScope } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";

export async function copyCommand(
  sourcePath: string,
  targetPath: string,
  opts: { scope?: string; dryRun?: boolean; yes?: boolean }
): Promise<void> {
  const root1 = resolve(expandHome(sourcePath));
  const root2 = resolve(expandHome(targetPath));

  if (root1 === root2) {
    console.error(chalk.red("Source and target paths are the same."));
    process.exit(1);
  }

  const scope = opts.scope ?? "local";
  if (!WRITABLE_SCOPES.includes(scope as SettingsScope)) {
    console.error(
      chalk.red(`Invalid scope "${scope}". Valid scopes: ${WRITABLE_SCOPES.join(", ")}`)
    );
    process.exit(1);
  }

  // Scan source without global — we copy only project/local scoped rules
  const srcResult = await scan({ root: root1, maxDepth: 1, includeGlobal: false });
  const srcProject = srcResult.projects.find((p) => p.rootPath === root1);
  if (!srcProject) {
    console.error(chalk.red(`No .claude directory found at: ${collapseHome(root1)}`));
    process.exit(1);
  }

  // Extract project/local-scoped rules from source effective permissions
  const perms = srcProject.effectivePermissions;
  const allowRules = perms.allow
    .filter((r) => r.scope === "project" || r.scope === "local")
    .map((r) => r.raw);
  const denyRules = perms.deny
    .filter((r) => r.scope === "project" || r.scope === "local")
    .map((r) => r.raw);
  const askRules = perms.ask
    .filter((r) => r.scope === "project" || r.scope === "local")
    .map((r) => r.raw);

  // Find mode set at project/local scope (local takes precedence over project)
  const srcMode = srcProject.settingsFiles
    .filter((f) => (f.scope === "local" || f.scope === "project") && f.data?.permissions?.defaultMode)
    .sort((a) => (a.scope === "local" ? -1 : 1))
    .find(() => true)?.data?.permissions?.defaultMode;

  const totalRules = allowRules.length + denyRules.length + askRules.length;
  const targetSettingsPath = resolveSettingsPath(scope as SettingsScope, root2);

  console.log(`\nCopying from: ${chalk.bold(collapseHome(root1))}`);
  console.log(`         to: ${chalk.bold(collapseHome(root2))} [${scope}]`);
  console.log("");

  if (totalRules === 0 && !srcMode) {
    console.log(chalk.yellow("Nothing to copy — source has no project-level rules or mode."));
    return;
  }

  if (allowRules.length > 0) {
    console.log(chalk.green(`  Allow (${allowRules.length}): ${allowRules.join(", ")}`));
  }
  if (denyRules.length > 0) {
    console.log(chalk.red(`  Deny  (${denyRules.length}): ${denyRules.join(", ")}`));
  }
  if (askRules.length > 0) {
    console.log(chalk.yellow(`  Ask   (${askRules.length}): ${askRules.join(", ")}`));
  }
  if (srcMode) {
    console.log(chalk.blue(`  Mode: ${srcMode}`));
  }
  console.log("");

  if (opts.dryRun) {
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(chalk.gray(`  target: ${collapseHome(targetSettingsPath)}`));
    return;
  }

  if (!opts.yes) {
    console.log(chalk.yellow(`Will write to: ${collapseHome(targetSettingsPath)}`));
    console.log(chalk.gray("Use --yes to confirm, or --dry-run to preview."));
    process.exit(1);
  }

  // Read existing target settings and merge (dedup)
  const existing = await readSettingsOrEmpty(targetSettingsPath);
  const existingPerms = existing.permissions ?? {};
  const existingAllow = Array.isArray(existingPerms.allow) ? existingPerms.allow : [];
  const existingDeny = Array.isArray(existingPerms.deny) ? existingPerms.deny : [];
  const existingAsk = Array.isArray(existingPerms.ask) ? existingPerms.ask : [];

  const newPerms: typeof existingPerms = {
    ...existingPerms,
    allow: [...new Set([...existingAllow, ...allowRules])],
    deny: [...new Set([...existingDeny, ...denyRules])],
    ask: [...new Set([...existingAsk, ...askRules])],
  };
  if (srcMode) newPerms.defaultMode = srcMode;

  await writeSettings({ ...existing, permissions: newPerms }, targetSettingsPath);

  const parts: string[] = [];
  if (totalRules > 0) parts.push(`${totalRules} rule(s)`);
  if (srcMode) parts.push(`mode "${srcMode}"`);
  console.log(
    chalk.green(`✓ Copied ${parts.join(" + ")} to ${collapseHome(targetSettingsPath)} [${scope}]`)
  );
}

/** Copy source project's rules to ALL discovered projects at once. */
export async function batchCopyCommand(
  sourcePath: string,
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  const root1 = resolve(expandHome(sourcePath));

  const scope = opts.scope ?? "local";
  if (!WRITABLE_SCOPES.includes(scope as SettingsScope)) {
    console.error(chalk.red(`Invalid scope "${scope}". Valid scopes: ${WRITABLE_SCOPES.join(", ")}`));
    process.exit(1);
  }

  if (scope === "user") {
    console.log(chalk.yellow(`⚠ --scope user already applies to all projects globally.`));
    console.log(chalk.yellow(`  Use: cpm copy <source> <target> --scope user`));
    return;
  }

  // Extract source rules (without global settings, project/local scope only)
  const srcResult = await scan({ root: root1, maxDepth: 1, includeGlobal: false });
  const srcProject = srcResult.projects.find((p) => p.rootPath === root1);
  if (!srcProject) {
    console.error(chalk.red(`No .claude directory found at: ${collapseHome(root1)}`));
    process.exit(1);
  }

  const perms = srcProject.effectivePermissions;
  const allowRules = perms.allow.filter((r) => r.scope === "project" || r.scope === "local").map((r) => r.raw);
  const denyRules = perms.deny.filter((r) => r.scope === "project" || r.scope === "local").map((r) => r.raw);
  const askRules = perms.ask.filter((r) => r.scope === "project" || r.scope === "local").map((r) => r.raw);
  const srcMode = srcProject.settingsFiles
    .filter((f) => (f.scope === "local" || f.scope === "project") && f.data?.permissions?.defaultMode)
    .sort((a) => (a.scope === "local" ? -1 : 1))
    .find(() => true)?.data?.permissions?.defaultMode;

  const totalRules = allowRules.length + denyRules.length + askRules.length;

  if (totalRules === 0 && !srcMode) {
    console.log(chalk.yellow("Nothing to copy — source has no project-level rules or mode."));
    return;
  }

  // Scan for all projects (excluding source)
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(opts);
  const targets = result.projects.filter((p) => p.rootPath !== root1);

  if (targets.length === 0) {
    console.log(chalk.yellow("No other Claude projects found to copy to."));
    return;
  }

  // Show what will be copied
  console.log(`\nCopying from: ${chalk.bold(collapseHome(root1))}`);
  if (allowRules.length > 0) console.log(chalk.green(`  Allow (${allowRules.length}): ${allowRules.join(", ")}`));
  if (denyRules.length > 0) console.log(chalk.red(`  Deny  (${denyRules.length}): ${denyRules.join(", ")}`));
  if (askRules.length > 0) console.log(chalk.yellow(`  Ask   (${askRules.length}): ${askRules.join(", ")}`));
  if (srcMode) console.log(chalk.blue(`  Mode: ${srcMode}`));

  console.log(`\nTo ${chalk.bold(targets.length)} project(s) [${scope}]:`);
  for (const t of targets) {
    console.log(`  ${collapseHome(t.rootPath)}`);
  }

  if (opts.dryRun) {
    console.log(chalk.cyan(`\n[dry-run] No files will be modified`));
    return;
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply to all? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let copied = 0;
  const errors: string[] = [];
  for (const target of targets) {
    const targetSettingsPath = resolveSettingsPath(scope as SettingsScope, target.rootPath);
    try {
      const existing = await readSettingsOrEmpty(targetSettingsPath);
      const existingPerms = existing.permissions ?? {};
      const existingAllow = Array.isArray(existingPerms.allow) ? existingPerms.allow : [];
      const existingDeny = Array.isArray(existingPerms.deny) ? existingPerms.deny : [];
      const existingAsk = Array.isArray(existingPerms.ask) ? existingPerms.ask : [];
      const newPerms: typeof existingPerms = {
        ...existingPerms,
        allow: [...new Set([...existingAllow, ...allowRules])],
        deny: [...new Set([...existingDeny, ...denyRules])],
        ask: [...new Set([...existingAsk, ...askRules])],
      };
      if (srcMode) newPerms.defaultMode = srcMode;
      await writeSettings({ ...existing, permissions: newPerms }, targetSettingsPath);
      copied++;
    } catch (e) {
      errors.push(`${collapseHome(target.rootPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const parts: string[] = [];
  if (totalRules > 0) parts.push(`${totalRules} rule(s)`);
  if (srcMode) parts.push(`mode "${srcMode}"`);
  console.log(chalk.green(`\n✓ Copied ${parts.join(" + ")} to ${copied} project(s) [${scope}]`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
    process.exit(1);
  }
}
