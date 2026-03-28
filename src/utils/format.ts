import chalk from "chalk";
import type { ClaudeProject, PermissionMode, Warning, WarningSeverity, SettingsFile } from "../core/types.js";
import { collapseHome } from "./paths.js";

const MODE_LABELS: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "acceptEdits",
  plan: "plan",
  auto: "auto",
  dontAsk: "dontAsk",
  bypassPermissions: "bypass!",
};

const MODE_COLORS: Record<PermissionMode, (s: string) => string> = {
  default: chalk.gray,
  acceptEdits: chalk.blue,
  plan: chalk.cyan,
  auto: chalk.yellow,
  dontAsk: chalk.magenta,
  bypassPermissions: chalk.red.bold,
};

const SEVERITY_COLORS: Record<WarningSeverity, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

export function formatMode(mode: PermissionMode): string {
  const label = MODE_LABELS[mode] ?? mode;
  const colorFn = MODE_COLORS[mode] ?? chalk.white;
  return colorFn(label);
}

export function formatWarning(w: Warning): string {
  const prefix = SEVERITY_COLORS[w.severity](`[${w.severity.toUpperCase()}]`);
  return `${prefix} ${w.message}`;
}

function truncatePath(p: string, maxLen: number): string {
  if (p.length <= maxLen) return p;
  return "…" + p.slice(-(maxLen - 1));
}

export function formatProjectRow(project: ClaudeProject): string {
  const perms = project.effectivePermissions;

  // Pad raw strings first, then colorize — avoids ANSI code length counting
  const path = truncatePath(collapseHome(project.rootPath), 40).padEnd(40);
  const modeLabel = (MODE_LABELS[perms.defaultMode] ?? perms.defaultMode).padEnd(12);
  const mode = (MODE_COLORS[perms.defaultMode] ?? chalk.white)(modeLabel);
  const allowLabel = `${perms.allow.length} allow`.padEnd(9);
  const allow = chalk.green(allowLabel);
  const denyLabel = `${perms.deny.length} deny`.padEnd(7);
  const deny = perms.deny.length > 0 ? chalk.red(denyLabel) : chalk.gray(denyLabel);
  const askLabel = `${perms.ask.length} ask`.padEnd(6);
  const ask = perms.ask.length > 0 ? chalk.yellow(askLabel) : chalk.gray(askLabel);
  const warnings = perms.warnings.length > 0
    ? chalk.yellow(`⚠ ${perms.warnings.length}`)
    : "";

  return `${path} ${mode} ${allow} ${deny} ${ask} ${warnings}`;
}

export function formatProjectTable(projects: ClaudeProject[]): string {
  const header = chalk.bold(
    "Project".padEnd(40) +
    " " + "Mode".padEnd(12) +
    " " + "Allow".padEnd(9) +
    " " + "Deny".padEnd(7) +
    " " + "Ask".padEnd(6) +
    " " + "Warnings"
  );
  const divider = "─".repeat(88);
  const rows = projects.map(formatProjectRow);
  return [header, divider, ...rows].join("\n");
}

export function formatEffectivePermissions(
  project: ClaudeProject,
  globalFiles: SettingsFile[] = []
): string {
  const perms = project.effectivePermissions;
  const lines: string[] = [];

  lines.push(chalk.bold(`\n${collapseHome(project.rootPath)}`));
  lines.push(`Mode: ${formatMode(perms.defaultMode)}`);
  lines.push("");

  // Settings files — show all scopes in precedence order (local, project, user, managed)
  lines.push(chalk.bold("Settings Files:"));
  const allFiles = [...project.settingsFiles, ...globalFiles];
  for (const f of allFiles) {
    const status = !f.exists
      ? chalk.gray("✗ not present")
      : !f.readable
      ? chalk.red("✗ unreadable")
      : !f.parsed
      ? chalk.yellow(`⚠ parse error: ${f.parseError}`)
      : f.parseError
      ? chalk.yellow(`⚠ schema warning`)
      : chalk.green("✓");
    const scope = chalk.gray(`[${f.scope}]`);
    lines.push(`  ${collapseHome(f.path).padEnd(50)} ${status} ${scope}`);
  }
  lines.push("");

  if (perms.allow.length > 0) {
    lines.push(chalk.bold.green("ALLOW:"));
    for (const r of perms.allow) {
      lines.push(`  ${chalk.green(r.raw.padEnd(40))} ${chalk.gray(`[${r.scope}]`)}`);
    }
    lines.push("");
  }

  if (perms.deny.length > 0) {
    lines.push(chalk.bold.red("DENY:"));
    for (const r of perms.deny) {
      lines.push(`  ${chalk.red(r.raw.padEnd(40))} ${chalk.gray(`[${r.scope}]`)}`);
    }
    lines.push("");
  }

  if (perms.ask.length > 0) {
    lines.push(chalk.bold.yellow("ASK:"));
    for (const r of perms.ask) {
      lines.push(`  ${chalk.yellow(r.raw.padEnd(40))} ${chalk.gray(`[${r.scope}]`)}`);
    }
    lines.push("");
  }

  if (perms.mcpServers.length > 0) {
    lines.push(chalk.bold("MCP Servers:"));
    for (const s of perms.mcpServers) {
      const approval = s.approvalState === "approved"
        ? chalk.green("approved")
        : s.approvalState === "denied"
        ? chalk.red("denied")
        : chalk.yellow("pending");
      lines.push(`  ${s.name.padEnd(20)} [${s.scope}]  ${s.type ?? "stdio"}  ${approval}`);
      if (s.envVarNames && s.envVarNames.length > 0) {
        lines.push(`    ${chalk.gray(`env: ${s.envVarNames.join(", ")}`)}`);
      }
      if (s.headerNames && s.headerNames.length > 0) {
        lines.push(`    ${chalk.gray(`headers: ${s.headerNames.join(", ")}`)}`);
      }
    }
    lines.push("");
  }

  if (perms.envVarNames.length > 0) {
    lines.push(chalk.bold.blue(`ENV VARS (${perms.envVarNames.length} set):`));
    lines.push(`  ${chalk.gray(perms.envVarNames.join(", "))}`);
    lines.push("");
  }

  if (perms.additionalDirs.length > 0) {
    lines.push(chalk.bold.blue("ADDITIONAL DIRS:"));
    for (const d of perms.additionalDirs) {
      lines.push(`  ${chalk.gray(d)}`);
    }
    lines.push("");
  }

  if (perms.warnings.length > 0) {
    lines.push(chalk.bold("Warnings:"));
    for (const w of perms.warnings) {
      lines.push(`  ${formatWarning(w)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
