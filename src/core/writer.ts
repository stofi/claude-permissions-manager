import { readFile, writeFile, rename, unlink } from "fs/promises";
import { join, dirname } from "path";
import { mkdirSync } from "fs";
import { SettingsDataSchema } from "./schemas.js";
import type { SettingsData } from "./schemas.js";
import type { PermissionMode, SettingsScope } from "./types.js";
import { userSettingsPath } from "../utils/paths.js";
import { parseRule } from "./merger.js";

export type RuleList = "allow" | "deny" | "ask";

/** Resolve the target settings file path given scope and optional project path */
export function resolveSettingsPath(
  scope: SettingsScope,
  projectPath?: string
): string {
  if (scope === "user") return userSettingsPath();
  if (scope === "managed") {
    throw new Error("Cannot modify managed settings — they are system-controlled");
  }
  if (!projectPath) {
    throw new Error(`--project <path> is required for scope '${scope}'`);
  }
  const claudeDir = join(projectPath, ".claude");
  if (scope === "project") return join(claudeDir, "settings.json");
  if (scope === "local") return join(claudeDir, "settings.local.json");
  throw new Error(`Unknown scope: ${scope}`);
}

/** Read a settings file, returning empty object if it doesn't exist */
export async function readSettingsOrEmpty(path: string): Promise<SettingsData> {
  try {
    const content = await readFile(path, "utf-8");
    const json = JSON.parse(content);
    const result = SettingsDataSchema.safeParse(json);
    return result.success ? result.data : (json as SettingsData);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

/** Atomically write a settings file (write to temp, then rename) */
async function writeSettingsAtomic(path: string, data: SettingsData): Promise<void> {
  const dir = dirname(path);
  // Ensure the .claude directory exists
  mkdirSync(dir, { recursive: true });

  const tmp = path + ".tmp." + process.pid;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    await rename(tmp, path);
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

// Valid tool names: wildcard, standard PascalCase identifiers, or MCP tool references
const VALID_TOOL_NAME_RE = /^(\*|[A-Za-z][A-Za-z0-9_]*|mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_-]+)*)$/;

/** Validate a permission rule string */
export function validateRule(raw: string): { valid: boolean; error?: string } {
  if (!raw || raw.trim() === "") {
    return { valid: false, error: "Rule cannot be empty" };
  }
  // Check for obviously invalid characters in specifier
  if (/['"\\]/.test(raw)) {
    return { valid: false, error: "Rule contains invalid characters (' \" \\)" };
  }
  const parsed = parseRule(raw.trim());
  if (!parsed.tool) {
    return { valid: false, error: "Rule must start with a tool name" };
  }
  if (!VALID_TOOL_NAME_RE.test(parsed.tool)) {
    return {
      valid: false,
      error: `Invalid tool name "${parsed.tool}" — expected e.g. Bash, Read, mcp__server__tool`,
    };
  }
  return { valid: true };
}

/** Add a rule to the specified list in the target settings file */
export async function addRule(
  raw: string,
  list: RuleList,
  settingsPath: string,
  options?: { dryRun?: boolean }
): Promise<{ added: boolean; alreadyPresent: boolean; conflictsWith?: RuleList }> {
  raw = raw.trim();
  const validation = validateRule(raw);
  if (!validation.valid) {
    throw new Error(`Invalid rule "${raw}": ${validation.error}`);
  }

  const data = await readSettingsOrEmpty(settingsPath);
  const perms = data.permissions ?? {};
  // Guard against corrupt files where a list field may not be an array
  const existing = Array.isArray(perms[list]) ? perms[list] : [];

  if (existing.includes(raw)) {
    return { added: false, alreadyPresent: true };
  }

  // Check if rule exists in opposing list (deny wins over allow/ask)
  const opposingLists: RuleList[] = (["allow", "deny", "ask"] as RuleList[]).filter((l) => l !== list);
  const conflictsWith = opposingLists.find((l) => (Array.isArray(perms[l]) ? perms[l] : []).includes(raw));

  if (options?.dryRun) {
    return { added: true, alreadyPresent: false, conflictsWith };
  }

  const updated: SettingsData = {
    ...data,
    permissions: {
      ...perms,
      [list]: [...existing, raw],
    },
  };

  await writeSettingsAtomic(settingsPath, updated);
  return { added: true, alreadyPresent: false, conflictsWith };
}

/** Remove a rule from all lists in the target settings file */
export async function removeRule(
  raw: string,
  settingsPath: string,
  listFilter?: RuleList
): Promise<{ removed: boolean; removedFrom: RuleList[] }> {
  raw = raw.trim();
  const data = await readSettingsOrEmpty(settingsPath);
  const perms = data.permissions ?? {};

  const lists: RuleList[] = listFilter ? [listFilter] : ["allow", "deny", "ask"];
  const removedFrom: RuleList[] = [];

  const newPerms = { ...perms };
  for (const list of lists) {
    const existing = Array.isArray(perms[list]) ? perms[list] : [];
    if (existing.includes(raw)) {
      newPerms[list] = existing.filter((r) => r !== raw);
      removedFrom.push(list);
    }
  }

  if (removedFrom.length === 0) {
    return { removed: false, removedFrom: [] };
  }

  await writeSettingsAtomic(settingsPath, { ...data, permissions: newPerms });
  return { removed: true, removedFrom };
}

/** Set the defaultMode in the target settings file */
export async function setMode(
  mode: PermissionMode,
  settingsPath: string
): Promise<void> {
  const data = await readSettingsOrEmpty(settingsPath);
  const updated: SettingsData = {
    ...data,
    permissions: {
      ...data.permissions,
      defaultMode: mode,
    },
  };
  await writeSettingsAtomic(settingsPath, updated);
}

/** Clear all permission rules from the target settings file */
export async function clearAllRules(settingsPath: string): Promise<void> {
  const data = await readSettingsOrEmpty(settingsPath);
  const updated: SettingsData = {
    ...data,
    permissions: {
      ...data.permissions,
      allow: [],
      deny: [],
      ask: [],
    },
  };
  await writeSettingsAtomic(settingsPath, updated);
}
