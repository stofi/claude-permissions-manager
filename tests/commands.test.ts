/**
 * Integration tests for CLI commands: initCommand, exportCommand, listCommand, manage commands
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { initCommand } from "../src/commands/init.js";
import { exportCommand } from "../src/commands/export.js";
import { listCommand } from "../src/commands/list.js";
import { showCommand } from "../src/commands/show.js";
import { diffCommand } from "../src/commands/diff.js";
import { auditCommand } from "../src/commands/audit.js";
import {
  allowCommand,
  denyCommand,
  askCommand,
  resetRuleCommand,
  modeCommand,
  resetAllCommand,
} from "../src/commands/manage.js";
import { formatEffectivePermissions } from "../src/utils/format.js";
import type { ClaudeProject } from "../src/core/types.js";
import { completionCommand } from "../src/commands/completion.js";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

let tmpDir: string;

function settingsPath(scope: "project" | "local" = "project") {
  const file = scope === "local" ? "settings.local.json" : "settings.json";
  return join(tmpDir, ".claude", file);
}

async function readSettings(scope: "project" | "local" = "project") {
  const content = await readFile(settingsPath(scope), "utf-8");
  return JSON.parse(content);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cpm-cmd-test-"));
  // Suppress console output in tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const FIXTURES = join(new URL(".", import.meta.url).pathname, "fixtures");

// ────────────────────────────────────────────────────────────
// initCommand
// ────────────────────────────────────────────────────────────

describe("initCommand", () => {
  it("creates settings.json with safe preset defaults", async () => {
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.deny).toContain("Bash(sudo *)");
    expect(data.permissions.ask).toContain("Bash(git push *)");
    expect(data.permissions.defaultMode).toBe("default");
  });

  it("creates settings.json with node preset and acceptEdits mode", async () => {
    await initCommand({ project: tmpDir, preset: "node", scope: "project" });
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Bash(npm run *)");
    expect(data.permissions.deny).toContain("Bash(sudo *)");
    expect(data.permissions.ask).toContain("Bash(git push *)");
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("creates settings.json with strict preset — deny-only", async () => {
    await initCommand({ project: tmpDir, preset: "strict", scope: "project" });
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.deny).toContain("Bash");
    expect(data.permissions.deny).toContain("Write");
    expect(data.permissions.deny).toContain("Edit");
    expect(data.permissions.ask ?? []).toHaveLength(0);
    expect(data.permissions.defaultMode).toBe("default");
  });

  it("--mode override takes precedence over preset default mode", async () => {
    await initCommand({ project: tmpDir, preset: "safe", scope: "project", mode: "plan" });
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("plan");
  });

  it("creates settings.local.json when scope=local", async () => {
    await initCommand({ project: tmpDir, preset: "safe", scope: "local" });
    const content = await readFile(settingsPath("local"), "utf-8");
    const data = JSON.parse(content);
    expect(data.permissions.allow).toContain("Read");
  });

  it("exits 1 when file already exists and neither --yes nor --dry-run given", async () => {
    // Create file first
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(
      initCommand({ project: tmpDir, preset: "strict", scope: "project" })
    ).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("--yes overwrites existing file and applies preset fresh", async () => {
    // Create file with safe preset first
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    // Overwrite with strict preset
    await initCommand({ project: tmpDir, preset: "strict", scope: "project", yes: true });
    const data = await readSettings();
    // strict has deny: Bash — safe has allow: Bash(git status); that allow should be gone
    expect(data.permissions.allow).not.toContain("Bash(git status)");
    expect(data.permissions.deny).toContain("Bash");
  });

  it("exits 1 on invalid scope", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(initCommand({ project: tmpDir, scope: "bogus" })).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
  });

  it("exits 1 on invalid mode", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(initCommand({ project: tmpDir, mode: "invalid-mode" })).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
  });

  it("--dry-run does not create any files", async () => {
    const { existsSync } = await import("fs");
    const settingsFile = join(tmpDir, ".claude", "settings.json");
    await initCommand({ project: tmpDir, preset: "node", scope: "project", dryRun: true });
    expect(existsSync(settingsFile)).toBe(false);
  });

  it("--dry-run shows [dry-run] prefix and would-create path", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, preset: "safe", scope: "project", dryRun: true });
    const combined = logs.join("\n");
    expect(combined).toMatch(/\[dry-run\]/i);
    expect(combined).toMatch(/would create|would initialize|would/i);
  });

  it("--dry-run with existing file shows 'already exists' message", async () => {
    // Create the settings file first
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, preset: "node", scope: "project", dryRun: true });
    const combined = logs.join("\n");
    expect(combined).toMatch(/already exists/i);
  });

  it("--dry-run with --yes and existing file shows 'would overwrite' message", async () => {
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, preset: "node", scope: "project", dryRun: true, yes: true });
    const combined = logs.join("\n");
    expect(combined).toMatch(/would overwrite/i);
    // File should NOT have been changed
    const content = JSON.parse(await import("fs/promises").then(m => m.readFile(join(tmpDir, ".claude", "settings.json"), "utf-8")));
    // Original "safe" preset sets mode: default; "node" preset would set acceptEdits — verify unchanged
    expect(content.permissions?.defaultMode ?? "default").toBe("default");
  });

  it("prints bypassPermissions warning when mode=bypassPermissions", async () => {
    // init.ts:210-212: `if (mode === "bypassPermissions") { ... }` block
    // Never reached in other tests — all use default/plan/acceptEdits modes
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, scope: "project", mode: "bypassPermissions" });
    const combined = logs.join("\n");
    expect(combined).toMatch(/WARNING/i);
    expect(combined).toMatch(/bypassPermissions/i);
  });
});

// ────────────────────────────────────────────────────────────
// exportCommand — JSON format
// ────────────────────────────────────────────────────────────

describe("exportCommand — JSON", () => {
  it("produces valid JSON with expected top-level keys", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });

    const json = JSON.parse(lines.join(""));
    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("scanRoot");
    expect(json).toHaveProperty("projects");
    expect(json).toHaveProperty("globalSettings");
    expect(json).toHaveProperty("errors");
    expect(Array.isArray(json.projects)).toBe(true);
    expect(json.projects.length).toBeGreaterThan(0);
  });

  it("each project record has the required fields", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });

    const json = JSON.parse(lines.join(""));
    for (const project of json.projects) {
      expect(project).toHaveProperty("path");
      expect(project).toHaveProperty("mode");
      expect(project).toHaveProperty("allow");
      expect(project).toHaveProperty("deny");
      expect(project).toHaveProperty("ask");
      expect(project).toHaveProperty("mcpServers");
      expect(project).toHaveProperty("warningCount");
      expect(typeof project.warningCount).toBe("number");
      expect(Array.isArray(project.allow)).toBe(true);
      expect(Array.isArray(project.deny)).toBe(true);
      // isBypassDisabled, envVarNames, additionalDirs are always present
      expect(typeof project.isBypassDisabled).toBe("boolean");
      expect(Array.isArray(project.envVarNames)).toBe(true);
      expect(Array.isArray(project.additionalDirs)).toBe(true);
      // Each MCP server record has env and header name arrays
      for (const s of project.mcpServers) {
        expect(Array.isArray(s.envVarNames)).toBe(true);
        expect(Array.isArray(s.headerNames)).toBe(true);
      }
    }
  });

  it("mcpServers include command/args for stdio and url for http servers", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });

    const json = JSON.parse(lines.join(""));
    // Find the project-a record which has both stdio and http MCP servers
    const projectA = json.projects.find((p: Record<string, unknown>) =>
      String(p.path).endsWith("project-a")
    );
    expect(projectA).toBeDefined();

    const servers = projectA.mcpServers as Record<string, unknown>[];
    const github = servers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    expect(github!.command).toBe("npx");
    expect(Array.isArray(github!.args)).toBe(true);

    const filesystem = servers.find((s) => s.name === "filesystem");
    expect(filesystem).toBeDefined();
    expect(filesystem!.url).toMatch(/^https?:\/\//);
  });

  it("project settingsFiles entries have correct shape", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });
    const json = JSON.parse(lines.join(""));
    for (const project of json.projects as Record<string, unknown>[]) {
      expect(Array.isArray(project.settingsFiles)).toBe(true);
      for (const f of project.settingsFiles as Record<string, unknown>[]) {
        expect(f).toHaveProperty("path");
        expect(f).toHaveProperty("scope");
        expect(f).toHaveProperty("exists");
        expect(f).toHaveProperty("readable");
        expect(f).toHaveProperty("parsed");
        expect(typeof f.path).toBe("string");
        expect(typeof f.scope).toBe("string");
        expect(typeof f.exists).toBe("boolean");
      }
    }
  });

  it("project settingsFiles excludes global entries when includeGlobal=false", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", includeGlobal: false });
    const json = JSON.parse(lines.join(""));
    for (const project of json.projects as Record<string, unknown>[]) {
      const files = project.settingsFiles as Record<string, unknown>[];
      const globalEntries = files.filter((f) => f.scope === "user" || f.scope === "managed");
      expect(globalEntries).toHaveLength(0);
    }
  });

  it("claudeMdFiles entries are objects with path/scope/exists fields", async () => {
    // Create a project with a real CLAUDE.md file so claudeMdFiles is non-empty
    const claudeDir = join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const { writeFile } = await import("fs/promises");
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({ permissions: {} }), "utf-8");
    await writeFile(join(tmpDir, "CLAUDE.md"), "# My project\nSome instructions.", "utf-8");

    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: tmpDir, maxDepth: 1, format: "json" });
    const json = JSON.parse(lines.join(""));
    const project = json.projects[0] as Record<string, unknown>;
    expect(project).toBeDefined();
    expect(Array.isArray(project.claudeMdFiles)).toBe(true);
    const files = project.claudeMdFiles as Record<string, unknown>[];
    // At least the CLAUDE.md we created should appear
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(typeof f.path).toBe("string");
      expect(typeof f.scope).toBe("string");
      expect(typeof f.exists).toBe("boolean");
      // claudeMdFiles entries must NOT be plain strings
      expect(typeof f).toBe("object");
    }
    // Verify the existing CLAUDE.md is detected with all fields including lineCount
    const rootMd = files.find((f) => String(f.path).endsWith("CLAUDE.md") && f.exists === true);
    expect(rootMd).toBeDefined();
    expect(typeof rootMd!.lineCount).toBe("number");
    expect((rootMd!.lineCount as number)).toBeGreaterThan(0);
  });

  it("project records include warningCount as a number", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });
    const json = JSON.parse(lines.join(""));
    for (const project of json.projects as Record<string, unknown>[]) {
      expect(project).toHaveProperty("warningCount");
      expect(typeof project.warningCount).toBe("number");
    }
  });

  it("globalSettings.userMcpServers include scope field", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });
    const json = JSON.parse(lines.join(""));
    for (const s of json.globalSettings.userMcpServers as Record<string, unknown>[]) {
      expect(s).toHaveProperty("scope");
      expect(typeof s.scope).toBe("string");
    }
  });
});

// ────────────────────────────────────────────────────────────
// exportCommand — CSV format
// ────────────────────────────────────────────────────────────

describe("exportCommand — CSV", () => {
  it("produces CSV with correct header row", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "csv" });

    const csv = lines.join("");
    const [header] = csv.split("\n");
    expect(header).toBe("path,mode,allow_count,deny_count,ask_count,mcp_count,warning_count,bypass_disabled");
  });

  it("produces one data row per project", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "csv" });

    const csv = lines.join("");
    const rows = csv.trim().split("\n");
    // header + N data rows
    expect(rows.length).toBeGreaterThan(1);
    // each data row has 8 comma-separated fields
    for (const row of rows.slice(1)) {
      const fields = row.split(",");
      expect(fields.length).toBeGreaterThanOrEqual(8);
    }
  });
});

// ────────────────────────────────────────────────────────────
// exportCommand — --output file
// ────────────────────────────────────────────────────────────

describe("exportCommand — --output", () => {
  it("writes JSON output to specified file", async () => {
    const outFile = join(tmpDir, "export.json");
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", output: outFile });
    const content = await readFile(outFile, "utf-8");
    const json = JSON.parse(content);
    expect(json).toHaveProperty("projects");
  });

  it("writes CSV output to specified file", async () => {
    const outFile = join(tmpDir, "export.csv");
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "csv", output: outFile });
    const content = await readFile(outFile, "utf-8");
    expect(content).toMatch(/^path,mode,allow_count/);
  });

  it("throws when output parent directory does not exist", async () => {
    const outFile = join(tmpDir, "nonexistent-subdir", "export.json");
    await expect(
      exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", output: outFile })
    ).rejects.toThrow();
  });
});

describe("exportCommand — invalid format", () => {
  it("exits 1 when unknown format is specified", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(
      exportCommand({ root: FIXTURES, maxDepth: 3, format: "yaml" })
    ).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────
// manage commands
// ────────────────────────────────────────────────────────────

describe("allowCommand", () => {
  it("adds a rule to the allow list", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
  });

  it("adds a rule to local scope", async () => {
    await allowCommand("Glob", { project: tmpDir, scope: "local" });
    const data = await readSettings("local");
    expect(data.permissions.allow).toContain("Glob");
  });

  it("reports alreadyPresent message when rule already exists", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/already in allow/i));
    const data = await readSettings();
    expect(data.permissions.allow.filter((r: string) => r === "Read")).toHaveLength(1);
  });

  it("warns on conflict when rule also exists in deny list", async () => {
    await denyCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /deny takes precedence/i.test(m))).toBe(true);
  });

  it("warns on conflict when rule also exists in ask list", async () => {
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /also in ask/i.test(m))).toBe(true);
  });

  it("rejects invalid rule and exits", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(allowCommand("", { project: tmpDir, scope: "project" })).rejects.toThrow();
    exitSpy.mockRestore();
  });

  it("rejects invalid scope and exits", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(allowCommand("Read", { project: tmpDir, scope: "bogus" })).rejects.toThrow();
    exitSpy.mockRestore();
  });
});

describe("denyCommand", () => {
  it("adds a rule to the deny list", async () => {
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions.deny).toContain("Bash(sudo *)");
  });

  it("warns when rule also exists in allow list", async () => {
    await allowCommand("Bash(npm run *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Bash(npm run *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /also exists in allow/i.test(m))).toBe(true);
  });

  it("warns when rule also exists in ask list", async () => {
    await askCommand("Bash(rm -rf *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Bash(rm -rf *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /also exists in ask/i.test(m))).toBe(true);
  });

  it("shows alreadyPresent message when rule is already in deny list", async () => {
    // manage.ts:116-119: `Rule "X" is already in deny list`
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /already in deny/i.test(m))).toBe(true);
    // File must still have exactly one entry
    const data = await readSettings();
    expect(data.permissions.deny.filter((r: string) => r === "Bash(sudo *)")).toHaveLength(1);
  });
});

describe("askCommand", () => {
  it("adds a rule to the ask list", async () => {
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions.ask).toContain("Bash(git push *)");
  });

  it("warns when rule also exists in deny list", async () => {
    await denyCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /deny takes precedence/i.test(m))).toBe(true);
  });

  it("warns when rule also exists in allow list", async () => {
    await allowCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /also in allow/i.test(m))).toBe(true);
  });

  it("shows alreadyPresent message when rule is already in ask list", async () => {
    // manage.ts:150-153: `Rule "X" is already in ask list`
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /already in ask/i.test(m))).toBe(true);
    const data = await readSettings();
    expect(data.permissions.ask.filter((r: string) => r === "Bash(git push *)")).toHaveLength(1);
  });
});

describe("resetRuleCommand", () => {
  it("removes a rule from the allow list", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await resetRuleCommand("Read", { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions.allow).not.toContain("Read");
  });

  it("prints not-found message when rule is absent", async () => {
    // Create the file so it exists but has no rules
    await allowCommand("Glob", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetRuleCommand("Read", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /not found/i.test(m))).toBe(true);
  });

  it("--dry-run does not remove the rule and reports what would be removed", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetRuleCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    // File must be unchanged
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Read");
    // Output must mention dry-run and the would-remove message
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /would remove/i.test(m))).toBe(true);
  });

  it("--dry-run reports not-found when rule is absent", async () => {
    await allowCommand("Glob", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetRuleCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    // File unchanged — Glob still present
    const data = await readSettings();
    expect(data.permissions.allow).toContain("Glob");
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /not found/i.test(m))).toBe(true);
  });

  it("shows success message with rule and list name when rule is removed", async () => {
    // manage.ts:191-195: `✓ Removed "${rule}" from: ${result.removedFrom.join(", ")}`
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetRuleCommand("Read", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Removed.*Read.*from/i.test(m))).toBe(true);
    expect(calls.some((m) => /allow/i.test(m))).toBe(true);
  });
});

describe("modeCommand", () => {
  it("sets defaultMode in settings file", async () => {
    await modeCommand("acceptEdits", { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("prints a warning for bypassPermissions mode", async () => {
    const logSpy = vi.spyOn(console, "log");
    await modeCommand("bypassPermissions", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /bypassPermissions/i.test(m) && /WARNING/i.test(m))).toBe(true);
  });

  it("rejects invalid mode and exits", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(modeCommand("invalidMode", { project: tmpDir, scope: "project" })).rejects.toThrow();
    exitSpy.mockRestore();
  });

  it("warns about all-project impact when setting bypassPermissions at user scope", async () => {
    const logSpy = vi.spyOn(console, "log");
    await modeCommand("bypassPermissions", { project: tmpDir, scope: "user" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /user scope/i.test(m) && /ALL/i.test(m))).toBe(true);
  });
});

describe("--dry-run flag", () => {
  it("allowCommand --dry-run does not write to file", async () => {
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    // File should not be created
    await expect(readFile(settingsPath(), "utf-8")).rejects.toThrow();
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
  });

  it("allowCommand --dry-run shows 'already present' when rule exists", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" }); // write it first
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /already/i.test(m))).toBe(true);
    // File should still have exactly one rule
    const data = await readSettings();
    expect(data.permissions.allow).toHaveLength(1);
  });

  it("denyCommand --dry-run does not write to file", async () => {
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project", dryRun: true });
    await expect(readFile(settingsPath(), "utf-8")).rejects.toThrow();
  });

  it("denyCommand --dry-run shows conflict when rule exists in allow list", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /also in allow/i.test(m))).toBe(true);
  });

  it("denyCommand --dry-run shows conflict when rule exists in ask list", async () => {
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Bash(git push *)", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /also in ask/i.test(m))).toBe(true);
  });

  it("askCommand --dry-run does not write to file", async () => {
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project", dryRun: true });
    await expect(readFile(settingsPath(), "utf-8")).rejects.toThrow();
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
  });

  it("askCommand --dry-run shows 'already present' when rule exists", async () => {
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" }); // write it first
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /already/i.test(m))).toBe(true);
    // File should still have exactly one ask rule
    const data = await readSettings();
    expect(data.permissions.ask).toHaveLength(1);
  });

  it("askCommand --dry-run shows conflict when rule exists in deny list", async () => {
    await denyCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /deny takes precedence/i.test(m))).toBe(true);
  });

  it("askCommand --dry-run shows conflict when rule exists in allow list", async () => {
    await allowCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /also in allow/i.test(m))).toBe(true);
  });

  it("modeCommand --dry-run shows transition and does not write", async () => {
    const logSpy = vi.spyOn(console, "log");
    await modeCommand("acceptEdits", { project: tmpDir, scope: "project", dryRun: true });
    await expect(readFile(settingsPath(), "utf-8")).rejects.toThrow();
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /acceptEdits/.test(m))).toBe(true);
  });

  it("modeCommand --dry-run shows current → new mode transition", async () => {
    // Set a mode first
    await modeCommand("plan", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await modeCommand("auto", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /plan/.test(m) && /auto/.test(m))).toBe(true);
    // File should still have "plan"
    const data = await readSettings();
    expect(data.permissions.defaultMode).toBe("plan");
  });
});

describe("resetAllCommand", () => {
  it("requires --yes flag and exits 1 without it", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(resetAllCommand({ project: tmpDir, scope: "project" })).rejects.toThrow();
    exitSpy.mockRestore();
  });

  it("clears all rules when --yes is provided", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    await resetAllCommand({ project: tmpDir, scope: "project", yes: true });
    const data = await readSettings();
    expect(data.permissions.allow).toHaveLength(0);
    expect(data.permissions.deny).toHaveLength(0);
  });

  it("--dry-run does not modify files and reports rule counts", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await resetAllCommand({ project: tmpDir, scope: "project", dryRun: true });
    // File must be unchanged
    const data = await readSettings();
    expect(data.permissions.allow).toHaveLength(1);
    expect(data.permissions.deny).toHaveLength(1);
    // Output must mention dry-run and counts
    const output = calls.join("\n");
    expect(output).toMatch(/dry.run/i);
    expect(output).toMatch(/1 allow.*1 deny/i);
  });

  it("--dry-run reports 'no rules to clear' when file has no rules", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await resetAllCommand({ project: tmpDir, scope: "project", dryRun: true });
    expect(calls.join("\n")).toMatch(/no permission rules/i);
  });

  it("clears rules on a non-existent file (creates file with empty permissions)", async () => {
    // No settings file exists yet — should not crash
    await resetAllCommand({ project: tmpDir, scope: "project", yes: true });
    const data = await readSettings();
    expect(data.permissions?.allow ?? []).toHaveLength(0);
    expect(data.permissions?.deny ?? []).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// listCommand — JSON format
// ────────────────────────────────────────────────────────────

describe("listCommand — JSON", () => {
  async function captureListJson() {
    // listCommand uses console.log (not process.stdout.write), so capture it directly
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: true });
    const text = calls.map((a) => a.join("")).join("");
    return JSON.parse(text);
  }

  it("allow/deny/ask are {rule, scope} objects", async () => {
    const json = await captureListJson();
    expect(Array.isArray(json.projects)).toBe(true);
    expect(json.projects.length).toBeGreaterThan(0);

    for (const project of json.projects) {
      expect(Array.isArray(project.allow)).toBe(true);
      expect(Array.isArray(project.deny)).toBe(true);
      expect(Array.isArray(project.ask)).toBe(true);
      for (const rule of [...project.allow, ...project.deny, ...project.ask]) {
        expect(rule).toHaveProperty("rule");
        expect(rule).toHaveProperty("scope");
        expect(typeof rule.rule).toBe("string");
        expect(typeof rule.scope).toBe("string");
      }
    }
  });

  it("mcpServers have scope, approvalState, and type (never undefined)", async () => {
    const json = await captureListJson();
    for (const project of json.projects) {
      for (const s of project.mcpServers as Record<string, unknown>[]) {
        expect(s).toHaveProperty("name");
        expect(s).toHaveProperty("scope");
        expect(s.approvalState).toBeDefined();
        expect(typeof s.approvalState).toBe("string");
        expect(s.type).toBeDefined();
        expect(typeof s.type).toBe("string");
      }
    }
  });

  it("warningCount is a number", async () => {
    const json = await captureListJson();
    for (const project of json.projects) {
      expect(typeof project.warningCount).toBe("number");
    }
  });

  it("isBypassDisabled is a boolean on every project", async () => {
    const json = await captureListJson();
    for (const project of json.projects) {
      expect(typeof project.isBypassDisabled).toBe("boolean");
    }
  });

  it("mcpServers include command/args for stdio and url for http servers", async () => {
    // Use the FIXTURES root which contains project-a with both server types
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: true });
    const text = calls.map((a) => a.join("")).join("");
    const json = JSON.parse(text);

    const projectA = json.projects.find((p: Record<string, unknown>) =>
      String(p.path).endsWith("project-a")
    );
    expect(projectA).toBeDefined();

    const servers = projectA.mcpServers as Record<string, unknown>[];
    const github = servers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    expect(github!.command).toBe("npx");
    expect(Array.isArray(github!.args)).toBe(true);

    const filesystem = servers.find((s) => s.name === "filesystem");
    expect(filesystem).toBeDefined();
    expect(filesystem!.url).toMatch(/^https?:\/\//);
  });

  it("projects include envVarNames and additionalDirs arrays", async () => {
    const json = await captureListJson();
    for (const project of json.projects) {
      expect(Array.isArray(project.envVarNames)).toBe(true);
      expect(Array.isArray(project.additionalDirs)).toBe(true);
    }
  });

  it("includeGlobal=false excludes user-scope rules from effective permissions", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: true, includeGlobal: false });
    const withoutGlobal = JSON.parse(calls.map((a) => a.join("")).join(""));

    calls.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: true, includeGlobal: true });
    const withGlobal = JSON.parse(calls.map((a) => a.join("")).join(""));

    // Both should return the same projects
    expect(withoutGlobal.projects.length).toBe(withGlobal.projects.length);
    // Without global, no project should have any user-scoped allow/deny/ask rules
    for (const project of withoutGlobal.projects) {
      const userRules = [...project.allow, ...project.deny, ...project.ask].filter(
        (r: Record<string, unknown>) => r.scope === "user" || r.scope === "managed"
      );
      expect(userRules).toHaveLength(0);
    }
  });
});

describe("listCommand — text output", () => {
  it("shows [locked] indicator for project with isBypassDisabled=true", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: false, includeGlobal: false });
    const output = calls.join("\n");
    // project-bypass-locked has disableBypassPermissionsMode set — should show [locked]
    expect(output).toMatch(/\[locked\]/);
    // format.ts:41-43: truncatePath — FIXTURES paths exceed 40 chars → truncated with "…"
    expect(output).toContain("…");
  });

  it("does not show [locked] for projects without isBypassDisabled", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-a has no disableBypassPermissionsMode
    await listCommand({ root: join(FIXTURES, "project-a"), maxDepth: 1, json: false, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).not.toMatch(/\[locked\]/);
  });

  it("shows 'No Claude projects found' banner for empty directory", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "cpm-list-empty-"));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await listCommand({ root: emptyDir, maxDepth: 1, json: false, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/No Claude projects found/i);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("shows warning count footer when projects have warnings", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-bypass has CRITICAL bypassPermissions → at least one warning
    await listCommand({ root: FIXTURES, maxDepth: 3, json: false, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toMatch(/warning.*across all projects/i);
  });

  it("shows scan errors section when scan produces errors", async () => {
    // Needs both a valid project (so list doesn't return early on "no projects found")
    // and a broken symlink (to trigger a scan error via discovery.ts:76-82)
    const { symlinkSync } = await import("fs");
    const root = mkdtempSync(join(tmpdir(), "cpm-list-scan-errs-"));
    try {
      // allowCommand creates root/proj/.claude/settings.json (the valid project)
      await allowCommand("Read", { project: join(root, "proj"), scope: "project" });
      // Broken symlink alongside the project dir triggers a scan error
      symlinkSync("/nonexistent-cpm-scan-err-target", join(root, "proj", "bad-link"));
      const calls: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
      await listCommand({ root, maxDepth: 2, json: false, includeGlobal: false });
      const output = calls.join("\n");
      // list.ts:71-76: "N error(s) during scan:" section
      expect(output).toMatch(/error.*during scan/i);
      expect(output).toContain("bad-link");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// showCommand — JSON format
// ────────────────────────────────────────────────────────────

describe("showCommand — JSON", () => {
  it("emits valid JSON with allow/deny/ask as {rule,scope} objects", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json).toHaveProperty("path");
    expect(json).toHaveProperty("effectivePermissions");
    const ep = json.effectivePermissions;
    expect(Array.isArray(ep.allow)).toBe(true);
    expect(Array.isArray(ep.deny)).toBe(true);
    expect(Array.isArray(ep.ask)).toBe(true);
    for (const rule of [...ep.allow, ...ep.deny, ...ep.ask]) {
      expect(rule).toHaveProperty("rule");
      expect(rule).toHaveProperty("scope");
      expect(typeof rule.rule).toBe("string");
      expect(typeof rule.scope).toBe("string");
    }
  });

  it("includes settingsFiles with scope info", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(Array.isArray(json.settingsFiles)).toBe(true);
    for (const f of json.settingsFiles) {
      expect(f).toHaveProperty("path");
      expect(f).toHaveProperty("scope");
    }
  });

  it("claudeMdFiles entries are objects with path/scope/exists/lineCount fields", async () => {
    // Create a temp project with a CLAUDE.md so we can assert lineCount
    const claudeDir = join(tmpDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const { writeFile } = await import("fs/promises");
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({ permissions: {} }), "utf-8");
    await writeFile(join(tmpDir, "CLAUDE.md"), "# Test\nLine two.\nLine three.", "utf-8");

    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(tmpDir, { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(Array.isArray(json.claudeMdFiles)).toBe(true);
    // At least the CLAUDE.md we created should appear
    expect(json.claudeMdFiles.length).toBeGreaterThan(0);
    for (const f of json.claudeMdFiles as Record<string, unknown>[]) {
      expect(typeof f.path).toBe("string");
      expect(typeof f.scope).toBe("string");
      expect(typeof f.exists).toBe("boolean");
    }
    // The existing file must have a lineCount
    const existingMd = (json.claudeMdFiles as Record<string, unknown>[]).find((f) => f.exists === true);
    expect(existingMd).toBeDefined();
    expect(typeof existingMd!.lineCount).toBe("number");
    expect((existingMd!.lineCount as number)).toBeGreaterThan(0);
  });

  it("mcpServers have type and approvalState defaults (never undefined/null)", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(Array.isArray(json.mcpServers)).toBe(true);
    for (const s of json.mcpServers as Record<string, unknown>[]) {
      expect(s.type).toBeDefined();
      expect(typeof s.type).toBe("string");
      expect(s.approvalState).toBeDefined();
      expect(typeof s.approvalState).toBe("string");
    }
  });

  it("isBypassDisabled is true when disableBypassPermissionsMode=disable is set", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-bypass-locked"), { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.effectivePermissions.isBypassDisabled).toBe(true);
  });

  it("mcpServers include command/args for stdio servers and url for http servers", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    const servers = json.mcpServers as Record<string, unknown>[];
    expect(servers.length).toBeGreaterThan(0);

    const github = servers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    expect(github!.command).toBe("npx");
    expect(Array.isArray(github!.args)).toBe(true);
    expect((github!.args as string[])[0]).toBe("-y");

    const filesystem = servers.find((s) => s.name === "filesystem");
    expect(filesystem).toBeDefined();
    expect(filesystem!.url).toMatch(/^https?:\/\//);
  });
});

// ────────────────────────────────────────────────────────────
// showCommand — text output
// ────────────────────────────────────────────────────────────

describe("showCommand — text output", () => {
  it("outputs project path and known rules from fixture", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await showCommand(join(FIXTURES, "project-a"), { json: false });
    const output = calls.join("\n");
    // Project path should appear somewhere in output
    expect(output).toContain("project-a");
    // Known allow rule from project-a fixture
    expect(output).toContain("Bash(npm run *)");
    // Known deny rule from project-a fixture
    expect(output).toContain("Read(**/.env)");
  });

  it("shows ask rules, MCP servers, env vars and warnings sections", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await showCommand(join(FIXTURES, "project-a"), { json: false, includeGlobal: false });
    const output = calls.join("\n");
    // ASK section — project-a settings.json has ask: ["Bash(git push *)"]
    expect(output).toContain("Bash(git push *)");
    // MCP Servers section — project-a has .mcp.json with github and filesystem servers
    expect(output).toMatch(/MCP Servers/i);
    expect(output).toContain("github");
    // ENV VARS section — project-a settings.json has env: {NODE_ENV: "development"}
    expect(output).toMatch(/ENV VAR/i);
    expect(output).toContain("NODE_ENV");
    // Warnings section — pending MCP servers trigger medium warnings
    expect(output).toMatch(/Warning/i);
  });

  it("shows cmd, url, and headers detail lines for MCP servers", async () => {
    // format.ts:144-148: if (s.command) → renders `cmd: <command> [args]`
    // format.ts:150-152: if (s.url)     → renders `url: <url>`
    // format.ts:156-158: if (s.headerNames && ...) → renders `headers: <name,...>`
    // project-a has github (command+args+env) and filesystem (http, url, headers) servers
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await showCommand(join(FIXTURES, "project-a"), { json: false, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toContain("cmd: npx");                         // github server command
    expect(output).toContain("url: https://mcp.example.com/fs"); // filesystem server url
    expect(output).toContain("headers: Authorization");           // filesystem server headers
  });

  it("shows [bypass locked] in mode line when isBypassDisabled=true", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-bypass-locked has disableBypassPermissionsMode: "disable" → isBypassDisabled=true
    // format.ts:89: `perms.isBypassDisabled ? chalk.green("  [bypass locked]") : ""`
    await showCommand(join(FIXTURES, "project-bypass-locked"), { json: false, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toMatch(/bypass locked/i);
  });

  it("shows 'parse error' status for settings file with invalid JSON", async () => {
    // format.ts:101-102: !f.parsed → "⚠ parse error: ..." for corrupted settings.json
    // format.ts:97-98:   !f.exists → "✗ not present" for settings.local.json (never created)
    const testDir = mkdtempSync(join(tmpdir(), "cpm-show-parse-err-"));
    try {
      await mkdir(join(testDir, ".claude"), { recursive: true });
      await writeFile(join(testDir, ".claude", "settings.json"), "{ invalid json !!!");
      const calls: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
      await showCommand(testDir, { json: false, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/parse error/i);
      expect(output).toMatch(/not present/i);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("shows 'schema warning' status for settings file with schema-violating JSON", async () => {
    // format.ts:103-104: f.parseError && f.parsed → "⚠ schema warning"
    // Valid JSON that fails zod schema: allow should be string[] not "string"
    const testDir = mkdtempSync(join(tmpdir(), "cpm-show-schema-warn-"));
    try {
      await mkdir(join(testDir, ".claude"), { recursive: true });
      await writeFile(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ permissions: { allow: "not-an-array" } })
      );
      const calls: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
      await showCommand(testDir, { json: false, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/schema warning/i);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("shows CRITICAL and HIGH severity warnings via formatWarning", async () => {
    // format.ts:24-28: SEVERITY_COLORS["critical"] = chalk.red.bold, ["high"] = chalk.red
    // format.ts:37: formatWarning() is only called in formatEffectivePermissions (show text output)
    // Existing show tests use project-a (MEDIUM/LOW only) — never CRITICAL or HIGH.
    // project-bypass: defaultMode=bypassPermissions → CRITICAL, allow:["Bash"] → HIGH
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await showCommand(join(FIXTURES, "project-bypass"), { json: false, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toMatch(/\[CRITICAL\]/);
    expect(output).toMatch(/\[HIGH\]/);
  });

  it("shows ADDITIONAL DIRS section when project has additionalDirectories", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cpm-show-addl-dirs-"));
    const claudeDir = join(testDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        additionalDirectories: ["/tmp/extra-dir"],
        permissions: {},
      }))
    );
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      // format.ts:169-175: additionalDirs section only shown when non-empty
      await showCommand(testDir, { json: false, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/ADDITIONAL DIRS/i);
      expect(output).toContain("/tmp/extra-dir");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// diffCommand — JSON format
// ────────────────────────────────────────────────────────────

describe("diffCommand — JSON", () => {
  it("emits valid JSON with onlyInA/B as {rule,scope} objects", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json).toHaveProperty("projectA");
    expect(json).toHaveProperty("projectB");
    expect(json).toHaveProperty("identical");
    expect(typeof json.identical).toBe("boolean");

    for (const list of ["allow", "deny", "ask"]) {
      expect(json[list]).toHaveProperty("onlyInA");
      expect(json[list]).toHaveProperty("onlyInB");
      expect(json[list]).toHaveProperty("inBoth");
      for (const rule of [...json[list].onlyInA, ...json[list].onlyInB]) {
        expect(rule).toHaveProperty("rule");
        expect(rule).toHaveProperty("scope");
      }
      // inBoth is plain strings
      for (const rule of json[list].inBoth) {
        expect(typeof rule).toBe("string");
      }
    }
  });

  it("identical is false when projects differ", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.identical).toBe(false);
  });

  it("mcpServers onlyInA/B are full objects with command/args/url (not plain strings)", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    // project-a has MCP servers; project-b has none — so onlyInA should be non-empty objects
    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.mcpServers).toHaveProperty("onlyInA");
    expect(json.mcpServers).toHaveProperty("onlyInB");
    expect(json.mcpServers).toHaveProperty("inBoth");
    // onlyInA should contain full objects, not strings
    expect(json.mcpServers.onlyInA.length).toBeGreaterThan(0);
    for (const s of json.mcpServers.onlyInA as Record<string, unknown>[]) {
      expect(typeof s).toBe("object");
      expect(s).toHaveProperty("name");
      expect(s).toHaveProperty("type");
      expect(s).toHaveProperty("scope");
      expect(s).toHaveProperty("approvalState");
    }
    // inBoth is plain strings
    for (const s of json.mcpServers.inBoth as unknown[]) {
      expect(typeof s).toBe("string");
    }
  });
});

// ────────────────────────────────────────────────────────────
// Additional edge case tests
// ────────────────────────────────────────────────────────────

describe("initCommand — error cases", () => {
  it("exits 1 on unknown preset", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(initCommand({ project: tmpDir, preset: "unknown-preset" })).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
  });
});

describe("showCommand — error cases", () => {
  it("exits 1 when no .claude directory found", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(showCommand(tmpDir, {})).rejects.toThrow();
    exitSpy.mockRestore();
  });
});

describe("diffCommand — identical projects", () => {
  it("reports identical:true when comparing same project to itself", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-a"),
      { json: true }
    );

    // diff.ts emits a "Note: comparing..." warning before the JSON — find the JSON call
    const jsonStr = calls.map((a) => a.join("")).find((s) => s.trim().startsWith("{"));
    const json = JSON.parse(jsonStr ?? "{}");
    expect(json.identical).toBe(true);
    expect(json.allow.onlyInA).toHaveLength(0);
    expect(json.allow.onlyInB).toHaveLength(0);
    expect(json.mode.a).toBe(json.mode.b);
  });

  it("includes envVarNames and additionalDirs in JSON output", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json).toHaveProperty("envVarNames");
    expect(json).toHaveProperty("additionalDirs");
    expect(json.envVarNames).toHaveProperty("onlyInA");
    expect(json.envVarNames).toHaveProperty("onlyInB");
    expect(json.envVarNames).toHaveProperty("inBoth");
  });

  it("mcpServers.modified is present in JSON output", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.mcpServers).toHaveProperty("modified");
    expect(Array.isArray(json.mcpServers.modified)).toBe(true);
  });

  it("identical is false and modified is populated when same-named MCP server has different config", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-mcp-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-mcp-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // Same server name "myserver", different command
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "cmd-a", args: [] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "cmd-b", args: [] } }
      }));
      // Minimal settings so scan finds both projects
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));

      const calls: unknown[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

      await diffCommand(dirA, dirB, { json: true });

      const json = JSON.parse(calls.map((a) => a.join("")).join(""));
      expect(json.identical).toBe(false);
      expect(json.mcpServers.modified).toHaveLength(1);
      expect(json.mcpServers.modified[0].name).toBe("myserver");
      expect(json.mcpServers.modified[0].a.command).toBe("cmd-a");
      expect(json.mcpServers.modified[0].b.command).toBe("cmd-b");
      // onlyInA and onlyInB should be empty (server exists in both)
      expect(json.mcpServers.onlyInA).toHaveLength(0);
      expect(json.mcpServers.onlyInB).toHaveLength(0);
      // inBoth should be empty (it's modified, not identical)
      expect(json.mcpServers.inBoth).toHaveLength(0);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// diffCommand — text output
// ────────────────────────────────────────────────────────────

describe("diffCommand — text output", () => {
  it("shows + and - indicators for rules that differ between projects", async () => {
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      {}
    );

    const output = calls.map((a) => a.join("")).join("\n");
    // project-a has allow rules that project-b doesn't — should show as "only in A"
    expect(output).toMatch(/ALLOW/);
    expect(output).toMatch(/-.*only in A/);
  });

  it("shows identical banner when both projects are the same", async () => {
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-a"),
      {}
    );

    const output = calls.map((a) => a.join("")).join("\n");
    expect(output).toMatch(/identical effective permissions/);
  });

  it("shows '(same)' for mode/bypass and '= name' for unchanged MCP servers", async () => {
    // diff.ts:169: p1.defaultMode === p2.defaultMode → "Mode:  default (same)"
    // diff.ts:178-179: p1.isBypassDisabled === p2.isBypassDisabled → "Bypass lock:  not locked (same)"
    // diff.ts:267: !mcpServerChanged(sA, sB) → "  = github" for identical server in both
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
    await diffCommand(join(FIXTURES, "project-a"), join(FIXTURES, "project-a"), { includeGlobal: false });
    const output = calls.map((a) => a.join("")).join("\n");
    expect(output).toMatch(/Mode:.*\(same\)/);
    expect(output).toMatch(/Bypass lock:.*\(same\)/);
    expect(output).toContain("= github");  // unchanged MCP server in both
  });

  it("shows ~ indicator in text output for modified same-named MCP server", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-txt-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-txt-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "cmd-a", args: [] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "cmd-b", args: [] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));

      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

      await diffCommand(dirA, dirB, {});

      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/~.*myserver.*modified/);
      expect(output).toMatch(/cmd:.*cmd-a.*cmd-b/);
      // Should NOT show identical banner (configs differ)
      expect(output).not.toMatch(/identical effective permissions/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows mode arrow when modes differ between projects", async () => {
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    // project-bypass has bypassPermissions; project-b has default → different modes
    await diffCommand(
      join(FIXTURES, "project-bypass"),
      join(FIXTURES, "project-b"),
      { includeGlobal: false }
    );

    const output = calls.map((a) => a.join("")).join("\n");
    // Mode line should show arrow (→) — contains both mode names, not "(same)"
    expect(output).toMatch(/Mode:/);
    expect(output).toContain("bypassPermissions");
    expect(output).toContain("default");
    // The mode line specifically should not say "(same)" — use line-level check
    const modeLine = output.split("\n").find((l) => l.includes("Mode:"));
    expect(modeLine).toBeDefined();
    expect(modeLine).not.toMatch(/\(same\)/);
  });

  it("shows bypass lock arrow when isBypassDisabled differs between projects", async () => {
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    // project-bypass-locked has isBypassDisabled=true; project-b has false
    await diffCommand(
      join(FIXTURES, "project-bypass-locked"),
      join(FIXTURES, "project-b"),
      { includeGlobal: false }
    );

    const output = calls.map((a) => a.join("")).join("\n");
    // Bypass lock line should show the arrow transition
    expect(output).toMatch(/Bypass lock:/);
    expect(output).toContain("locked");
    expect(output).toContain("not locked");
    expect(output).not.toMatch(/Bypass lock:.*\(same\)/);
  });

  it("shows env and headers change lines for modified MCP server", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-env-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-env-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // Same command, different env vars
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "run", args: [], env: { TOKEN: "x" } } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "run", args: [], env: { TOKEN: "x", EXTRA: "y" } } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));

      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

      await diffCommand(dirA, dirB, {});

      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/~.*myserver.*modified/);
      expect(output).toMatch(/env:/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows ENV VARS section when projects have different envVarNames", async () => {
    // diff.ts:232 printStringsDiff("ENV VARS", p1.envVarNames, p2.envVarNames)
    // project-a has env: {NODE_ENV: "development"} → envVarNames: ["NODE_ENV"]
    // project-b has no env field → envVarNames: []
    // The section only renders when all.size > 0 — verified by asserting it appears
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { includeGlobal: false }
    );

    const output = calls.map((a) => a.join("")).join("\n");
    expect(output).toMatch(/ENV VARS/);
    expect(output).toContain("NODE_ENV");
  });

  it("shows ADDITIONAL DIRS section when one project has additionalDirs", async () => {
    // diff.ts:233 printStringsDiff("ADDITIONAL DIRS", ...) — no fixture has additionalDirs
    // so this branch (all.size > 0 path) is otherwise completely untested
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-dirs-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-dirs-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({
        additionalDirectories: ["/tmp/extra"],
        permissions: {},
      }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));

      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

      await diffCommand(dirA, dirB, { includeGlobal: false });

      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/ADDITIONAL DIRS/);
      expect(output).toContain("/tmp/extra");
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows = indicator for shared env vars and + indicator for env vars only in B", async () => {
    // diff.ts:221: setA.has(v) && setB.has(v) → "= v" (gray) — never tested
    // diff.ts:226-227: else (only in B) → "+ v" (green) — never tested
    // diff.ts:272: MCP "+" (only in B) — never tested (all existing tests have MCP only in A)
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-shared-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-shared-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // A: SHARED_VAR + A_ONLY_VAR; B: SHARED_VAR + B_ONLY_VAR
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        env: { SHARED_VAR: "x", A_ONLY_VAR: "y" },
      }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        env: { SHARED_VAR: "x", B_ONLY_VAR: "z" },
      }));
      // B has an MCP server A doesn't — tests "only in B" display (diff.ts:272)
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { "b-only-server": { command: "run" } },
      }));

      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

      await diffCommand(dirA, dirB, { includeGlobal: false });

      const output = calls.map((a) => a.join("")).join("\n");
      // "= v" branch: SHARED_VAR appears in both
      expect(output).toMatch(/=.*SHARED_VAR/);
      // "only in B" branch for env vars: B_ONLY_VAR
      expect(output).toMatch(/\+.*B_ONLY_VAR.*only in B/);
      // MCP "only in B" branch: b-only-server in B but not A
      expect(output).toMatch(/\+.*b-only-server.*only in B/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// diffCommand — error cases
// ────────────────────────────────────────────────────────────

describe("diffCommand — error cases", () => {
  it("exits 1 when first path has no .claude directory", async () => {
    // diff.ts:28-30: !proj1 → console.error + process.exit(1)
    const emptyDir = mkdtempSync(join(tmpdir(), "cpm-diff-empty-"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    try {
      await expect(
        diffCommand(emptyDir, join(FIXTURES, "project-a"), { json: false })
      ).rejects.toThrow("exit:1");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      exitSpy.mockRestore();
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand
// ────────────────────────────────────────────────────────────

describe("auditCommand", () => {
  it("outputs JSON with expected shape", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root: FIXTURES, maxDepth: 3, json: true });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("scanRoot");
    expect(typeof json.issueCount).toBe("number");
    expect(Array.isArray(json.issues)).toBe(true);
    expect(Array.isArray(json.errors)).toBe(true);
    for (const issue of json.issues) {
      expect(issue).toHaveProperty("project");
      expect(issue).toHaveProperty("severity");
      expect(issue).toHaveProperty("message");
    }
  });

  it("reports at least one issue from fixture projects", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root: FIXTURES, maxDepth: 3, json: true });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    // project-bypass has bypassPermissions mode — should produce at least one warning
    expect(json.issueCount).toBeGreaterThan(0);
  });

  it("--json + --exit-code exits 2 when critical issues found in JSON mode", async () => {
    // audit.ts:44: exitWithCode() is called in the json branch too, but all existing exitCode
    // tests use json:false. This covers the json:true + exitCode:true + critical path.
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:2"); });
    // project-bypass has bypassPermissions mode → CRITICAL warning → exit 2
    await expect(
      auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, json: true, exitCode: true })
    ).rejects.toThrow("exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    exitSpy.mockRestore();
  });

  it("--exit-code exits 2 when critical issues found", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:2"); });
    // project-bypass fixture has bypassPermissions mode → CRITICAL warning
    await expect(
      auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, exitCode: true })
    ).rejects.toThrow("exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    exitSpy.mockRestore();
  });

  it("--exit-code exits 1 when non-critical warnings found", async () => {
    // Create a project with a MEDIUM warning (bare WebFetch) but no CRITICAL
    const warnDir = mkdtempSync(join(tmpdir(), "cpm-audit-warn-"));
    const claudeDir = join(warnDir, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        permissions: { allow: ["WebFetch"] },
      }))
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:1"); });
    try {
      await expect(
        auditCommand({ root: warnDir, maxDepth: 2, exitCode: true, includeGlobal: false })
      ).rejects.toThrow("exit:1");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      rmSync(warnDir, { recursive: true, force: true });
    }
  });

  it("--exit-code exits 0 when no issues found", async () => {
    // Use an empty temp dir — no projects, no issues
    const emptyDir = mkdtempSync(join(tmpdir(), "cpm-audit-empty-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await auditCommand({ root: emptyDir, maxDepth: 1, exitCode: true });
      // Should complete without calling process.exit
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — text output
// ────────────────────────────────────────────────────────────

describe("auditCommand — text output", () => {
  it("groups issues by severity and shows project path and message", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-bypass fixture has CRITICAL bypassPermissions mode
    await auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, includeGlobal: false });
    const output = calls.join("\n");
    // Severity group header
    expect(output).toMatch(/CRITICAL/i);
    // Warning message content
    expect(output).toMatch(/bypassPermissions/);
    // Project path segment appears in output
    expect(output).toContain("project-bypass");
    // project-bypass has allow:["Bash"] — bare Bash triggers HIGH warning with rule="Bash"
    // audit.ts line 74: `if (issue.rule) console.log(`    Rule: ${issue.rule}`)`
    expect(output).toMatch(/Rule:/i);
    expect(output).toContain("Bash");
  });

  it("prints 'No issues found' banner for a clean project", async () => {
    const cleanDir = mkdtempSync(join(tmpdir(), "cpm-audit-text-clean-"));
    const claudeDir = join(cleanDir, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)"],
          deny: ["Read(**/.env)"],
          disableBypassPermissionsMode: "disable",
        },
      }))
    );
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root: cleanDir, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/No issues found/i);
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("shows scan errors in 'No issues found' path when errors present", async () => {
    // Needs a clean project (no warnings) AND a broken symlink (scan error)
    const { symlinkSync } = await import("fs");
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-clean-errs-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)"],
          deny: ["Read(**/.env)"],
          disableBypassPermissionsMode: "disable",
        },
      }))
    );
    // Broken symlink creates a scan error without adding any project warnings
    symlinkSync("/nonexistent-cpm-audit-clean-target", join(root, "bad-link"));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // audit.ts:48-55: allIssues.length === 0 branch with result.errors.length > 0
      expect(output).toMatch(/No issues found/i);
      expect(output).toMatch(/scan error/i);
      expect(output).toContain("bad-link");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows scan errors section when issues AND errors both present", async () => {
    // Needs a project WITH warnings AND a broken symlink
    const { symlinkSync } = await import("fs");
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-warn-errs-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      // allow: ["Bash"] — bare Bash triggers HIGH warning
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        permissions: { allow: ["Bash"] },
      }))
    );
    symlinkSync("/nonexistent-cpm-audit-warn-target", join(root, "bad-link2"));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // audit.ts:79-84: errors section when allIssues.length > 0 AND result.errors.length > 0
      expect(output).toMatch(/HIGH/i);
      expect(output).toMatch(/scan error/i);
      expect(output).toContain("bad-link2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// showCommand — --no-global
// ────────────────────────────────────────────────────────────

describe("showCommand — --no-global", () => {
  it("excludes user/managed scope rules from effectivePermissions when includeGlobal=false", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true, includeGlobal: false });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    const ep = json.effectivePermissions;
    const userOrManagedRules = [...ep.allow, ...ep.deny, ...ep.ask].filter(
      (r: Record<string, unknown>) => r.scope === "user" || r.scope === "managed"
    );
    expect(userOrManagedRules).toHaveLength(0);
  });

  it("settingsFiles excludes global entries when includeGlobal=false", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await showCommand(join(FIXTURES, "project-a"), { json: true, includeGlobal: false });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    const files = json.settingsFiles as Record<string, unknown>[];
    const globalEntries = files.filter((f) => f.scope === "user" || f.scope === "managed");
    expect(globalEntries).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// diffCommand — --no-global
// ────────────────────────────────────────────────────────────

describe("diffCommand — --no-global", () => {
  it("excludes user/managed scope rules from diff when includeGlobal=false", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    await diffCommand(
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
      { json: true, includeGlobal: false }
    );

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    // onlyInA/B rules should have no user/managed scope entries
    for (const list of ["allow", "deny", "ask"]) {
      for (const rule of [...json[list].onlyInA, ...json[list].onlyInB] as Record<string, unknown>[]) {
        expect(rule.scope).not.toBe("user");
        expect(rule.scope).not.toBe("managed");
      }
    }
  });
});

// ────────────────────────────────────────────────────────────
// formatEffectivePermissions — MCP approval state display
// ────────────────────────────────────────────────────────────

function makeProject(mcpServers: ClaudeProject["effectivePermissions"]["mcpServers"]): ClaudeProject {
  return {
    rootPath: "/tmp/test-proj",
    claudeDir: "/tmp/test-proj/.claude",
    settingsFiles: [],
    claudeMdFiles: [],
    effectivePermissions: {
      defaultMode: "default",
      allow: [],
      deny: [],
      ask: [],
      isBypassDisabled: false,
      mcpServers,
      envVarNames: [],
      additionalDirs: [],
      warnings: [],
    },
  };
}

describe("formatEffectivePermissions — MCP approval state display", () => {
  it("shows 'approved' text for MCP server with approvalState=approved", () => {
    // format.ts:138-139: s.approvalState === "approved" ? chalk.green("approved") — never tested
    const project = makeProject([
      { name: "my-server", scope: "local", approvalState: "approved" },
    ]);
    const output = formatEffectivePermissions(project);
    expect(output).toContain("approved");
    // Must NOT contain "denied" or "pending" for this server
    expect(output).not.toContain("denied");
    expect(output).not.toContain("pending");
  });

  it("shows 'denied' text for MCP server with approvalState=denied", () => {
    // format.ts:140-141: s.approvalState === "denied" ? chalk.red("denied") — never tested
    const project = makeProject([
      { name: "blocked-server", scope: "local", approvalState: "denied" },
    ]);
    const output = formatEffectivePermissions(project);
    expect(output).toContain("denied");
    // Must NOT contain "approved" or "pending" for this server
    expect(output).not.toContain("approved");
    expect(output).not.toContain("pending");
  });
});

// ────────────────────────────────────────────────────────────
// completionCommand
// ────────────────────────────────────────────────────────────

describe("completionCommand", () => {
  it("outputs bash completion script when shell=bash", async () => {
    // completion.ts:293-294: shell === "bash" → console.log(bashScript()) — never tested
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("bash");
    const output = lines.join("\n");
    // Bash completion uses _cpm_completions function and complete builtin
    expect(output).toContain("_cpm_completions");
    expect(output).toContain("complete -F _cpm_completions cpm");
  });

  it("outputs zsh completion script when shell=zsh", async () => {
    // completion.ts:295-296: shell === "zsh" → console.log(zshScript()) — never tested
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("zsh");
    const output = lines.join("\n");
    // Zsh completion starts with #compdef directive
    expect(output).toContain("#compdef cpm");
    expect(output).toContain("_cpm");
  });

  it("exits 1 for unknown shell", async () => {
    // completion.ts:297-299: else → console.error + process.exit(1) — never tested
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(completionCommand("fish")).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
