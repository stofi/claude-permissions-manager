import chalk from "chalk";
import { resolve } from "path";
import {
  addRule,
  removeRule,
  setMode,
  clearAllRules,
  resolveSettingsPath,
  validateRule,
  readSettingsOrEmpty, // used by modeCommand dry-run
} from "../core/writer.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import { PermissionModeSchema } from "../core/schemas.js";
import type { RuleList } from "../core/writer.js";
import type { PermissionMode, SettingsScope } from "../core/types.js";
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

  const modeColors: Record<string, string> = {
    bypassPermissions: "red",
    auto: "yellow",
    acceptEdits: "blue",
    dontAsk: "magenta",
    plan: "cyan",
    default: "gray",
  };
  const color = modeColors[mode] ?? "white";
  const colorFn = (chalk as unknown as Record<string, (s: string) => string>)[color];
  const colored = colorFn ? colorFn(mode) : mode;
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
