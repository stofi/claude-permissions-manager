import chalk from "chalk";
import { resolve } from "path";
import { stat } from "fs/promises";
import { expandHome, collapseHome } from "../utils/paths.js";
import { resolveSettingsPath } from "../core/writer.js";
import { addRule, setMode, clearAllRules } from "../core/writer.js";
import { PermissionModeSchema } from "../core/schemas.js";
import type { PermissionMode, SettingsScope } from "../core/types.js";

// Derived from schema — single source of truth
const VALID_MODES: PermissionMode[] = PermissionModeSchema.options;
const VALID_SCOPES: SettingsScope[] = ["local", "project", "user"];

interface InitOptions {
  project?: string;
  scope?: string;
  mode?: string;
  preset?: string;
  yes?: boolean;
}

const PRESETS: Record<string, {
  description: string;
  allow: string[];
  deny: string[];
  ask: string[];
  mode: PermissionMode;
}> = {
  safe: {
    description: "Read-only defaults with common safe Bash commands",
    mode: "default",
    allow: [
      "Read",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(ls *)",
      "Bash(cat *)",
    ],
    deny: [
      "Read(**/.env)",
      "Read(**/*.key)",
      "Read(**/*.pem)",
      "Read(**/secrets/**)",
      "Bash(sudo *)",
      "Bash(rm -rf *)",
    ],
    ask: [
      "Bash(git push *)",
    ],
  },
  node: {
    description: "Node.js / npm project development",
    mode: "acceptEdits",
    allow: [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Read",
    ],
    deny: [
      "Read(**/.env)",
      "Read(**/*.key)",
      "Bash(sudo *)",
      "Bash(rm -rf *)",
    ],
    ask: [
      "Bash(git push *)",
      "Bash(npm publish *)",
    ],
  },
  strict: {
    description: "Highly restrictive — read-only, no shell, no writes",
    mode: "default",
    allow: [
      "Read",
      "Glob",
      "Grep",
    ],
    deny: [
      "Bash",
      "Write",
      "Edit",
      "WebFetch",
      "WebSearch",
    ],
    ask: [],
  },
};

export async function initCommand(opts: InitOptions): Promise<void> {
  const rawScope = opts.scope ?? "project";
  if (!VALID_SCOPES.includes(rawScope as SettingsScope)) {
    console.error(
      chalk.red(`Invalid scope "${rawScope}". Valid scopes: ${VALID_SCOPES.join(", ")}`)
    );
    process.exit(1);
  }
  const scope = rawScope as SettingsScope;
  const projectPath = opts.project
    ? resolve(expandHome(opts.project))
    : process.cwd();
  const preset = opts.preset ?? "safe";

  if (!PRESETS[preset]) {
    console.error(
      chalk.red(
        `Unknown preset "${preset}". Available: ${Object.keys(PRESETS).join(", ")}`
      )
    );
    process.exit(1);
  }

  if (opts.mode && !VALID_MODES.includes(opts.mode as PermissionMode)) {
    console.error(
      chalk.red(`Invalid mode "${opts.mode}". Valid modes: ${VALID_MODES.join(", ")}`)
    );
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath(scope, projectPath);
  const template = PRESETS[preset];

  // Check if file already exists
  let exists = false;
  try {
    await stat(settingsPath);
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (exists && !opts.yes) {
    console.log(chalk.yellow(`Settings file already exists: ${collapseHome(settingsPath)}`));
    console.log(chalk.gray("Use --yes to overwrite, or choose a different --scope."));
    process.exit(1);
  }

  const mode = (opts.mode as PermissionMode | undefined) ?? template.mode;

  console.log(
    chalk.bold(`Initializing settings [${scope}] for: ${collapseHome(projectPath)}`)
  );
  console.log(chalk.gray(`Preset: ${preset} — ${template.description}`));
  console.log(chalk.gray(`File:   ${collapseHome(settingsPath)}\n`));

  // When overwriting an existing file, clear stale rules first
  if (exists && opts.yes) {
    await clearAllRules(settingsPath);
  }

  // Apply mode
  await setMode(mode, settingsPath);
  console.log(chalk.gray(`  mode: ${mode}`));

  // Apply rules
  for (const rule of template.allow) {
    await addRule(rule, "allow", settingsPath);
    console.log(chalk.green(`  + allow: ${rule}`));
  }
  for (const rule of template.deny) {
    await addRule(rule, "deny", settingsPath);
    console.log(chalk.red(`  - deny:  ${rule}`));
  }
  for (const rule of template.ask) {
    await addRule(rule, "ask", settingsPath);
    console.log(chalk.yellow(`  ? ask:   ${rule}`));
  }

  console.log(chalk.bold.green(`\n✓ Created ${collapseHome(settingsPath)}`));
  console.log(
    chalk.gray(
      scope === "project"
        ? "Tip: commit this file to share permissions with your team."
        : scope === "local"
        ? "Tip: add .claude/settings.local.json to .gitignore."
        : ""
    )
  );
  if (mode === "bypassPermissions") {
    console.log(chalk.red.bold("\n⚠ WARNING: bypassPermissions disables ALL permission checks."));
    console.log(chalk.red("  Claude can now read, write, and execute anything without asking."));
  }
}
