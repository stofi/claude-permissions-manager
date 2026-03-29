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
  ".yarn",
  "__pycache__",
  ".cache",
  "vendor",
  ".venv",
  "venv",
  "env",           // Python venv variant
  ".svn",
  ".hg",
  "Library",       // macOS Library within home
  "Applications",
  // Build output — unlikely to contain project .claude dirs, skip for performance
  "dist",
  "build",
  "out",
  "target",        // Rust / Maven
  // Framework caches
  ".next",         // Next.js
  ".nuxt",         // Nuxt.js
  ".output",       // Nuxt 3 server output
  ".svelte-kit",   // SvelteKit
  ".astro",        // Astro
  ".turbo",        // Turborepo cache
  ".parcel-cache", // Parcel
  // Test / coverage output
  "coverage",
  ".nyc_output",
  ".pytest_cache",
  ".tox",
  // Build tool caches
  ".gradle",
]);
