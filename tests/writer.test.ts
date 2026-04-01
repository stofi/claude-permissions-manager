import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  addRule,
  removeRule,
  setMode,
  clearAllRules,
  validateRule,
  resolveSettingsPath,
} from "../src/core/writer.js";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

let tmpDir: string;

function settingsPath() {
  return join(tmpDir, ".claude", "settings.json");
}

async function readSettings() {
  const content = await readFile(settingsPath(), "utf-8");
  return JSON.parse(content);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cpm-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────
// validateRule
// ────────────────────────────────────────────────────────────

describe("validateRule", () => {
  it("accepts a bare tool name", () => {
    expect(validateRule("Read").valid).toBe(true);
  });

  it("accepts tool with specifier", () => {
    expect(validateRule("Bash(npm run *)").valid).toBe(true);
  });

  it("accepts MCP tool rule", () => {
    expect(validateRule("mcp__github__create_issue").valid).toBe(true);
  });

  it("rejects empty string", () => {
    const r = validateRule("");
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("rejects whitespace-only string", () => {
    expect(validateRule("   ").valid).toBe(false);
  });

  it("rejects rule with single quotes", () => {
    const r = validateRule("Bash('echo hi')");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid characters/i);
  });

  it("rejects rule with backslash", () => {
    expect(validateRule("Bash(foo\\bar)").valid).toBe(false);
  });

  it("accepts wildcard *", () => {
    expect(validateRule("*").valid).toBe(true);
  });

  it("rejects tool name with invalid characters", () => {
    const r = validateRule("InvalidTool!!!");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid tool name/i);
  });

  it("rejects tool name starting with a digit", () => {
    expect(validateRule("1BadTool").valid).toBe(false);
  });

  it("rejects tool name with spaces", () => {
    expect(validateRule("Bad Tool").valid).toBe(false);
  });

  it("accepts mcp__ with server name only", () => {
    expect(validateRule("mcp__github").valid).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// resolveSettingsPath
// ────────────────────────────────────────────────────────────

describe("resolveSettingsPath", () => {
  it("returns project settings path for scope=project", () => {
    const p = resolveSettingsPath("project", "/my/project");
    expect(p).toBe("/my/project/.claude/settings.json");
  });

  it("returns local settings path for scope=local", () => {
    const p = resolveSettingsPath("local", "/my/project");
    expect(p).toBe("/my/project/.claude/settings.local.json");
  });

  it("returns user settings path for scope=user", () => {
    const p = resolveSettingsPath("user");
    // Should be an absolute path ending in .claude/settings.json
    expect(p).toMatch(/\.claude[/\\]settings\.json$/);
    expect(p.startsWith("/")).toBe(true);
  });

  it("throws for managed scope", () => {
    expect(() => resolveSettingsPath("managed")).toThrow(/managed/i);
  });

  it("throws when project path missing for local scope", () => {
    expect(() => resolveSettingsPath("local")).toThrow(/required/i);
  });
});

// ────────────────────────────────────────────────────────────
// addRule
// ────────────────────────────────────────────────────────────

describe("addRule", () => {
  it("creates .claude directory and settings.json if they don't exist", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
  });

  it("adds rule to empty allow list", async () => {
    const path = settingsPath();
    const result = await addRule("Bash(npm run *)", "allow", path);
    expect(result.added).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Bash(npm run *)");
  });

  it("adds rule to deny list", async () => {
    const path = settingsPath();
    await addRule("Read(**/.env)", "deny", path);
    const data = await readSettings();
    expect(data.permissions.deny).toContain("Read(**/.env)");
  });

  it("adds rule to ask list", async () => {
    const path = settingsPath();
    await addRule("Bash(git push *)", "ask", path);
    const data = await readSettings();
    expect(data.permissions.ask).toContain("Bash(git push *)");
  });

  it("reports alreadyPresent when rule already exists", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const result = await addRule("Read", "allow", path);
    expect(result.added).toBe(false);
    expect(result.alreadyPresent).toBe(true);
    const data = await readSettings();
    expect(data.permissions.allow.filter((r: string) => r === "Read").length).toBe(1);
  });

  it("appends to existing rules without losing them", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await addRule("Bash(npm run *)", "allow", path);
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.allow).toContain("Bash(npm run *)");
    expect(data.permissions.allow).toHaveLength(2);
  });

  it("preserves existing data in the file", async () => {
    const path = settingsPath();
    await setMode("acceptEdits", path);
    await addRule("Read", "allow", path);
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("acceptEdits");
    expect(data.permissions.allow).toContain("Read");
  });

  it("throws for invalid rule", async () => {
    const path = settingsPath();
    await expect(addRule("", "allow", path)).rejects.toThrow();
  });

  it("throws for whitespace-only rule", async () => {
    const path = settingsPath();
    await expect(addRule("   ", "allow", path)).rejects.toThrow(/empty/i);
  });

  it("trims whitespace from rule before storing", async () => {
    const path = settingsPath();
    const result = await addRule("  Read  ", "allow", path);
    expect(result.added).toBe(true);
    const data = await readSettings();
    // Should be stored as "Read", not "  Read  "
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.allow).not.toContain("  Read  ");
  });

  it("handles corrupt settings file where allow is not an array (non-array guard)", async () => {
    // Write a file with allow: 42 (schema-invalid)
    const path = settingsPath();
    const { mkdir } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    const { writeFile } = await import("fs/promises");
    await writeFile(path, JSON.stringify({ permissions: { allow: 42 } }), "utf-8");

    // Should not throw TypeError — should treat corrupt list as empty and add the rule
    const result = await addRule("Read", "allow", path);
    expect(result.added).toBe(true);
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
  });

  it("handles corrupt settings file where deny is not an array (non-array guard)", async () => {
    // writer.ts:148: same Array.isArray guard covers deny and ask lists too
    const path = settingsPath();
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(path, JSON.stringify({ permissions: { deny: 42 } }), "utf-8");
    const result = await addRule("Read", "deny", path);
    expect(result.added).toBe(true);
    const data = await readSettings();
    expect(data.permissions.deny).toContain("Read");
  });

  it("handles corrupt settings file where ask is not an array (non-array guard)", async () => {
    const path = settingsPath();
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(path, JSON.stringify({ permissions: { ask: "bad" } }), "utf-8");
    const result = await addRule("Bash(git push *)", "ask", path);
    expect(result.added).toBe(true);
    const data = await readSettings();
    expect(data.permissions.ask).toContain("Bash(git push *)");
  });

  it("writes valid JSON (parseable output)", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const content = await readFile(path, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("reports no conflictsWith when no opposing rule exists", async () => {
    const path = settingsPath();
    const result = await addRule("Read", "allow", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBeUndefined();
  });

  it("reports conflictsWith=deny when allow rule is in deny list", async () => {
    const path = settingsPath();
    await addRule("Read", "deny", path);
    const result = await addRule("Read", "allow", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("deny");
  });

  it("reports conflictsWith=allow when deny rule is in allow list", async () => {
    const path = settingsPath();
    await addRule("Bash(npm run *)", "allow", path);
    const result = await addRule("Bash(npm run *)", "deny", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("allow");
  });

  it("reports conflictsWith=deny when ask rule is in deny list", async () => {
    const path = settingsPath();
    await addRule("Bash(git push *)", "deny", path);
    const result = await addRule("Bash(git push *)", "ask", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("deny");
  });

  it("reports conflictsWith=allow when ask rule is in allow list", async () => {
    const path = settingsPath();
    await addRule("Bash(git push *)", "allow", path);
    const result = await addRule("Bash(git push *)", "ask", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("allow");
  });

  it("reports conflictsWith=allow (first match) when ask rule is in both allow and deny", async () => {
    // writer.ts:113-114: opposingLists = ["allow","deny"] when adding to "ask"
    // .find() returns the first match — allow is checked before deny
    const path = settingsPath();
    await addRule("Bash(git push *)", "allow", path);
    await addRule("Bash(git push *)", "deny", path);
    const result = await addRule("Bash(git push *)", "ask", path);
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("allow");
  });

  it("dryRun=true returns added=true without writing the file", async () => {
    const path = settingsPath();
    const result = await addRule("Read", "allow", path, { dryRun: true });
    expect(result.added).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    // File must NOT have been created — nothing was written
    const { stat } = await import("fs/promises");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("dryRun=true reports conflictsWith without writing the new rule", async () => {
    const path = settingsPath();
    await addRule("Read", "deny", path);
    const result = await addRule("Read", "allow", path, { dryRun: true });
    expect(result.added).toBe(true);
    expect(result.conflictsWith).toBe("deny");
    // File must NOT contain the allow rule — only the deny rule was written
    const data = await readSettings();
    expect(data.permissions.allow ?? []).toHaveLength(0);
    expect(data.permissions.deny).toContain("Read");
  });
});

// ────────────────────────────────────────────────────────────
// removeRule
// ────────────────────────────────────────────────────────────

describe("removeRule", () => {
  it("removes a rule from the allow list", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await addRule("Bash(git *)", "allow", path);
    const result = await removeRule("Read", path);
    expect(result.removed).toBe(true);
    expect(result.removedFrom).toContain("allow");
    const data = await readSettings();
    expect(data.permissions.allow).not.toContain("Read");
    expect(data.permissions.allow).toContain("Bash(git *)");
  });

  it("removes from whichever list contains the rule", async () => {
    const path = settingsPath();
    await addRule("Read(**/.env)", "deny", path);
    const result = await removeRule("Read(**/.env)", path);
    expect(result.removedFrom).toContain("deny");
    const data = await readSettings();
    expect(data.permissions.deny).not.toContain("Read(**/.env)");
  });

  it("removes from multiple lists if rule appears in both", async () => {
    // Manually set up a file where the same rule is in allow AND deny
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await addRule("Read", "deny", path); // unusual but possible
    const result = await removeRule("Read", path);
    expect(result.removedFrom).toContain("allow");
    expect(result.removedFrom).toContain("deny");
  });

  it("returns removed=false when rule not found", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const result = await removeRule("Bash(rm -rf *)", path);
    expect(result.removed).toBe(false);
    expect(result.removedFrom).toHaveLength(0);
  });

  it("returns removed=false for nonexistent settings file", async () => {
    const result = await removeRule("Read", settingsPath());
    expect(result.removed).toBe(false);
  });

  it("trims whitespace from rule before searching", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const result = await removeRule("  Read  ", path);
    expect(result.removed).toBe(true);
    expect(result.removedFrom).toContain("allow");
    const data = await readSettings();
    expect(data.permissions.allow).not.toContain("Read");
  });

  it("dryRun=true returns removedFrom without writing", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    const result = await removeRule("Read", path, undefined, { dryRun: true });
    expect(result.removed).toBe(true);
    expect(result.removedFrom).toContain("allow");
    // File must be unchanged — rule still present
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
  });

  it("dryRun=true returns removed=false when rule not found (no write attempted)", async () => {
    const path = settingsPath();
    await addRule("Glob", "allow", path);
    const result = await removeRule("Read", path, undefined, { dryRun: true });
    expect(result.removed).toBe(false);
    expect(result.removedFrom).toHaveLength(0);
    // Glob must still be present
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Glob");
  });

  it("listFilter restricts removal to the specified list only", async () => {
    // writer.ts:143: listFilter ? [listFilter] : ["allow","deny","ask"]
    // When listFilter is provided only that list is searched — never tested before
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await addRule("Read", "deny", path); // same rule in deny too (unusual but valid)
    // Remove from allow only — deny entry must survive
    const result = await removeRule("Read", path, "allow");
    expect(result.removed).toBe(true);
    expect(result.removedFrom).toEqual(["allow"]);
    const data = await readSettings();
    expect(data.permissions.allow).not.toContain("Read");
    expect(data.permissions.deny).toContain("Read");
  });

  it("handles corrupt settings file where deny is not an array (non-array guard in removeRule)", async () => {
    // writer.ts:148: const existing = Array.isArray(perms[list]) ? perms[list] : [];
    // The only existing test for this guard uses addRule (allow list). This covers removeRule + deny.
    const path = settingsPath();
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(path, JSON.stringify({ permissions: { deny: "corrupted" } }), "utf-8");
    // removeRule should treat the corrupt deny as empty → nothing to remove, no crash
    const result = await removeRule("Bash(sudo *)", path, "deny");
    expect(result.removed).toBe(false);
    expect(result.removedFrom).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// setMode
// ────────────────────────────────────────────────────────────

describe("setMode", () => {
  it("sets defaultMode in a new file", async () => {
    const path = settingsPath();
    await setMode("acceptEdits", path);
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("overwrites existing defaultMode", async () => {
    const path = settingsPath();
    await setMode("plan", path);
    await setMode("auto", path);
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("auto");
  });

  it("preserves existing allow/deny rules", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await setMode("acceptEdits", path);
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("works on a file with no permissions object at all", async () => {
    const path = settingsPath();
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(path, JSON.stringify({ someOtherKey: true }), "utf-8");
    await setMode("plan", path);
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("plan");
    // Other fields from the file should be preserved
    expect((data as Record<string, unknown>).someOtherKey).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// clearAllRules
// ────────────────────────────────────────────────────────────

describe("clearAllRules", () => {
  it("empties all three rule lists", async () => {
    const path = settingsPath();
    await addRule("Read", "allow", path);
    await addRule("Bash(sudo *)", "deny", path);
    await addRule("Bash(git push *)", "ask", path);
    await clearAllRules(path);
    const data = await readSettings();
    expect(data.permissions.allow).toHaveLength(0);
    expect(data.permissions.deny).toHaveLength(0);
    expect(data.permissions.ask).toHaveLength(0);
  });

  it("preserves defaultMode after clearing", async () => {
    const path = settingsPath();
    await setMode("acceptEdits", path);
    await addRule("Read", "allow", path);
    await clearAllRules(path);
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("works on a file with no rules (no-op)", async () => {
    const path = settingsPath();
    await setMode("default", path);
    await expect(clearAllRules(path)).resolves.not.toThrow();
  });

  it("works on a file with no permissions object at all", async () => {
    // Write a settings.json with no permissions key
    const path = settingsPath();
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(path, JSON.stringify({ someOtherKey: true }), "utf-8");
    await clearAllRules(path);
    const data = await readSettings();
    expect(data.permissions.allow).toEqual([]);
    expect(data.permissions.deny).toEqual([]);
    expect(data.permissions.ask).toEqual([]);
  });
});
