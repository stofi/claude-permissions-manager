import { homedir, platform } from "os";
import { join } from "path";

export function homeDir(): string {
  return homedir();
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homeDir(), p.slice(2));
  }
  return p;
}

export function collapseHome(p: string): string {
  const home = homeDir();
  if (p === home || p.startsWith(home + "/")) {
    return "~" + p.slice(home.length);
  }
  return p;
}

/** Path to ~/.claude/settings.json */
export function userSettingsPath(): string {
  return join(homeDir(), ".claude", "settings.json");
}

/** Path to ~/.claude.json (main Claude state file) */
export function claudeJsonPath(): string {
  return join(homeDir(), ".claude.json");
}

/** Platform-specific path to managed-settings.json */
export function managedSettingsPath(): string {
  const os = platform();
  if (os === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-settings.json";
  }
  if (os === "win32") {
    return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  }
  // Linux / WSL
  return "/etc/claude-code/managed-settings.json";
}

/** Platform-specific path to managed CLAUDE.md */
export function managedClaudeMdPath(): string {
  const os = platform();
  if (os === "darwin") {
    return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  }
  if (os === "win32") {
    return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  }
  return "/etc/claude-code/CLAUDE.md";
}

/** Path to managed-mcp.json */
export function managedMcpPath(): string {
  const os = platform();
  if (os === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-mcp.json";
  }
  if (os === "win32") {
    return "C:\\Program Files\\ClaudeCode\\managed-mcp.json";
  }
  return "/etc/claude-code/managed-mcp.json";
}

/** System directories to skip during scanning */
export const SKIP_DIRS = new Set([
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/tmp",
  "/var/run",
  "/snap",
]);

/** Directory names to skip when scanning */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".pnpm",
  ".npm",
  "__pycache__",
  ".cache",
  "Library",       // macOS Library within home
  "Applications",
]);
