import chalk from "chalk";
import { resolve } from "path";
import {
  readSettingsOrEmpty,
  resolveSettingsPath,
  writeSettings,
  setBypassLock,
} from "../core/writer.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import { promptConfirm } from "../utils/prompt.js";
import { scan } from "../core/discovery.js";
import { WRITABLE_SCOPES } from "../core/types.js";
import type { SettingsScope, PermissionMode } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";

export interface PresetDef {
  description: string;
  allow?: string[];
  deny?: string[];
  ask?: string[];
  mode?: PermissionMode;
  bypassLock?: boolean;
}

/** Built-in security presets */
export const PRESETS: Record<string, PresetDef> = {
  safe: {
    description: "Block shell execution and writes; keep read access",
    deny: ["Bash(*)", "Write(**)", "Edit(**)", "MultiEdit(**)"],
  },
  readonly: {
    description: "Block all writes, shell, and network fetch; read-only",
    deny: ["Bash(*)", "Write(**)", "Edit(**)", "MultiEdit(**)", "WebFetch(*)", "WebSearch(*)"],
  },
  locked: {
    description: "Block shell and writes, enable bypass-permissions lock",
    deny: ["Bash(*)", "Write(**)", "Edit(**)", "MultiEdit(**)"],
    bypassLock: true,
  },
  open: {
    description: "Allow all tools (removes restrictive deny rules)",
    allow: ["Bash(*)", "Write(**)", "Edit(**)", "Read(*)", "WebFetch(*)", "WebSearch(*)"],
  },
  cautious: {
    description: "Prompt before all tool use (ask mode)",
    mode: "dontAsk" as PermissionMode,
    deny: ["Bash(*)", "Write(**)", "Edit(**)"],
  },
};

export const PRESET_NAMES = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;

function resolveScope(raw?: string): SettingsScope {
  const s = raw ?? "local";
  if (!WRITABLE_SCOPES.includes(s as SettingsScope)) {
    console.error(chalk.red(`Invalid scope "${s}". Valid: ${WRITABLE_SCOPES.join(", ")}`));
    process.exit(1);
  }
  return s as SettingsScope;
}

function resolveProject(raw?: string): string {
  return raw ? resolve(expandHome(raw)) : process.cwd();
}

/** Merge preset rules into existing settings, deduplicating. */
async function applyPresetToFile(
  preset: PresetDef,
  settingsPath: string
): Promise<void> {
  const existing = await readSettingsOrEmpty(settingsPath);
  const perms = existing.permissions ?? {};

  const mergeRules = (existing: unknown, additions: string[] | undefined): string[] => {
    const base = Array.isArray(existing) ? (existing as string[]) : [];
    if (!additions?.length) return base;
    const set = new Set(base);
    for (const r of additions) set.add(r);
    return [...set];
  };

  const updated = {
    ...existing,
    permissions: {
      ...perms,
      allow: mergeRules(perms.allow, preset.allow),
      deny: mergeRules(perms.deny, preset.deny),
      ask: mergeRules(perms.ask, preset.ask),
      ...(preset.mode !== undefined ? { defaultMode: preset.mode } : {}),
    },
  };

  // Remove empty arrays to keep files clean
  if (!updated.permissions.allow.length) delete (updated.permissions as Record<string, unknown>).allow;
  if (!updated.permissions.deny.length) delete (updated.permissions as Record<string, unknown>).deny;
  if (!updated.permissions.ask.length) delete (updated.permissions as Record<string, unknown>).ask;

  await writeSettings(updated, settingsPath);

  if (preset.bypassLock) {
    await setBypassLock(true, settingsPath);
  }
}

function formatPresetPreview(name: string, preset: PresetDef): string {
  const lines: string[] = [
    `  ${chalk.bold(name)}: ${chalk.gray(preset.description)}`,
  ];
  if (preset.allow?.length) lines.push(`    allow: ${preset.allow.map((r) => chalk.green(r)).join(", ")}`);
  if (preset.deny?.length) lines.push(`    deny:  ${preset.deny.map((r) => chalk.red(r)).join(", ")}`);
  if (preset.ask?.length) lines.push(`    ask:   ${preset.ask.map((r) => chalk.yellow(r)).join(", ")}`);
  if (preset.mode) lines.push(`    mode:  ${chalk.cyan(preset.mode)}`);
  if (preset.bypassLock) lines.push(`    bypass-lock: ${chalk.red("on")}`);
  return lines.join("\n");
}

/** List all available presets */
export function listPresetsCommand(): void {
  console.log(chalk.bold("\nAvailable presets:\n"));
  for (const [name, def] of Object.entries(PRESETS)) {
    console.log(formatPresetPreview(name, def));
    console.log("");
  }
}

/** Apply a preset to a single project */
export async function presetCommand(
  presetName: string,
  opts: {
    project?: string;
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(chalk.red(`Unknown preset "${presetName}". Available: ${PRESET_NAMES.join(", ")}`));
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);
  const projectPath = resolveProject(opts.project);
  const settingsPath = resolveSettingsPath(scope, projectPath);

  console.log(`\nPreset ${chalk.bold(presetName)}: ${chalk.gray(preset.description)}`);
  console.log(formatPresetPreview(presetName, preset));
  console.log(chalk.gray(`\n  target: ${collapseHome(settingsPath)} [${scope}]`));

  if (opts.dryRun) {
    console.log(chalk.cyan(`\n[dry-run] No files will be modified`));
    return;
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply preset? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  try {
    await applyPresetToFile(preset, settingsPath);
    console.log(chalk.green(`\n✓ Applied preset "${presetName}"`));
    console.log(chalk.gray(`  in: ${collapseHome(settingsPath)} [${scope}]`));
  } catch (e) {
    console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

/** Apply a preset to all discovered projects */
export async function batchPresetCommand(
  presetName: string,
  opts: ScanOptions & {
    scope?: string;
    dryRun?: boolean;
    yes?: boolean;
    _confirmFn?: (q: string) => Promise<boolean>;
  }
): Promise<void> {
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(chalk.red(`Unknown preset "${presetName}". Available: ${PRESET_NAMES.join(", ")}`));
    process.exit(1);
  }

  const scope = resolveScope(opts.scope);

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(opts);
  const projects = result.projects;

  if (projects.length === 0) {
    console.log(chalk.yellow("No Claude projects found."));
    return;
  }

  console.log(`\nPreset ${chalk.bold(presetName)}: ${chalk.gray(preset.description)}`);
  console.log(formatPresetPreview(presetName, preset));
  console.log(`\nWill apply to ${chalk.bold(projects.length)} project(s):`);
  for (const p of projects) {
    console.log(`  ${collapseHome(p.rootPath)}`);
  }

  if (opts.dryRun) {
    console.log(chalk.cyan(`\n[dry-run] No files will be modified`));
    return;
  }

  const confirmFn = opts._confirmFn ?? promptConfirm;
  const proceed = opts.yes || await confirmFn(chalk.yellow("\nApply preset to all? [Y/n] "));
  if (!proceed) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  let applied = 0;
  const errors: string[] = [];
  for (const p of projects) {
    const settingsPath = resolveSettingsPath(scope, p.rootPath);
    try {
      await applyPresetToFile(preset, settingsPath);
      applied++;
    } catch (e) {
      errors.push(`${collapseHome(p.rootPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(chalk.green(`\n✓ Applied preset "${presetName}" to ${applied} project(s)`));
  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s):`));
    for (const err of errors) console.log(chalk.red(`  ${err}`));
    process.exit(1);
  }
}
