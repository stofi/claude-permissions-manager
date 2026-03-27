import chalk from "chalk";
import { resolve } from "path";
import {
  addRule,
  removeRule,
  setMode,
  clearAllRules,
  resolveSettingsPath,
  validateRule,
} from "../core/writer.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import type { RuleList } from "../core/writer.js";
import type { PermissionMode, SettingsScope } from "../core/types.js";

const VALID_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

function resolveProject(projectOpt?: string): string {
  if (!projectOpt) return process.cwd();
  return resolve(expandHome(projectOpt));
}

export async function allowCommand(
  rule: string,
  opts: { project?: string; scope?: string }
): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);
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
  opts: { project?: string; scope?: string }
): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);
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
  opts: { project?: string; scope?: string }
): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);

  const validation = validateRule(rule);
  if (!validation.valid) {
    console.error(chalk.red(`Invalid rule: ${validation.error}`));
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);
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
  opts: { project?: string; scope?: string }
): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

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
  opts: { project?: string; scope?: string }
): Promise<void> {
  if (!VALID_MODES.includes(mode as PermissionMode)) {
    console.error(
      chalk.red(`Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(", ")}`)
    );
    process.exit(1);
  }

  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

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
  }
}

export async function resetAllCommand(
  opts: { project?: string; scope?: string; yes?: boolean }
): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

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
