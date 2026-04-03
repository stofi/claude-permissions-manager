import chalk from "chalk";
import { resolve } from "path";
import {
  addRule,
  removeRule,
  setMode,
  setBypassLock,
  clearAllRules,
  resolveSettingsPath,
  validateRule,
  readSettingsOrEmpty, // used by modeCommand dry-run
} from "../core/writer.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import { promptConfirm } from "../utils/prompt.js";
import { scan } from "../core/discovery.js";
import { PermissionModeSchema } from "../core/schemas.js";
import type { RuleList } from "../core/writer.js";
import type { PermissionMode, SettingsScope } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";
import { WRITABLE_SCOPES } from "../core/types.js";

// Derived from schema — single source of truth for valid modes
const VALID_MODES: PermissionMode[] = PermissionModeSchema.options;

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

async function previewRuleAdd(
  rule: string,
  list: RuleList,
  settingsPath: string,
  scope: SettingsScope
): Promise<void> {
  const result = await addRule(rule, list, settingsPath, { dryRun: true });
  console.log(chalk.cyan(`[dry-run] No files will be modified`));
  if (result.alreadyPresent) {
    console.log(chalk.yellow(`  Rule "${rule}" is already in ${list} list — no change`));
  } else {
    console.log(`  Would add "${chalk.bold(rule)}" to ${list} list`);
    if (result.conflictsWith) {
      const msg = result.conflictsWith === "deny" ? "deny takes precedence" : `also in ${result.conflictsWith}`;
      console.log(chalk.yellow(`  ⚠ ${msg}`));
    }
  }
  console.log(chalk.gray(`  target: ${collapseHome(settingsPath)} [${scope}]`));
}

export async function allowCommand(
  rule: string,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    await previewRuleAdd(rule, "allow", settingsPath, scope);
    return;
  }

  const result = await addRule(rule, "allow", settingsPath);

  if (result.alreadyPresent) {
    console.log(chalk.yellow(`Rule "${rule}" is already in allow list`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)}`));
  } else {
    console.log(chalk.green(`✓ Added to allow: ${chalk.bold(rule)}`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
    if (result.conflictsWith) {
      const msg = result.conflictsWith === "deny"
        ? "deny takes precedence over allow"
        : `rule also in ${result.conflictsWith} — behavior may be unexpected`;
      console.log(chalk.yellow(`  ⚠ ${msg}`));
    }
  }
}

export async function denyCommand(
  rule: string,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    await previewRuleAdd(rule, "deny", settingsPath, scope);
    return;
  }

  const result = await addRule(rule, "deny", settingsPath);

  if (result.alreadyPresent) {
    console.log(chalk.yellow(`Rule "${rule}" is already in deny list`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)}`));
  } else {
    console.log(chalk.red(`✓ Added to deny: ${chalk.bold(rule)}`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
    if (result.conflictsWith) {
      console.log(chalk.yellow(`  ⚠ Rule also exists in ${result.conflictsWith} list — deny takes precedence`));
    }
  }
}

export async function askCommand(
  rule: string,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    await previewRuleAdd(rule, "ask", settingsPath, scope);
    return;
  }

  const result = await addRule(rule, "ask", settingsPath);

  if (result.alreadyPresent) {
    console.log(chalk.yellow(`Rule "${rule}" is already in ask list`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)}`));
  } else {
    console.log(chalk.yellow(`✓ Added to ask: ${chalk.bold(rule)}`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
    if (result.conflictsWith) {
      const msg = result.conflictsWith === "deny"
        ? "deny takes precedence over ask"
        : `rule also in ${result.conflictsWith} — behavior may be unexpected`;
      console.log(chalk.yellow(`  ⚠ ${msg}`));
    }
  }
}

export async function resetRuleCommand(
  rule: string,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    const result = await removeRule(rule, settingsPath, undefined, { dryRun: true });
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    if (!result.removed) {
      console.log(chalk.yellow(`  Rule "${rule}" not found in any list — no change`));
    } else {
      console.log(`  Would remove "${chalk.bold(rule)}" from: ${result.removedFrom.join(", ")}`);
    }
    console.log(chalk.gray(`  target: ${collapseHome(settingsPath)} [${scope}]`));
    return;
  }

  const result = await removeRule(rule, settingsPath);

  if (!result.removed) {
    console.log(chalk.yellow(`Rule "${rule}" not found in any list`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)}`));
  } else {
    console.log(
      chalk.green(`✓ Removed "${rule}" from: ${result.removedFrom.join(", ")}`)
    );
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
  }
}

export async function modeCommand(
  mode: string,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  if (!VALID_MODES.includes(mode as PermissionMode)) {
    console.error(
      chalk.red(`Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(", ")}`)
    );
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    const data = await readSettingsOrEmpty(settingsPath);
    const current = data.permissions?.defaultMode ?? "default";
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(`  Would set defaultMode: ${chalk.gray(current)} → ${chalk.bold(mode)}`);
    console.log(chalk.gray(`  target: ${collapseHome(settingsPath)} [${scope}]`));
    return;
  }

  await setMode(mode as PermissionMode, settingsPath);

  const modeColorFns: Record<string, (s: string) => string> = {
    bypassPermissions: chalk.red,
    auto: chalk.yellow,
    acceptEdits: chalk.blue,
    dontAsk: chalk.magenta,
    plan: chalk.cyan,
    default: chalk.gray,
  };
  const colored = (modeColorFns[mode] ?? chalk.white)(mode);
  console.log(`✓ Set defaultMode to ${colored}`);
  console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
  if (mode === "bypassPermissions") {
    console.log(chalk.red.bold("\n⚠ WARNING: bypassPermissions disables ALL permission checks."));
    console.log(chalk.red("  Claude can now read, write, and execute anything without asking."));
    if (scope === "user") {
      console.log(chalk.red.bold("  ⚠ This is set at user scope — it applies to ALL Claude Code projects on this machine."));
    }
  }
}

export async function bypassLockCommand(
  enable: boolean,
  opts: { project?: string; scope?: string; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(`  Would ${enable ? "enable" : "disable"} bypass-permissions lock (disableBypassPermissionsMode)`);
    console.log(chalk.gray(`  target: ${collapseHome(settingsPath)} [${scope}]`));
    return;
  }

  await setBypassLock(enable, settingsPath);

  if (enable) {
    console.log(chalk.green(`✓ Bypass-permissions lock enabled — bypassPermissions mode is now blocked`));
  } else {
    console.log(chalk.yellow(`✓ Bypass-permissions lock disabled — bypassPermissions mode can now be activated`));
  }
  console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
}

export async function resetAllCommand(
  opts: { project?: string; scope?: string; yes?: boolean; dryRun?: boolean }
): Promise<void> {
  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  if (opts.dryRun) {
    const data = await readSettingsOrEmpty(settingsPath);
    const perms = data.permissions;
    const allowCount = Array.isArray(perms?.allow) ? perms.allow.length : 0;
    const denyCount = Array.isArray(perms?.deny) ? perms.deny.length : 0;
    const askCount = Array.isArray(perms?.ask) ? perms.ask.length : 0;
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    if (allowCount + denyCount + askCount === 0) {
      console.log(chalk.gray(`  No permission rules to clear`));
    } else {
      console.log(`  Would clear: ${allowCount} allow, ${denyCount} deny, ${askCount} ask rules`);
    }
    console.log(chalk.gray(`  target: ${collapseHome(settingsPath)} [${scope}]`));
    return;
  }

  if (!opts.yes) {
    console.log(
      chalk.yellow(
        `This will clear ALL permission rules from:\n  ${collapseHome(settingsPath)}`
      )
    );
    console.log(chalk.gray("Use --yes to confirm."));
    process.exit(1);
  }

  await clearAllRules(settingsPath);
  console.log(chalk.green(`✓ Cleared all permission rules`));
  console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
}

/** Apply an allow/deny/ask rule to all discovered projects at once. */
export async function batchAddCommand(
  rule: string,
  list: RuleList,
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);
  if (scope === "user") {
    console.log(chalk.yellow(`⚠ --scope user already applies to all projects globally.`));
    console.log(chalk.yellow(`  Use: cpm ${list} "${rule}" --scope user`));
    return;
  }

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(opts);
  const { projects } = result;

  if (projects.length === 0) {
    console.log(chalk.yellow("No Claude projects found."));
    return;
  }

  // Pre-check which projects already have the rule (dry-run mode per project)
  const toAdd: string[] = [];
  const alreadyHave: string[] = [];
  for (const project of projects) {
    const settingsPath = resolveSettingsPath(scope, project.rootPath);
    const check = await addRule(rule, list, settingsPath, { dryRun: true });
    if (check.alreadyPresent) {
      alreadyHave.push(project.rootPath);
    } else {
      toAdd.push(project.rootPath);
    }
  }

  if (toAdd.length === 0) {
    console.log(chalk.yellow(`All ${projects.length} project(s) already have "${rule}" in ${list} list.`));
    return;
  }

  const listColor = list === "allow" ? chalk.green : list === "deny" ? chalk.red : chalk.yellow;
  const ruleLabel = `${listColor(list)} "${chalk.bold(rule)}" [${scope}]`;

  if (opts.dryRun) {
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(`\nWould add ${ruleLabel} to ${toAdd.length} project(s):`);
    for (const p of toAdd) console.log(`  ${collapseHome(p)}`);
    if (alreadyHave.length > 0) {
      console.log(chalk.gray(`\nSkipped ${alreadyHave.length} already-present.`));
    }
    return;
  }

  console.log(`\nWill add ${ruleLabel} to ${toAdd.length} project(s):`);
  for (const p of toAdd) console.log(`  ${collapseHome(p)}`);
  if (alreadyHave.length > 0) {
    console.log(chalk.gray(`\nSkipped ${alreadyHave.length} already-present.`));
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply to all? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let added = 0;
  const errors: string[] = [];
  for (const projectPath of toAdd) {
    const settingsPath = resolveSettingsPath(scope, projectPath);
    try {
      await addRule(rule, list, settingsPath);
      added++;
    } catch (e) {
      errors.push(`${collapseHome(projectPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(chalk.green(`\n✓ Added to ${added} project(s)`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
    process.exit(1);
  }
}

/** Remove a specific rule from all discovered projects at once. */
export async function batchRemoveCommand(
  rule: string,
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  if (!rule || rule.trim() === "") {
    console.error(chalk.red("Rule cannot be empty"));
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);
  if (scope === "user") {
    console.log(chalk.yellow(`⚠ --scope user already applies globally.`));
    console.log(chalk.yellow(`  Use: cpm reset "${rule}" --scope user`));
    return;
  }

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(opts);
  const { projects } = result;

  if (projects.length === 0) {
    console.log(chalk.yellow("No Claude projects found."));
    return;
  }

  // Pre-check which projects contain the rule
  const toRemove: Array<{ projectPath: string; lists: RuleList[] }> = [];
  const notPresent: string[] = [];
  for (const project of projects) {
    const settingsPath = resolveSettingsPath(scope, project.rootPath);
    const check = await removeRule(rule, settingsPath, undefined, { dryRun: true });
    if (check.removed) {
      toRemove.push({ projectPath: project.rootPath, lists: check.removedFrom });
    } else {
      notPresent.push(project.rootPath);
    }
  }

  if (toRemove.length === 0) {
    console.log(chalk.yellow(`Rule "${rule}" not found in any project.`));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(`\nWould remove "${chalk.bold(rule)}" from ${toRemove.length} project(s):`);
    for (const { projectPath, lists } of toRemove) {
      console.log(`  ${collapseHome(projectPath)} ${chalk.dim("(" + lists.join(", ") + ")")}`);
    }
    if (notPresent.length > 0) {
      console.log(chalk.gray(`\nSkipped ${notPresent.length} without rule.`));
    }
    return;
  }

  console.log(`\nWill remove "${chalk.bold(rule)}" from ${toRemove.length} project(s):`);
  for (const { projectPath, lists } of toRemove) {
    console.log(`  ${collapseHome(projectPath)} ${chalk.dim("(" + lists.join(", ") + ")")}`);
  }
  if (notPresent.length > 0) {
    console.log(chalk.gray(`\nSkipped ${notPresent.length} without rule.`));
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply to all? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let removed = 0;
  const errors: string[] = [];
  for (const { projectPath } of toRemove) {
    const settingsPath = resolveSettingsPath(scope, projectPath);
    try {
      await removeRule(rule, settingsPath);
      removed++;
    } catch (e) {
      errors.push(`${collapseHome(projectPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(chalk.green(`\n✓ Removed from ${removed} project(s)`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
    process.exit(1);
  }
}

/** Set defaultMode across all discovered projects at once. */
export async function batchModeCommand(
  mode: string,
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  if (!VALID_MODES.includes(mode as PermissionMode)) {
    console.error(chalk.red(`Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(", ")}`));
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);
  if (scope === "user") {
    console.log(chalk.yellow(`⚠ --scope user already applies to all projects globally.`));
    console.log(chalk.yellow(`  Use: cpm mode ${mode} --scope user`));
    return;
  }

  if (mode === "bypassPermissions") {
    console.log(chalk.red.bold("⚠ WARNING: bypassPermissions disables ALL permission checks."));
    console.log(chalk.red("  Claude can read, write, and execute anything without asking."));
  }

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(opts);
  const { projects } = result;

  if (projects.length === 0) {
    console.log(chalk.yellow("No Claude projects found."));
    return;
  }

  // Pre-check which projects need updating
  const toUpdate: Array<{ projectPath: string; currentMode: string }> = [];
  const alreadySet: string[] = [];
  for (const project of projects) {
    const settingsPath = resolveSettingsPath(scope, project.rootPath);
    const data = await readSettingsOrEmpty(settingsPath);
    const currentMode = data.permissions?.defaultMode ?? "default";
    if (currentMode === mode) {
      alreadySet.push(project.rootPath);
    } else {
      toUpdate.push({ projectPath: project.rootPath, currentMode });
    }
  }

  if (toUpdate.length === 0) {
    console.log(chalk.yellow(`All ${projects.length} project(s) already have mode "${mode}".`));
    return;
  }

  const modeLabel = chalk.bold(mode);

  if (opts.dryRun) {
    console.log(chalk.cyan(`[dry-run] No files will be modified`));
    console.log(`\nWould set mode to ${modeLabel} in ${toUpdate.length} project(s):`);
    for (const { projectPath, currentMode } of toUpdate) {
      console.log(`  ${collapseHome(projectPath)} ${chalk.dim(`(${currentMode} → ${mode})`)}`);
    }
    if (alreadySet.length > 0) {
      console.log(chalk.gray(`\nSkipped ${alreadySet.length} already set to "${mode}".`));
    }
    return;
  }

  console.log(`\nWill set mode to ${modeLabel} in ${toUpdate.length} project(s):`);
  for (const { projectPath, currentMode } of toUpdate) {
    console.log(`  ${collapseHome(projectPath)} ${chalk.dim(`(${currentMode} → ${mode})`)}`);
  }
  if (alreadySet.length > 0) {
    console.log(chalk.gray(`\nSkipped ${alreadySet.length} already set to "${mode}".`));
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply to all? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let updated = 0;
  const errors: string[] = [];
  for (const { projectPath } of toUpdate) {
    const settingsPath = resolveSettingsPath(scope, projectPath);
    try {
      await setMode(mode as PermissionMode, settingsPath);
      updated++;
    } catch (e) {
      errors.push(`${collapseHome(projectPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(chalk.green(`\n✓ Updated ${updated} project(s) to mode "${mode}"`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
    process.exit(1);
  }
}
