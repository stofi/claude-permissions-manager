/**
 * Tests for preset command: presetCommand, batchPresetCommand, listPresetsCommand
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, chmodSync } from "fs";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  listPresetsCommand,
  presetCommand,
  batchPresetCommand,
  PRESETS,
  PRESET_NAMES,
} from "../src/commands/preset.js";

// ────────────────────────────────────────────────────────────
// PRESETS constant
// ────────────────────────────────────────────────────────────

describe("PRESETS", () => {
  it("exports known preset names", () => {
    expect(PRESET_NAMES).toContain("safe");
    expect(PRESET_NAMES).toContain("readonly");
    expect(PRESET_NAMES).toContain("locked");
    expect(PRESET_NAMES).toContain("open");
    expect(PRESET_NAMES).toContain("cautious");
  });

  it("safe preset blocks Bash and writes", () => {
    const deny = PRESETS.safe.deny ?? [];
    expect(deny.some((r) => r.startsWith("Bash"))).toBe(true);
    expect(deny.some((r) => r.startsWith("Write"))).toBe(true);
  });

  it("readonly preset also blocks WebFetch and WebSearch", () => {
    const deny = PRESETS.readonly.deny ?? [];
    expect(deny.some((r) => r.startsWith("WebFetch"))).toBe(true);
    expect(deny.some((r) => r.startsWith("WebSearch"))).toBe(true);
  });

  it("locked preset enables bypassLock", () => {
    expect(PRESETS.locked.bypassLock).toBe(true);
  });

  it("open preset adds allow rules", () => {
    const allow = PRESETS.open.allow ?? [];
    expect(allow.length).toBeGreaterThan(0);
  });

  it("cautious preset sets a mode", () => {
    expect(PRESETS.cautious.mode).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// listPresetsCommand
// ────────────────────────────────────────────────────────────

describe("listPresetsCommand", () => {
  it("prints all preset names", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    listPresetsCommand();
    const out = lines.join("\n");
    for (const name of PRESET_NAMES) {
      expect(out).toMatch(name);
    }
  });
});

// ────────────────────────────────────────────────────────────
// presetCommand — single project
// ────────────────────────────────────────────────────────────

describe("presetCommand", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cpm-preset-"));
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(
      join(tmpDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: {} })
    );
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("applies safe preset — adds deny rules for Bash and writes", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await presetCommand("safe", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny).toBeDefined();
    expect(data.permissions.deny.some((r: string) => r.startsWith("Bash"))).toBe(true);
    expect(data.permissions.deny.some((r: string) => r.startsWith("Write"))).toBe(true);
    expect(lines.join("\n")).toMatch(/Applied preset "safe"/i);
  });

  it("applies locked preset — also sets bypass-lock", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await presetCommand("locked", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.disableBypassPermissionsMode).toBe("disable");
  });

  it("applies open preset — adds allow rules", async () => {
    await presetCommand("open", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.allow).toBeDefined();
    expect(data.permissions.allow.length).toBeGreaterThan(0);
  });

  it("applies cautious preset — sets mode", async () => {
    await presetCommand("cautious", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.defaultMode).toBeDefined();
  });

  it("merges with existing rules — deduplicates", async () => {
    await writeFile(
      join(tmpDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Read(*)"], deny: ["Bash(*)"] } })
    );
    await presetCommand("safe", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    // "Bash(*)" should appear only once (deduped)
    const bashCount = data.permissions.deny.filter((r: string) => r === "Bash(*)").length;
    expect(bashCount).toBe(1);
    // Existing Read(*) preserved
    expect(data.permissions.allow).toContain("Read(*)");
  });

  it("--dry-run shows preview without modifying files", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await presetCommand("safe", { project: tmpDir, scope: "project", dryRun: true });
    expect(lines.join("\n")).toMatch(/dry-run/i);
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny).toBeUndefined();
  });

  it("aborts when user declines confirmation", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await presetCommand("safe", {
      project: tmpDir, scope: "project",
      _confirmFn: async () => false,
    });
    expect(lines.join("\n")).toMatch(/Aborted/i);
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny).toBeUndefined();
  });

  it("applies when user confirms via prompt (no --yes)", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await presetCommand("safe", {
      project: tmpDir, scope: "project",
      _confirmFn: async () => true,
    });
    expect(lines.join("\n")).toMatch(/Applied preset/i);
  });

  it("exits 1 for unknown preset name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      presetCommand("nonexistent", { project: tmpDir, scope: "project" })
    ).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("exits 1 on invalid scope", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(
      presetCommand("safe", { project: tmpDir, scope: "invalid" })
    ).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
  });

  it("exits 1 on write error", async () => {
    const claudeDir = join(tmpDir, ".claude");
    chmodSync(claudeDir, 0o555);
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => { lines.push(args.join("")); });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    try {
      await expect(
        presetCommand("safe", { project: tmpDir, scope: "project", yes: true })
      ).rejects.toThrow("exit:1");
    } finally {
      chmodSync(claudeDir, 0o755);
      exitSpy.mockRestore();
    }
  });

  it("uses scope 'local' by default when no scope provided", async () => {
    // covers line 54: raw ?? "local" right side
    await presetCommand("safe", { project: tmpDir, yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.local.json"), "utf-8"));
    expect(data.permissions?.deny?.some((r: string) => r.startsWith("Bash"))).toBe(true);
  });

  it("uses process.cwd() when no project provided", async () => {
    // covers line 63: raw ? ... : process.cwd() false arm
    // We pass scope=project and no project — it will use cwd which likely has a .claude/settings.json
    // We just verify it doesn't throw (cwd may or may not have a .claude folder)
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await presetCommand("safe", { scope: "project", yes: true });
      const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(data.permissions?.deny?.some((r: string) => r.startsWith("Bash"))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("handles settings file with no permissions key", async () => {
    // covers line 72: existing.permissions ?? {} right side
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({ version: 1 }));
    await presetCommand("safe", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny?.some((r: string) => r.startsWith("Bash"))).toBe(true);
  });

  it("preserves existing ask rules when preset has no ask rules", async () => {
    // covers line 96: !updated.permissions.ask.length false arm (ask non-empty → kept)
    await writeFile(
      join(tmpDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { ask: ["WebSearch(*)"] } })
    );
    await presetCommand("safe", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.ask).toContain("WebSearch(*)");
  });

  it("removes empty rule arrays from output (clean files)", async () => {
    // 'open' preset has allow rules but no deny/ask → deny/ask should be absent (not [])
    await presetCommand("open", { project: tmpDir, scope: "project", yes: true });
    const data = JSON.parse(await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    // deny and ask should not exist (or be undefined)
    expect(data.permissions?.deny).toBeUndefined();
    expect(data.permissions?.ask).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// batchPresetCommand — preset --all
// ────────────────────────────────────────────────────────────

describe("batchPresetCommand", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-batch-preset-"));
    for (const name of ["proj-a", "proj-b", "proj-c"]) {
      const dir = join(root, name, ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "settings.json"), JSON.stringify({ permissions: {} }));
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--yes applies preset to all projects", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchPresetCommand("safe", { root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project" });
    expect(lines.join("\n")).toMatch(/Applied preset "safe" to 3 project/i);
    for (const name of ["proj-a", "proj-b", "proj-c"]) {
      const data = JSON.parse(await readFile(join(root, name, ".claude", "settings.json"), "utf-8"));
      expect(data.permissions?.deny?.some((r: string) => r.startsWith("Bash"))).toBe(true);
    }
  });

  it("--dry-run shows preview without modifying files", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchPresetCommand("safe", { root, maxDepth: 2, includeGlobal: false, dryRun: true, scope: "project" });
    expect(lines.join("\n")).toMatch(/dry-run/i);
    const data = JSON.parse(await readFile(join(root, "proj-a", ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny).toBeUndefined();
  });

  it("aborts when user declines confirmation", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchPresetCommand("safe", {
      root, maxDepth: 2, includeGlobal: false, scope: "project",
      _confirmFn: async () => false,
    });
    expect(lines.join("\n")).toMatch(/Aborted/i);
    const data = JSON.parse(await readFile(join(root, "proj-a", ".claude", "settings.json"), "utf-8"));
    expect(data.permissions?.deny).toBeUndefined();
  });

  it("applies when user confirms via prompt (no --yes)", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchPresetCommand("readonly", {
      root, maxDepth: 2, includeGlobal: false, scope: "project",
      _confirmFn: async () => true,
    });
    expect(lines.join("\n")).toMatch(/Applied preset "readonly" to 3 project/i);
  });

  it("shows 'no projects found' when root is empty", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "cpm-empty-"));
    try {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await batchPresetCommand("safe", { root: emptyRoot, maxDepth: 2, includeGlobal: false, yes: true, scope: "project" });
      expect(lines.join("\n")).toMatch(/No Claude projects found/i);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("exits 1 for unknown preset name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(
      batchPresetCommand("bogus", { root, maxDepth: 2, includeGlobal: false })
    ).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("exits 1 on invalid scope", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(
      batchPresetCommand("safe", { root, maxDepth: 2, includeGlobal: false, scope: "invalid" })
    ).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
  });

  it("reports write errors and exits 1 when a target project is not writable", async () => {
    const lockedDir = join(root, "proj-a", ".claude");
    chmodSync(lockedDir, 0o555);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    try {
      await expect(
        batchPresetCommand("safe", { root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project" })
      ).rejects.toThrow("exit:1");
      expect(lines.join("\n")).toMatch(/error/i);
    } finally {
      chmodSync(lockedDir, 0o755);
      exitSpy.mockRestore();
    }
  });

  it("applies locked preset — sets bypass-lock on all projects", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchPresetCommand("locked", { root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project" });
    for (const name of ["proj-a", "proj-b", "proj-c"]) {
      const data = JSON.parse(await readFile(join(root, name, ".claude", "settings.json"), "utf-8"));
      expect(data.permissions?.disableBypassPermissionsMode).toBe("disable");
    }
  });
});
