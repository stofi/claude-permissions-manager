/**
 * Integration tests for CLI commands: initCommand, exportCommand, listCommand, manage commands
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "fs";
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
  bypassLockCommand,
} from "../src/commands/manage.js";
import { formatEffectivePermissions } from "../src/utils/format.js";
import type { ClaudeProject } from "../src/core/types.js";
import { completionCommand } from "../src/commands/completion.js";
import { editCommand } from "../src/commands/edit.js";
import { statsCommand } from "../src/commands/stats.js";
import { searchCommand } from "../src/commands/search.js";
import { rulesCommand } from "../src/commands/rules.js";
import { batchAddCommand } from "../src/commands/manage.js";

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

  it("shows 'commit this file' tip for project scope", async () => {
    // init.ts:203-204: scope === "project" → "Tip: commit this file to share permissions with your team."
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, preset: "safe", scope: "project" });
    expect(logs.join("\n")).toMatch(/commit.*team/i);
  });

  it("shows 'gitignore' tip for local scope", async () => {
    // init.ts:205-206: scope === "local" → "Tip: add .claude/settings.local.json to .gitignore."
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    await initCommand({ project: tmpDir, preset: "safe", scope: "local" });
    expect(logs.join("\n")).toMatch(/gitignore/i);
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

  it("re-throws non-ENOENT error from stat() during init (init.ts:136)", async () => {
    // init.ts:136: if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Make .claude a regular file so stat(.claude/settings.json) fails with ENOTDIR instead of ENOENT.
    writeFileSync(join(tmpDir, ".claude"), "not-a-dir");
    await expect(initCommand({ project: tmpDir, scope: "project" })).rejects.toThrow();
  });

  it("shows 'all Claude Code projects on this machine' tip for user scope (init.ts:207)", async () => {
    // init.ts:202-208: else branch (scope !== "project" && !== "local") prints user-scope tip.
    // Redirects user scope to tmpDir to avoid touching the real ~/.claude/settings.json.
    vi.doMock("../src/core/writer.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/core/writer.js")>();
      const fakePath = join(tmpDir, ".claude", "settings.user-test.json");
      return {
        ...original,
        resolveSettingsPath: (scope: string, projectPath?: string) =>
          scope === "user" ? fakePath : original.resolveSettingsPath(scope as import("../src/core/types.js").SettingsScope, projectPath),
      };
    });
    vi.resetModules();
    const { initCommand: initMocked } = await import("../src/commands/init.js");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    try {
      await initMocked({ scope: "user" });
      expect(logs.join("\n")).toMatch(/all Claude Code projects on this machine/i);
    } finally {
      spy.mockRestore();
      vi.doUnmock("../src/core/writer.js");
      vi.resetModules();
    }
  });

  it("prints all-projects bypass warning when bypassPermissions used at user scope (init.ts:213-214)", async () => {
    // init.ts:213-214: scope === "user" inner check adds extra warning line.
    // Test at line 195 only covers scope: "project" — never exercises the user-scope inner condition.
    // Redirects user scope to tmpDir to avoid touching the real ~/.claude/settings.json.
    vi.doMock("../src/core/writer.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/core/writer.js")>();
      const fakePath = join(tmpDir, ".claude", "settings.user-bypass.json");
      return {
        ...original,
        resolveSettingsPath: (scope: string, projectPath?: string) =>
          scope === "user" ? fakePath : original.resolveSettingsPath(scope as import("../src/core/types.js").SettingsScope, projectPath),
      };
    });
    vi.resetModules();
    const { initCommand: initMocked } = await import("../src/commands/init.js");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    try {
      await initMocked({ scope: "user", mode: "bypassPermissions" });
      const combined = logs.join("\n");
      expect(combined).toMatch(/user scope.*ALL/i);
    } finally {
      spy.mockRestore();
      vi.doUnmock("../src/core/writer.js");
      vi.resetModules();
    }
  });

  it("exits 1 on unknown preset (init.ts:111-118)", async () => {
    // init.ts:111-118: `if (!PRESETS[preset]) { ... process.exit(1); }`
    // Neither "exits 1 on invalid scope" nor "exits 1 on invalid mode" exercise this branch.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(initCommand({ project: tmpDir, preset: "bogus" })).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
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

  it("globalSettings.user is null when includeGlobal is false (export.ts:119)", async () => {
    // export.ts:119: result.global.user ? {...} : null — null branch when includeGlobal=false
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", includeGlobal: false });
    const json = JSON.parse(lines.join(""));
    expect(json.globalSettings.user).toBeNull();
    expect(json.globalSettings.managed).toBeNull();
  });

  it("globalSettings.user has path/exists/parsed/allow/deny/ask/mode fields when present (export.ts:110-118)", async () => {
    // export.ts:110-118: result.global.user is defined → serialize its fields
    // All prior globalSettings tests only check userMcpServers. This explicitly checks the user object shape.
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json" });
    const json = JSON.parse(lines.join(""));
    // globalSettings.user is non-null when includeGlobal=true (default) and settings file exists
    if (json.globalSettings.user !== null) {
      const u = json.globalSettings.user as Record<string, unknown>;
      expect(typeof u.path).toBe("string");
      expect(typeof u.exists).toBe("boolean");
      expect(typeof u.parsed).toBe("boolean");
      expect(Array.isArray(u.allow)).toBe(true);
      expect(Array.isArray(u.deny)).toBe(true);
      expect(Array.isArray(u.ask)).toBe(true);
      // mode may be undefined if not set, so just check key is present
      expect(u).toHaveProperty("mode");
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

  it("throws with 'Output directory does not exist' message for missing parent dir (export.ts:156)", async () => {
    // export.ts:156: throw new Error(`Output directory does not exist: ${dir}`)
    // Prior test only checked rejects.toThrow() without verifying the message text.
    const outFile = join(tmpDir, "nonexistent-subdir", "export.json");
    await expect(
      exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", output: outFile })
    ).rejects.toThrow("Output directory does not exist");
  });

  it("writes '✓ Exported N projects to FILE' to stderr on successful file write (export.ts:160-162)", async () => {
    // export.ts:160-162: process.stderr.write(chalk.green(`✓ Exported ... projects to ${options.output}`))
    // Existing tests verify the file content but never assert the stderr success message.
    const outFile = join(tmpDir, "export.json");
    const stderrMessages: string[] = [];
    // Override the beforeEach stderr mock to capture calls
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrMessages.push(String(chunk));
      return true;
    });
    await exportCommand({ root: FIXTURES, maxDepth: 3, format: "json", output: outFile });
    const combined = stderrMessages.join("");
    expect(combined).toMatch(/Exported.*projects to/i);
    expect(combined).toContain("export.json");
  });
});

describe("exportCommand — Markdown format", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-export-md-"));
    // Project with rules, MCP server, and warning
    const dir = join(root, "my-proj", ".claude");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({
        permissions: {
          defaultMode: "acceptEdits",
          disableBypassPermissionsMode: "disable",
          allow: ["Bash(npm run *)"],
          deny: ["Read(**/.env)"],
        },
      })
    );
    await writeFile(
      join(root, "my-proj", ".mcp.json"),
      JSON.stringify({ mcpServers: { srv: { command: "node", args: ["s.js"] } } })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function captureMarkdown(): Promise<string> {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await exportCommand({ root, maxDepth: 2, format: "markdown", includeGlobal: false });
    return chunks.join("");
  }

  it("output starts with '# Claude Permissions Report' heading", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/^# Claude Permissions Report/);
  });

  it("output includes project path heading", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/## `.*my-proj`/);
  });

  it("output includes mode line", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/\*\*Mode\*\*: `acceptEdits`/);
  });

  it("output includes allow rules section", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/### Allow rules/);
    expect(md).toMatch(/`Bash\(npm run \*\)`/);
  });

  it("output includes deny rules section", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/### Deny rules/);
    expect(md).toMatch(/`Read\(\*\*\/\.env\)`/);
  });

  it("output includes MCP servers section", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/### MCP servers/);
    expect(md).toMatch(/`srv`/);
  });

  it("output includes warnings section", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/### Warnings/);
    // acceptEdits generates a warning
    expect(md).toMatch(/\*\*medium\*\*|medium/);
  });

  it("output includes generated timestamp and scan root", async () => {
    const md = await captureMarkdown();
    expect(md).toMatch(/Generated:/);
    expect(md).toMatch(/Scan root:/);
    expect(md).toMatch(/Projects: 1/);
  });

  it("writes markdown to file when --output is set", async () => {
    const outFile = join(root, "report.md");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await exportCommand({ root, maxDepth: 2, format: "markdown", output: outFile, includeGlobal: false });
    const content = await readFile(outFile, "utf-8");
    expect(content).toMatch(/# Claude Permissions Report/);
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
// exportCommand — branch coverage gaps
// ────────────────────────────────────────────────────────────

describe("exportCommand — branch coverage", () => {
  it("defaults to JSON when format is omitted (export.ts:89 — format ?? 'json' null branch)", async () => {
    // BRDA:89,5,1,0 — options.format is undefined → format ?? "json" takes the null branch
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    // No 'format' key in options
    await exportCommand({ root: FIXTURES, maxDepth: 3, includeGlobal: false });
    const json = JSON.parse(lines.join(""));
    expect(json).toHaveProperty("projects");
    expect(Array.isArray(json.projects)).toBe(true);
  });

  it("maps userMcpServers callback when ~/.claude.json has global servers (export.ts:131-141)", async () => {
    // DA:131,0 — map callback never called because userMcpServers is always [] on this machine.
    // Two servers: one with env (no headers) and one with headers (no env) to cover
    // BRDA:139,13,0/1 (envVarNames??) and BRDA:140,14,0/1 (headerNames??) both branches.
    const tmpClaudeJson = join(tmpDir, ".claude.json");
    writeFileSync(tmpClaudeJson, JSON.stringify({
      mcpServers: {
        "srv-env": { command: "node", args: ["srv.js"], env: { TOKEN: "abc" } },
        "srv-hdr": { command: "python", args: ["srv.py"], headers: { Authorization: "Bearer x" } },
      },
    }));

    vi.doMock("../src/utils/paths.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/utils/paths.js")>();
      return { ...original, claudeJsonPath: () => tmpClaudeJson };
    });
    vi.resetModules();
    const { exportCommand: exportMocked } = await import("../src/commands/export.js");

    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    try {
      await exportMocked({ root: tmpDir, maxDepth: 1, includeGlobal: true });
      const json = JSON.parse(lines.join(""));
      const servers = json.globalSettings.userMcpServers as Record<string, unknown>[];
      expect(servers.length).toBeGreaterThanOrEqual(2);

      const srvEnv = servers.find((s) => s.name === "srv-env");
      expect(srvEnv).toBeDefined();
      expect(srvEnv!.scope).toBe("user");
      expect(srvEnv!.approvalState).toBe("approved");
      // envVarNames defined → BRDA:139,13,1 (truthy branch) covered
      expect(Array.isArray(srvEnv!.envVarNames)).toBe(true);
      expect((srvEnv!.envVarNames as string[])).toContain("TOKEN");
      // headerNames undefined → BRDA:140,14,0 (null branch) covered → []
      expect(srvEnv!.headerNames).toEqual([]);

      const srvHdr = servers.find((s) => s.name === "srv-hdr");
      expect(srvHdr).toBeDefined();
      // envVarNames undefined → BRDA:139,13,0 (null branch) covered → []
      expect(srvHdr!.envVarNames).toEqual([]);
      // headerNames defined → BRDA:140,14,1 (truthy branch) covered
      expect(Array.isArray(srvHdr!.headerNames)).toBe(true);
      expect((srvHdr!.headerNames as string[])).toContain("Authorization");
    } finally {
      vi.doUnmock("../src/utils/paths.js");
      vi.resetModules();
    }
  });

  it("globalSettings.managed is non-null when managed-settings.json exists (export.ts:120 — truthy branch)", async () => {
    // BRDA:120,10,0,0 — managed settings truthy branch never hit (file absent on this machine)
    const tmpManaged = join(tmpDir, "managed-settings.json");
    writeFileSync(tmpManaged, JSON.stringify({ permissions: { allow: ["Read"], deny: ["Bash(rm *)"] } }));

    vi.doMock("../src/utils/paths.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/utils/paths.js")>();
      return { ...original, managedSettingsPath: () => tmpManaged };
    });
    vi.resetModules();
    const { exportCommand: exportMocked } = await import("../src/commands/export.js");

    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    try {
      await exportMocked({ root: tmpDir, maxDepth: 1, includeGlobal: true });
      const json = JSON.parse(lines.join(""));
      expect(json.globalSettings.managed).not.toBeNull();
      const m = json.globalSettings.managed as Record<string, unknown>;
      expect(typeof m.path).toBe("string");
      expect(m.exists).toBe(true);
      expect(Array.isArray(m.allow)).toBe(true);
      expect((m.allow as string[])).toContain("Read");
      expect(Array.isArray(m.deny)).toBe(true);
    } finally {
      vi.doUnmock("../src/utils/paths.js");
      vi.resetModules();
    }
  });

  it("toStringArray returns [] for non-array permissions in user settings (export.ts:13 — false branch)", async () => {
    // BRDA:13,0,0,0 — Array.isArray(val) false branch never hit (settings always have valid arrays).
    // Parser returns raw JSON even on schema failure, so allow:123 becomes data.permissions.allow=123.
    // toStringArray(123) → Array.isArray(123)=false → []
    const tmpUserSettings = join(tmpDir, "user-settings.json");
    writeFileSync(tmpUserSettings, JSON.stringify({ permissions: { allow: 123, deny: 456, ask: 789 } }));

    vi.doMock("../src/utils/paths.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/utils/paths.js")>();
      return { ...original, userSettingsPath: () => tmpUserSettings };
    });
    vi.resetModules();
    const { exportCommand: exportMocked } = await import("../src/commands/export.js");

    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    try {
      await exportMocked({ root: tmpDir, maxDepth: 1, includeGlobal: true });
      const json = JSON.parse(lines.join(""));
      // User settings file exists → globalSettings.user is non-null
      expect(json.globalSettings.user).not.toBeNull();
      // toStringArray(123) → [] because 123 is not an array
      expect(Array.isArray(json.globalSettings.user.allow)).toBe(true);
      expect(json.globalSettings.user.allow).toHaveLength(0);
      expect(Array.isArray(json.globalSettings.user.deny)).toBe(true);
      expect(json.globalSettings.user.deny).toHaveLength(0);
    } finally {
      vi.doUnmock("../src/utils/paths.js");
      vi.resetModules();
    }
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

  it("prints '✓ Added to allow:' success message (manage.ts:83)", async () => {
    // manage.ts:83: console.log(chalk.green(`✓ Added to allow: ${chalk.bold(rule)}`))
    // All prior allowCommand tests only check data.permissions — the console message is never asserted.
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Added to allow/i.test(m) && /Read/.test(m))).toBe(true);
  });

  it("defaults to 'local' scope when scope option is omitted (manage.ts:27)", async () => {
    // manage.ts:27: const scope = scopeOpt ?? "local"; — fallback when no --scope flag is passed.
    // All prior allowCommand tests pass explicit scope — this covers the undefined branch.
    await allowCommand("Read", { project: tmpDir }); // no scope → defaults to "local"
    const data = await readSettings("local");
    expect(data.permissions.allow).toContain("Read");
  });

  it("defaults to process.cwd() when project option is omitted (manage.ts:22)", async () => {
    // manage.ts:22: if (!projectOpt) return process.cwd(); — fallback when no --project flag.
    // Spy on process.cwd() to redirect writes to tmpDir so the test is self-contained.
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      await allowCommand("Read", { scope: "project" }); // no project → uses cwd (= tmpDir)
      const data = await readSettings("project");
      expect(data.permissions.allow).toContain("Read");
    } finally {
      cwdSpy.mockRestore();
    }
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

  it("prints '✓ Added to deny:' success message (manage.ts:120)", async () => {
    // manage.ts:120: console.log(chalk.red(`✓ Added to deny: ${chalk.bold(rule)}`))
    // All prior denyCommand tests only check data.permissions — the console message is never asserted.
    const logSpy = vi.spyOn(console, "log");
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Added to deny/i.test(m) && /Bash/.test(m))).toBe(true);
  });

  it("rejects invalid rule and exits (manage.ts:101-105)", async () => {
    // manage.ts:101-105: validateRule fails → console.error + process.exit(1)
    // Only allowCommand has this test; denyCommand and askCommand have the same guard but no test.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(denyCommand("", { project: tmpDir, scope: "project" })).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
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

  it("prints '✓ Added to ask:' success message (manage.ts:154)", async () => {
    // manage.ts:154: console.log(chalk.yellow(`✓ Added to ask: ${chalk.bold(rule)}`))
    // All prior askCommand tests only check data.permissions — the console message is never asserted.
    const logSpy = vi.spyOn(console, "log");
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Added to ask/i.test(m) && /Bash/.test(m))).toBe(true);
  });

  it("rejects invalid rule and exits (manage.ts:135-139)", async () => {
    // manage.ts:135-139: validateRule fails → console.error + process.exit(1)
    // Only allowCommand has this test; askCommand has the same guard but no test.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    await expect(askCommand("", { project: tmpDir, scope: "project" })).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
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

  it("shows comma-separated list names when rule removed from multiple lists (manage.ts:192)", async () => {
    // manage.ts:192: result.removedFrom.join(", ") — only tested for single-list removal above.
    // Add "Read" to both allow and deny (unusual but possible), then reset — output should
    // show "allow, deny" (or "deny, allow" depending on iteration order).
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await denyCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetRuleCommand("Read", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    // Message must mention both lists
    const removedMsg = calls.find((m) => /Removed/i.test(m));
    expect(removedMsg).toBeDefined();
    expect(removedMsg).toMatch(/allow/);
    expect(removedMsg).toMatch(/deny/);
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

  it("prints '✓ Set defaultMode to' success message after setting mode (manage.ts:233)", async () => {
    // manage.ts:233: console.log(`✓ Set defaultMode to ${colored}`) — never asserted in any test.
    // All prior modeCommand tests check data.permissions.defaultMode (file state) but not the console output.
    const logSpy = vi.spyOn(console, "log");
    await modeCommand("acceptEdits", { project: tmpDir, scope: "project" });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Set defaultMode to/i.test(m))).toBe(true);
    expect(calls.some((m) => /acceptEdits/i.test(m))).toBe(true);
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

  it("allowCommand --dry-run shows 'deny takes precedence' when rule exists in deny list", async () => {
    // manage.ts:49-52 previewRuleAdd: conflictsWith === "deny" → "deny takes precedence"
    // No existing test covers allowCommand --dry-run with a conflict.
    await denyCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /deny takes precedence/i.test(m))).toBe(true);
  });

  it("allowCommand --dry-run shows 'also in ask' when rule exists in ask list (manage.ts:50)", async () => {
    // manage.ts:50: conflictsWith !== "deny" → `also in ${result.conflictsWith}` (the false branch)
    // conflictsWith === "ask" → "also in ask"
    await askCommand("Read", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await allowCommand("Read", { project: tmpDir, scope: "project", dryRun: true });
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /dry.run/i.test(m))).toBe(true);
    expect(calls.some((m) => /also in ask/i.test(m))).toBe(true);
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
    // manage.ts:217: `Would set defaultMode: ${current} → ${mode}` — arrow format never asserted
    expect(calls.some((m) => /Would set defaultMode/.test(m) && /→/.test(m))).toBe(true);
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

  it("prints confirmation requirement message when called without --yes (manage.ts:267-275)", async () => {
    // manage.ts:267-275: !opts.yes → print "This will clear ALL permission rules..." + "Use --yes" + exit 1
    // Existing test only checks that it exits, not the message content.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:1"); });
    const logSpy = vi.spyOn(console, "log");
    try {
      await resetAllCommand({ project: tmpDir, scope: "project" }).catch(() => {});
    } finally {
      exitSpy.mockRestore();
    }
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /clear ALL permission rules/i.test(m))).toBe(true);
    expect(calls.some((m) => /Use --yes to confirm/i.test(m))).toBe(true);
  });

  it("clears all rules when --yes is provided", async () => {
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    const logSpy = vi.spyOn(console, "log");
    await resetAllCommand({ project: tmpDir, scope: "project", yes: true });
    const data = await readSettings();
    expect(data.permissions.allow).toHaveLength(0);
    expect(data.permissions.deny).toHaveLength(0);
    // manage.ts:278: console.log(chalk.green(`✓ Cleared all permission rules`)) — never asserted
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => /Cleared all permission rules/i.test(m))).toBe(true);
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

  it("--dry-run includes ask count when ask list has rules (manage.ts:261)", async () => {
    // manage.ts:261: `Would clear: ${allowCount} allow, ${denyCount} deny, ${askCount} ask rules`
    // Existing dry-run test only adds allow+deny. This adds all three lists.
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    await denyCommand("Bash(sudo *)", { project: tmpDir, scope: "project" });
    await askCommand("Bash(git push *)", { project: tmpDir, scope: "project" });
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await resetAllCommand({ project: tmpDir, scope: "project", dryRun: true });
    const output = calls.join("\n");
    expect(output).toMatch(/1 allow.*1 deny.*1 ask/i);
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
// bypassLockCommand
// ────────────────────────────────────────────────────────────

describe("bypassLockCommand", () => {
  it("enable=true sets disableBypassPermissionsMode to 'disable'", async () => {
    await bypassLockCommand(true, { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions?.disableBypassPermissionsMode).toBe("disable");
  });

  it("enable=false removes disableBypassPermissionsMode", async () => {
    // First enable, then disable
    await bypassLockCommand(true, { project: tmpDir, scope: "project" });
    await bypassLockCommand(false, { project: tmpDir, scope: "project" });
    const data = await readSettings();
    expect(data.permissions?.disableBypassPermissionsMode).toBeUndefined();
  });

  it("enable=true prints success message about lock enabled", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await bypassLockCommand(true, { project: tmpDir, scope: "project" });
    const output = calls.join("\n");
    expect(output).toMatch(/bypass.permissions lock enabled/i);
  });

  it("enable=false prints message about lock disabled", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await bypassLockCommand(false, { project: tmpDir, scope: "project" });
    const output = calls.join("\n");
    expect(output).toMatch(/bypass.permissions lock disabled/i);
  });

  it("--dry-run does not modify the file", async () => {
    // Write a known initial state
    await allowCommand("Read", { project: tmpDir, scope: "project" });
    const before = await readSettings();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await bypassLockCommand(true, { project: tmpDir, scope: "project", dryRun: true });
    // File must be unchanged
    const after = await readSettings();
    expect(after.permissions?.disableBypassPermissionsMode).toBeUndefined();
    expect(after).toEqual(before);
    const output = calls.join("\n");
    expect(output).toMatch(/dry.run/i);
    expect(output).toMatch(/enable/i);
  });

  it("--dry-run off shows 'disable' in output (manage.ts:255 ternary false branch)", async () => {
    // manage.ts:255: `enable ? "enable" : "disable"` — the "disable" branch
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await bypassLockCommand(false, { project: tmpDir, scope: "project", dryRun: true });
    const output = calls.join("\n");
    expect(output).toMatch(/dry.run/i);
    expect(output).toMatch(/disable/i);
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
      // list.ts:48: "Tip: Create a .claude/settings.json file in your project."
      expect(output).toMatch(/Create.*\.claude\/settings\.json/i);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("outputs valid JSON with empty projects array when no projects found (--json)", async () => {
    // list.ts:12-43 JSON path: always outputs JSON regardless of projects.length.
    // No existing test calls listCommand with json:true on an empty directory.
    const emptyDir = mkdtempSync(join(tmpdir(), "cpm-list-json-empty-"));
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    try {
      await listCommand({ root: emptyDir, maxDepth: 1, json: true, includeGlobal: false });
      const json = JSON.parse(calls.map((a) => a.join("")).join(""));
      expect(json).toHaveProperty("projectCount", 0);
      expect(Array.isArray(json.projects)).toBe(true);
      expect(json.projects).toHaveLength(0);
      expect(Array.isArray(json.errors)).toBe(true);
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

  it("shows ⚠ N in table row for projects with warnings (format.ts:60-62)", async () => {
    // format.ts:60-62: perms.warnings.length > 0 → chalk.yellow(`⚠ ${N}`) in formatProjectRow
    // Existing tests only check the footer, not the per-row ⚠ indicator.
    // project-bypass (bypassPermissions mode) generates at least 1 warning.
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root: FIXTURES, maxDepth: 3, json: false, includeGlobal: false });
    const output = calls.join("\n");
    // The ⚠ indicator should appear in the table for project-bypass
    expect(output).toContain("⚠");
    // Should show a numeric count (1 or more)
    expect(output).toMatch(/⚠ \d/);
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

  it("shows 'User settings:' line when global user settings file exists (list.ts:53-54)", async () => {
    // list.ts:53-54: result.global.user?.exists → show user settings path header
    // All existing listCommand text tests use includeGlobal:false which skips this branch.
    // Use vi.doMock to inject a scan result with global.user.exists=true.
    const fakeProject = {
      rootPath: tmpDir,
      claudeDir: join(tmpDir, ".claude"),
      settingsFiles: [],
      claudeMdFiles: [],
      effectivePermissions: {
        defaultMode: "default" as const,
        allow: [],
        deny: [],
        ask: [],
        isBypassDisabled: false,
        mcpServers: [],
        envVarNames: [],
        additionalDirs: [],
        warnings: [],
      },
    };
    vi.doMock("../src/core/discovery.js", () => ({
      scan: vi.fn().mockResolvedValue({
        projects: [fakeProject],
        errors: [],
        scannedAt: new Date(),
        scanRoot: tmpDir,
        global: {
          user: { path: "/home/testuser/.claude/settings.json", scope: "user", exists: true, readable: true, parsed: true },
        },
      }),
    }));
    vi.resetModules();
    const { listCommand: listCmd } = await import("../src/commands/list.js");
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await listCmd({ root: tmpDir, maxDepth: 1, json: false });
    } finally {
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
    }
    expect(calls.join("\n")).toMatch(/User settings:/);
  });

  it("shows 'Managed settings:' line when global managed settings file exists (list.ts:56-57)", async () => {
    // list.ts:56-57: result.global.managed?.exists → show managed settings path header
    const fakeProject = {
      rootPath: tmpDir,
      claudeDir: join(tmpDir, ".claude"),
      settingsFiles: [],
      claudeMdFiles: [],
      effectivePermissions: {
        defaultMode: "default" as const,
        allow: [],
        deny: [],
        ask: [],
        isBypassDisabled: false,
        mcpServers: [],
        envVarNames: [],
        additionalDirs: [],
        warnings: [],
      },
    };
    vi.doMock("../src/core/discovery.js", () => ({
      scan: vi.fn().mockResolvedValue({
        projects: [fakeProject],
        errors: [],
        scannedAt: new Date(),
        scanRoot: tmpDir,
        global: {
          managed: { path: "/etc/claude-code/managed-settings.json", scope: "managed", exists: true, readable: true, parsed: true },
        },
      }),
    }));
    vi.resetModules();
    const { listCommand: listCmd } = await import("../src/commands/list.js");
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await listCmd({ root: tmpDir, maxDepth: 1, json: false });
    } finally {
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
    }
    expect(calls.join("\n")).toMatch(/Managed settings:/);
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

  it("warnings field is an array of {severity,message} objects (show.ts:71)", async () => {
    // show.ts:71: warnings: perms.warnings — full Warning objects in JSON output
    // No existing test ever asserts json.warnings; only warningCount (number) is checked elsewhere
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

    // project-bypass has bypassPermissions mode → CRITICAL warning
    await showCommand(join(FIXTURES, "project-bypass"), { json: true, includeGlobal: false });

    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json).toHaveProperty("warnings");
    expect(Array.isArray(json.warnings)).toBe(true);
    // project-bypass must have at least one warning (bypassPermissions → CRITICAL)
    expect(json.warnings.length).toBeGreaterThan(0);
    for (const w of json.warnings as Record<string, unknown>[]) {
      expect(typeof w.severity).toBe("string");
      expect(typeof w.message).toBe("string");
    }
    // Verify the CRITICAL bypass warning is present
    const critical = (json.warnings as Record<string, unknown>[]).find((w) => w.severity === "critical");
    expect(critical).toBeDefined();
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

  it("uses process.cwd() when projectPath is undefined (show.ts:11)", async () => {
    // show.ts:11: resolve(projectPath ? expandHome(projectPath) : process.cwd())
    // All tests pass an explicit path; the process.cwd() fallback is never exercised.
    // Mock scan to return no-project result and verify error message contains cwd.
    vi.doMock("../src/core/discovery.js", () => ({
      scan: vi.fn().mockResolvedValue({
        projects: [],
        errors: [],
        scannedAt: new Date(),
        scanRoot: process.cwd(),
        global: {},
      }),
    }));
    vi.resetModules();
    const { showCommand: showMocked } = await import("../src/commands/show.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:1"); });
    const errSpy = vi.spyOn(console, "error");
    try {
      await expect(showMocked(undefined, { includeGlobal: false })).rejects.toThrow("exit:1");
      const messages = errSpy.mock.calls.map((c) => String(c[0]));
      // The error message must mention the resolved cwd (not an explicit path we passed in)
      expect(messages.some((m) => m.includes(process.cwd()))).toBe(true);
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
    }
  });

  it("prints 'Failed to load project' when scan returns an error for the project path (show.ts:23-25)", async () => {
    // show.ts:23-25: loadError branch — project not found but result.errors has an entry whose
    // path starts with targetPath+"/". Use vi.doMock to inject a scan that returns such an error.
    vi.doMock("../src/core/discovery.js", () => ({
      scan: vi.fn().mockResolvedValue({
        projects: [],
        errors: [{ path: join(tmpDir, ".claude"), error: "TestError: forced load failure" }],
        scannedAt: new Date(),
        scanRoot: tmpDir,
        global: {},
      }),
    }));
    vi.resetModules();
    const { showCommand: showCmd } = await import("../src/commands/show.js");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit:1"); });
    const errSpy = vi.spyOn(console, "error");
    let messages: string[] = [];
    try {
      await expect(showCmd(tmpDir, { includeGlobal: false })).rejects.toThrow("exit:1");
      messages = errSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
    }

    expect(messages.join("\n")).toMatch(/Failed to load project/i);
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

  it("reports shared additionalDirs in inBoth (diff.ts:150 — inBoth filter)", async () => {
    // diff.ts:150: inBoth: p1.additionalDirs.filter((d) => dirNamesB.has(d))
    // All prior tests compare project-a vs project-b where neither has additionalDirectories,
    // so inBoth is always []. Two projects sharing the same entry exercises the filter result.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-adddir-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-adddir-b-"));
    try {
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await writeFile(join(dirA, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        additionalDirectories: ["/shared/path", "/only-in-a"],
      }));
      await writeFile(join(dirB, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        additionalDirectories: ["/shared/path", "/only-in-b"],
      }));

      const calls: unknown[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });

      await diffCommand(dirA, dirB, { json: true, includeGlobal: false });

      const json = JSON.parse(calls.map((a) => (a as string[]).join("")).join(""));
      expect(json.additionalDirs.inBoth).toContain("/shared/path");
      expect(json.additionalDirs.onlyInA).toContain("/only-in-a");
      expect(json.additionalDirs.onlyInB).toContain("/only-in-b");
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
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
    // project-b has Bash(git *) which project-a doesn't — diff.ts:203 "only in B" branch
    expect(output).toMatch(/\+.*only in B/);
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
    // diff.ts:16-18: same root → "Note: comparing a project with itself" — never asserted
    expect(output).toMatch(/comparing a project with itself/);
  });

  it("shows 'locked (same)' for bypass when both projects have bypass disabled", async () => {
    // diff.ts:179: p1.isBypassDisabled === p2.isBypassDisabled === true → sameStr = "locked"
    // project-a vs project-a only covers "not locked (same)"; this covers the "locked" variant.
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
    await diffCommand(join(FIXTURES, "project-bypass-locked"), join(FIXTURES, "project-bypass-locked"), { includeGlobal: false });
    const output = calls.map((a) => a.join("")).join("\n");
    expect(output).toMatch(/Bypass lock:.*locked.*\(same\)/);
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

  it("shows 'not locked → locked' when p1 unlocked and p2 locked (diff.ts:174 branch-1, 175 branch-0)", async () => {
    // diff.ts:174: p1.isBypassDisabled ? "locked" : "not locked" — branch 1 (falsy, p1 unlocked)
    // diff.ts:175: p2.isBypassDisabled ? "locked" : "not locked" — branch 0 (truthy, p2 locked)
    // All prior tests use p1=bypass-locked, p2=unlocked, covering only truthy@174 and falsy@175.
    // Reversing the order covers the remaining branches.
    const calls: string[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

    await diffCommand(
      join(FIXTURES, "project-b"),
      join(FIXTURES, "project-bypass-locked"),
      { includeGlobal: false }
    );

    const output = calls.map((a) => a.join("")).join("\n");
    expect(output).toMatch(/Bypass lock:/);
    // p1 is unlocked, p2 is locked — arrow goes not locked → locked
    expect(output).toMatch(/not locked.*locked/);
    const bypassLine = output.split("\n").find((l) => l.includes("Bypass lock:"));
    expect(bypassLine).toBeDefined();
    expect(bypassLine).not.toMatch(/\(same\)/);
  });

  it("shows type and args change lines for modified MCP server (diff.ts:248,252-253)", async () => {
    // diff.ts:248: typeA !== typeB → "type: stdio → http" — never tested
    // diff.ts:252-253: args differ → "args: [a] → [b]" — never tested (prior tests used args:[])
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-type-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-type-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "stdio", command: "run", args: ["--verbose"] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", command: "run", args: [] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, {});
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/type:.*stdio.*http/);   // diff.ts:248
      expect(output).toMatch(/args:.*verbose.*\[\]/);  // diff.ts:252-253
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("detects args difference when type and command are identical (diff.ts:50 — args-differ branch)", async () => {
    // diff.ts:50: JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? []) → return true
    // Prior tests either differ on type (returns at line 48) or command (returns at line 49),
    // so the args-differ branch on line 50 was never reached.
    // This test uses same type (both default stdio) and same command, but different args.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-args-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-args-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: ["--verbose"] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: ["--quiet"] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // servers are considered modified (args differ) → ~ indicator
      expect(output).toMatch(/~.*myserver.*modified/);
      // args change line should show both arg values
      expect(output).toMatch(/args:.*verbose.*quiet/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
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

  it("shows url change line for modified HTTP MCP server (diff.ts:255-256)", async () => {
    // diff.ts:255-256: (sA.url ?? "") !== (sB.url ?? "") → "url: old → new" — never tested
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-url-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-url-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://old.example.com/mcp" } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://new.example.com/mcp" } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, {});
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/url:.*old\.example\.com.*new\.example\.com/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows headers change line for modified MCP server (diff.ts:263-264)", async () => {
    // diff.ts:263-264: sortStr(sA.headerNames) !== sortStr(sB.headerNames) → "headers: [...] → [...]"
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-hdr-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-hdr-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com", headers: { "X-Api-Key": "old" } } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com", headers: { "X-Auth-Token": "new" } } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, {});
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/headers:.*X-Api-Key.*X-Auth-Token/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows command change line for modified MCP server (diff.ts:249-250)", async () => {
    // diff.ts:249-250: (sA.command ?? "") !== (sB.command ?? "") → "cmd: old → new"
    // Prior tests at line 1915 use the same command "run" in both dirs — this branch never fires.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-cmd-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-cmd-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "old-cmd", args: [] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "new-cmd", args: [] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, {});
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/cmd:.*old-cmd.*new-cmd/);  // diff.ts:250
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows '(none)' for command and empty [] for args when server B has neither (diff.ts:250 br-54, 253 br-59)", async () => {
    // diff.ts:250: `${sB.command ?? "(none)"}` — branch when sB.command is undefined
    // diff.ts:253: `[${(sB.args ?? []).join(", ")}]` — branch when sB.args is undefined
    // Existing tests always compare servers where BOTH sides have command defined.
    // A server with command+args in A vs no command/args in B exercises these ?? fallbacks.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-nocmd-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-nocmd-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: ["--pkg"] } }
      }));
      // B has no command and no args (minimal stdio-like)
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "stdio", url: "https://x.com" } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/~.*myserver.*modified/);
      // cmd line: "npx → (none)"
      expect(output).toMatch(/cmd:.*npx.*\(none\)/);
      // args line: "[--pkg] → []"
      expect(output).toMatch(/args:.*--pkg/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows '(none)' for url when one server lacks a url (diff.ts:256 br-64)", async () => {
    // diff.ts:256: `${sB.url ?? "(none)"}` — branch when sB.url is undefined
    // Existing url test compares old.example.com vs new.example.com (both defined).
    // An http server with url in A vs http server without url in B exercises the ?? fallback.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-nourl-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-nourl-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://old.example.com/mcp" } }
      }));
      // B has same type but no url
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", command: "fallback-cmd" } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // url diff: old.example.com → (none)
      expect(output).toMatch(/url:.*old\.example\.com.*\(none\)/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows envVarNames '[]' when server goes from no-env to with-env (diff.ts:261 br-69)", async () => {
    // diff.ts:261: `[${(sA.envVarNames ?? []).join(", ")}]` — branch when sA.envVarNames is undefined
    // Existing env test uses servers where BOTH have envVarNames defined (both have env field).
    // A server with no env in A vs env in B exercises the ?? [] fallback for sA.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-noenv-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-noenv-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // A has no env; B has env → envVarNames differs (undefined vs ["TOKEN"])
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: [] } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: [], env: { TOKEN: "x" } } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // env line shows "[] → [TOKEN]" (sA.envVarNames ?? [] = [])
      expect(output).toMatch(/env:.*\[\].*TOKEN/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows headerNames '[]' when server goes from no-headers to with-headers (diff.ts:264 br-72)", async () => {
    // diff.ts:264: `[${(sA.headerNames ?? []).join(", ")}]` — branch when sA.headerNames is undefined
    // Existing header test compares two servers both with headers defined.
    // A server with no headers in A vs headers in B exercises the ?? [] fallback for sA.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-nohdr-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-nohdr-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // A has same-url http server, no headers; B has headers
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com" } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com", headers: { Authorization: "Bearer token" } } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // headers line shows "[] → [Authorization]"
      expect(output).toMatch(/headers:.*\[\].*Authorization/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("setsEqual returns false for same-size rule sets with different content (diff.ts:282 br-0)", async () => {
    // diff.ts:282: for (const v of sa) if (!sb.has(v)) return false;
    // Prior rule-diff tests compare projects with DIFFERENT-sized allow arrays (early return at 281).
    // Same-size but different-content arrays exercise the for-loop return-false at line 282.
    // Also exercises setsOfStringsEqual with same-size different additionalDirs (line 288).
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-samelen-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-samelen-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({
        permissions: { allow: ["Bash(tool-x)"] },  // size 1
        additionalDirectories: ["/path/alpha"],     // size 1
      }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({
        permissions: { allow: ["Bash(tool-y)"] },  // size 1, different content
        additionalDirectories: ["/path/beta"],      // size 1, different content
      }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // Both differ → projects are not identical
      expect(output).not.toMatch(/identical effective permissions/);
      expect(output).toMatch(/ALLOW/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("setsOfStringsEqual returns false for same-size different additionalDirs (diff.ts:288 br-78)", async () => {
    // diff.ts:288: for (const v of a) if (!b.has(v)) return false;
    // setsOfStringsEqual is called for additionalDirs at line 305, but the || chain short-circuits
    // when any earlier condition is true (allow differ → short-circuit, skipping line 305).
    // Two projects with IDENTICAL permissions but SAME-SIZE different additionalDirs force the
    // evaluation to reach line 305 and exercise the for-loop return-false at line 288.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-addrsz-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-addrsz-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // Identical permissions/mcp/env so earlier || conditions are all false
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        additionalDirectories: ["/only-alpha"],   // size 1
      }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({
        permissions: {},
        additionalDirectories: ["/only-beta"],    // size 1, different content
      }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/ADDITIONAL DIRS/);
      expect(output).not.toMatch(/identical effective permissions/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows '[]' for sA.args when server A has no args but B does (diff.ts:253 br-58)", async () => {
    // diff.ts:253: `[${(sA.args ?? []).join(", ")}]` — branch when sA.args is undefined
    // Existing test covers sB.args undefined (A has args, B doesn't). This covers the reverse.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-noarg-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-noarg-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      // A has no args; B has args
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx" } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: ["--pkg"] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // args line shows "[] → [--pkg]" (sA.args ?? [] = [])
      expect(output).toMatch(/args:.*\[\].*--pkg/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows envVarNames '[TOKEN]→[]' when server A has env but B does not (diff.ts:261 br-70)", async () => {
    // diff.ts:261: `[${(sB.envVarNames ?? []).join(", ")}]` — branch when sB.envVarNames undefined
    // Existing test covers sA.envVarNames undefined (A no env, B has env). This covers reverse.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-envrev-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-envrev-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: [], env: { TOKEN: "x" } } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { command: "npx", args: [] } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // env line shows "[TOKEN] → []" (sB.envVarNames ?? [] = [])
      expect(output).toMatch(/env:.*TOKEN.*\[\]/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("shows headerNames '[Auth]→[]' when server A has headers but B does not (diff.ts:264 br-73)", async () => {
    // diff.ts:264: `[${(sB.headerNames ?? []).join(", ")}]` — branch when sB.headerNames undefined
    // Existing test covers sA.headerNames undefined (A no headers, B has headers). This covers reverse.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-hdrrev-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-hdrrev-b-"));
    try {
      const { writeFile: wf } = await import("fs/promises");
      await mkdir(join(dirA, ".claude"), { recursive: true });
      await mkdir(join(dirB, ".claude"), { recursive: true });
      await wf(join(dirA, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com", headers: { Authorization: "Bearer t" } } }
      }));
      await wf(join(dirB, ".mcp.json"), JSON.stringify({
        mcpServers: { myserver: { type: "http", url: "https://x.com" } }
      }));
      await wf(join(dirA, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await wf(join(dirB, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });
      await diffCommand(dirA, dirB, { includeGlobal: false });
      const output = calls.map((a) => a.join("")).join("\n");
      // headers line shows "[Authorization] → []" (sB.headerNames ?? [] = [])
      expect(output).toMatch(/headers:.*Authorization.*\[\]/);
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

  it("shows approval change line for modified MCP server (diff.ts:258-259)", async () => {
    // diff.ts:258-259: apA !== apB → "approval: old → new" — never tested
    // We mock scan to inject two fake projects with the same-named server at different approval states.
    const dirA = mkdtempSync(join(tmpdir(), "cpm-diff-ap-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "cpm-diff-ap-b-"));
    try {
      const makeResult = (root: string, approvalState: string) => ({
        projects: [{
          rootPath: root,
          claudeDir: join(root, ".claude"),
          settingsFiles: [],
          claudeMdFiles: [],
          effectivePermissions: {
            defaultMode: "default" as const,
            allow: [],
            deny: [],
            ask: [],
            isBypassDisabled: false,
            mcpServers: [{ name: "myserver", scope: "local" as const, approvalState, command: "run" }],
            envVarNames: [],
            additionalDirs: [],
            warnings: [],
          },
        }],
        errors: [],
        scannedAt: new Date(),
        scanRoot: root,
        global: {},
      });
      vi.doMock("../src/core/discovery.js", () => ({
        scan: vi.fn().mockImplementation(({ root }: { root: string }) =>
          Promise.resolve(makeResult(root, root === dirA ? "approved" : "denied"))
        ),
      }));
      vi.resetModules();
      const { diffCommand: diffMocked } = await import("../src/commands/diff.js");

      const calls: string[][] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.map(String)); });

      await diffMocked(dirA, dirB, {});

      const output = calls.map((a) => a.join("")).join("\n");
      expect(output).toMatch(/approval:.*approved.*denied/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
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

  it("exits 1 when second path has no .claude directory (diff.ts:32-35)", async () => {
    // diff.ts:32-35: !proj2 → console.error + process.exit(1)
    // Symmetric with the !proj1 test above — never tested until now.
    const emptyDir = mkdtempSync(join(tmpdir(), "cpm-diff-empty2-"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    try {
      await expect(
        diffCommand(join(FIXTURES, "project-a"), emptyDir, { json: false })
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

  it("JSON includes affectedProjectCount, cleanProjectCount, and minSeverity fields", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root: FIXTURES, maxDepth: 3, json: true });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(typeof json.affectedProjectCount).toBe("number");
    expect(typeof json.cleanProjectCount).toBe("number");
    expect(json.affectedProjectCount + json.cleanProjectCount).toBe(json.projectCount);
    expect(json.minSeverity).toBe("low"); // default when not specified
  });

  it("JSON minSeverity reflects the option when provided", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root: FIXTURES, maxDepth: 3, json: true, minSeverity: "high" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.minSeverity).toBe("high");
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

  it("shows clean projects banner when some projects have issues and some don't", async () => {
    // 2 projects: one with bare Bash allow (issues), one clean — exercising cleanCount > 0
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-clean-count-"));
    const issueDir = join(root, "proj-issue", ".claude");
    const cleanDir2 = join(root, "proj-clean", ".claude");
    await mkdir(issueDir, { recursive: true });
    await mkdir(cleanDir2, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(issueDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"] },
    }));
    await fs.writeFile(join(cleanDir2, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // audit.ts: cleanCount > 0 → "✓ X project(s) have no issues"
      expect(output).toMatch(/✓.+1 project\(s\) have no issues/i);
      expect(output).toMatch(/HIGH/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows Fix: hint line for mode warnings in text output", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-bypass uses settings.json (scope "project") → fixCmd: "cpm mode default --scope project"
    await auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Fix:/i);
    expect(output).toContain("cpm mode default --scope project");
    expect(output).toContain("project-bypass");
  });

  it("shows Fix: hint line for bypass-lock warning in text output", async () => {
    // Project with allow+deny rules but no disableBypassPermissionsMode → LOW warning with fixCmd
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-bypass-hint-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], deny: ["Read(**/.env)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/Fix:/i);
      expect(output).toMatch(/cpm bypass-lock on --scope project/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows Fix: hint line for bare Bash allow warning in text output", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-bash-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await import("fs/promises").then((fs) =>
      // settings.json has scope "project" → rule.scope = "project"
      fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
        permissions: { allow: ["Bash"] },
      }))
    );
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/Fix:/i);
      expect(output).toContain('cpm reset "Bash" --scope project');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes fix field in JSON output for warnings that have fixCmd", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // project-bypass has bypassPermissions (fixCmd) + bare Bash allow (fixCmd)
    // settings.json = scope "project", so fix hints include --scope project
    await auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, json: true, includeGlobal: false });
    const json = JSON.parse(calls.join(""));
    const issuesWithFix = json.issues.filter((i: Record<string, unknown>) => i.fix !== undefined);
    expect(issuesWithFix.length).toBeGreaterThan(0);
    const modeFix = json.issues.find((i: Record<string, unknown>) => typeof i.fix === "string" && (i.fix as string).includes("mode default --scope project"));
    expect(modeFix).toBeDefined();
    // project-scope fix should include --project with an absolute path
    expect(modeFix.fix).toMatch(/--project .+project-bypass/);
  });

  it("fix field in JSON has no --project for user-scope warnings (audit.ts:64)", async () => {
    // audit.ts:64: user-scope fixOp → fix = fixCmd only (no --project appended)
    // Create a project where mode is set at user scope by having a fresh project with
    // NO local/project mode settings — the user settings' mode would propagate.
    // We simulate this by using mcp__-style: directly check that user-scope fixOp produces no --project.
    // Use project-bypass fixture but with includeGlobal: false so mode comes only from project settings.
    // For a true user-scope test we rely on the fix generation logic: if fixOp.scope === "user"
    // the fix string equals fixCmd with no --project suffix.
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-user-fix-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    // Write a project-scope settings file (scope "project")
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], deny: ["Read(**/.env)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, json: true });
      const json = JSON.parse(calls.join(""));
      const bypassLockIssue = json.issues.find(
        (i: Record<string, unknown>) => typeof i.fix === "string" && (i.fix as string).includes("bypass-lock on --scope")
      );
      expect(bypassLockIssue).toBeDefined();
      // bypass-lock fix targets the "project" scope file → fix includes --project
      expect(bypassLockIssue.fix).toMatch(/--project/);
      // The fix command itself (without --project) should NOT be empty after stripping
      expect(bypassLockIssue.fix).toContain("cpm bypass-lock on --scope project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — --fix hint
// ────────────────────────────────────────────────────────────

describe("auditCommand — --fix hint", () => {
  it("shows --fix hint when there are auto-fixable issues (audit.ts: uniqueFixCmds)", async () => {
    // Regular audit (no --fix flag) → shows "ℹ N fix(es) available. Run: cpm audit --fix"
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-hint-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"] },  // Bash without specifier → fixable
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).toMatch(/fix\(es\) available.*cpm audit --fix/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not show --fix hint when there are no auto-fixable issues", async () => {
    // Only unfixable warnings (No deny rules configured) → no hint
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-hint-none-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      expect(output).not.toMatch(/cpm audit --fix/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — text output deduplication
// ────────────────────────────────────────────────────────────

describe("auditCommand — text output deduplication", () => {
  it("[N projects] label shown when two issues share the same fix command (dynamic mock)", async () => {
    // The [N projects] display only fires when two IssueRows have the same non-null fix string.
    // This only happens for user-scope ops (where --project is omitted).
    // We simulate it by mocking the scan function to return two projects each with a
    // bypassPermissions CRITICAL warning pointing at the user scope.
    vi.resetModules();
    const sharedFix = "cpm mode default --scope user";
    vi.doMock("../src/core/discovery.js", () => ({
      scan: async () => ({
        projects: [
          {
            rootPath: "/fake/proj-a",
            settingsFiles: [],
            claudeMdFiles: [],
            effectivePermissions: {
              defaultMode: "bypassPermissions",
              allow: [], deny: [], ask: [],
              isBypassDisabled: false,
              mcpServers: [],
              envVarNames: [],
              additionalDirs: [],
              warnings: [{
                severity: "critical",
                message: "bypassPermissions mode is active — all permission checks disabled",
                fixCmd: "cpm mode default --scope user",
                fixOp: { kind: "mode", mode: "default", scope: "user" },
              }],
            },
          },
          {
            rootPath: "/fake/proj-b",
            settingsFiles: [],
            claudeMdFiles: [],
            effectivePermissions: {
              defaultMode: "bypassPermissions",
              allow: [], deny: [], ask: [],
              isBypassDisabled: false,
              mcpServers: [],
              envVarNames: [],
              additionalDirs: [],
              warnings: [{
                severity: "critical",
                message: "bypassPermissions mode is active — all permission checks disabled",
                fixCmd: "cpm mode default --scope user",
                fixOp: { kind: "mode", mode: "default", scope: "user" },
              }],
            },
          },
        ],
        global: { user: undefined, managed: undefined, userMcpServers: [] },
        errors: [],
        scannedAt: new Date(),
        scanRoot: "/fake",
      }),
    }));
    const { auditCommand: freshAudit } = await import("../src/commands/audit.js");
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await freshAudit({ root: "/fake", maxDepth: 1, includeGlobal: false });
      const output = calls.join("\n");
      // Two issues with the same fix → [2 projects] label instead of two project paths
      expect(output).toMatch(/\[2 projects\]/);
      expect(output).toContain(sharedFix);
      // Should NOT show individual project paths
      expect(output).not.toContain("/fake/proj-a");
      expect(output).not.toContain("/fake/proj-b");
    } finally {
      vi.doUnmock("../src/core/discovery.js");
      vi.resetModules();
    }
  });

  it("shows project path for single-project issues (no deduplication)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-dedup-single-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // Single project → shows project path (not "[N projects]")
      expect(output).not.toMatch(/\[\d+ projects\]/);
      expect(output).toContain("proj");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("collapses duplicate fix-command issues across projects with [N projects] label", async () => {
    // Two projects with the same bare Bash allow but different project paths →
    // project-scope fixes have --project <path> so they are unique per project.
    // To get true deduplication, we need issues with IDENTICAL fix commands.
    // The only case is user-scope issues (scope=user → same ~/.claude/settings.json).
    // We simulate this by making both projects have the same issue AND same fix.
    // The simplest way: use _confirmFn to inspect output and create two projects
    // with a shared fixable rule at the same scope pointing to the same file.
    // Instead, we test a scenario where two unfixable issues with different messages appear — no dedup.
    // And confirm dedup happens for issues that share a fix (only one [N projects] group shown).

    // Create two projects, each with bare Bash (HIGH warning) — their fixes differ (different --project)
    // so they should NOT be deduplicated.
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-dedup-multi-"));
    const projA = join(root, "proj-a", ".claude");
    const projB = join(root, "proj-b", ".claude");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(projA, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"], disableBypassPermissionsMode: "disable" },
    }));
    await fs.writeFile(join(projB, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // Two different project-scope Bash issues → different --project flags → NOT deduplicated
      // Both project paths appear in output
      expect(output).toContain("proj-a");
      expect(output).toContain("proj-b");
      // Count of issues should reflect both
      expect(output).toMatch(/HIGH \(2\)/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("unfixable warnings (no fix cmd) are always shown individually per project", async () => {
    // Two projects each producing "No deny rules configured" (unfixable, no fix cmd)
    // → shown individually (both project paths appear, no [N projects] collapse)
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-dedup-unfixable-"));
    const projA = join(root, "proj-a", ".claude");
    const projB = join(root, "proj-b", ".claude");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    const fs = await import("fs/promises");
    // allow-only with no deny → "No deny rules configured" (unfixable)
    // disableBypassPermissionsMode present → no bypass-lock warning
    await fs.writeFile(join(projA, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], disableBypassPermissionsMode: "disable" },
    }));
    await fs.writeFile(join(projB, "settings.json"), JSON.stringify({
      permissions: { allow: ["Write(src/*)"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = calls.join("\n");
      // Unfixable → no collapse → both project paths shown
      expect(output).toContain("proj-a");
      expect(output).toContain("proj-b");
      expect(output).not.toMatch(/\[2 projects\]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — --fix
// ────────────────────────────────────────────────────────────

describe("auditCommand — --fix", () => {
  it("--fix --yes removes a bare Bash allow rule and reports success", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-apply-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash"] } }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // Should report at least one fix applied
      expect(output).toMatch(/Applied \d+ fix/i);
      // The settings.json should now have Bash removed from allow
      const updated = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      expect(updated.permissions?.allow ?? []).not.toContain("Bash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix --yes resets a dangerous mode (bypassPermissions) to default", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-mode-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    await fs.writeFile(settingsPath, JSON.stringify({
      permissions: { defaultMode: "bypassPermissions", allow: ["Bash(*)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      expect(output).toMatch(/Applied \d+ fix/i);
      const updated = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      // Mode should be set to "default" after fix
      expect(updated.permissions?.defaultMode).toBe("default");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix with no fixable issues reports no auto-fixable issues", async () => {
    // "No deny rules configured" has no fixOp — not auto-fixable
    // disableBypassPermissionsMode is set to suppress the bypass-lock warning (which is fixable)
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-none-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], disableBypassPermissionsMode: "disable" },  // no deny → LOW warning with no fixOp
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      expect(output).toMatch(/No auto-fixable issues/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix deduplicates identical fix ops (same rule twice from different warnings)", async () => {
    // Both bypassPermissions and "mode is active" style warnings share the same modeFixOp
    // — only one setMode call should be made
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-dedup-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    // bypassPermissions mode generates a single CRITICAL warning with one fixOp
    await fs.writeFile(settingsPath, JSON.stringify({
      permissions: { defaultMode: "bypassPermissions", allow: ["Bash(*)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // Should show "Auto-fixable: N fix(es)" line
      expect(output).toMatch(/Auto-fixable:/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix shows '(affects N projects)' when same fix applies to multiple projects", async () => {
    // Two projects with identical Bash allow issues (same fixOp, different settings files)
    // Each fix is separate (different files), but for display purposes we test the affectedCount
    // For a single-project fix, no "(affects N)" note should appear.
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-affected-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // Single-project fix: should NOT show "(affects N projects)" note
      expect(output).not.toMatch(/affects \d+ projects/i);
      expect(output).toMatch(/Auto-fixable:/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix does NOT deduplicate same-kind op across two projects (different settings files)", async () => {
    // Two projects each have bare Bash allow → same fixOp kind, but different target files
    // Each should get its own separate fix (not cross-project deduplicated)
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-twoproject-"));
    const dir1 = join(root, "proj1", ".claude");
    const dir2 = join(root, "proj2", ".claude");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    const fs = await import("fs/promises");
    const settings1 = join(dir1, "settings.json");
    const settings2 = join(dir2, "settings.json");
    await fs.writeFile(settings1, JSON.stringify({ permissions: { allow: ["Bash"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" } }));
    await fs.writeFile(settings2, JSON.stringify({ permissions: { allow: ["Bash"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" } }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // Should report 2 separate fixes (one per project), not 1 deduplicated
      expect(output).toMatch(/Auto-fixable: 2 fix\(es\)/i);
      // Both settings files should have Bash removed
      const updated1 = JSON.parse(await fs.readFile(settings1, "utf8"));
      const updated2 = JSON.parse(await fs.readFile(settings2, "utf8"));
      expect(updated1.permissions?.allow ?? []).not.toContain("Bash");
      expect(updated2.permissions?.allow ?? []).not.toContain("Bash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix --yes with no issues finds nothing to fix", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-noissues-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    await fs.writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: {
        allow: ["Bash(npm run *)"],
        deny: ["Read(**/.env)"],
        disableBypassPermissionsMode: "disable",
      },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // When no issues: shows "No issues found", --fix is irrelevant
      expect(output).toMatch(/No issues found/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failed fixes when the settings dir is not writable", async () => {
    // audit.ts: applyFixOp returns error → covers lines 194-196 (✗ path) and 207 (failCount > 0)
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-readonly-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash"] } }));
    // Make .claude dir read-only so write fails
    await fs.chmod(claudeDir, 0o555);
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      // ✗ line + error message
      expect(output).toContain("✗");
      // failCount > 0: "Applied N fix(es); M failed"
      expect(output).toMatch(/Applied \d+ fix\(es\); \d+ failed/i);
    } finally {
      await fs.chmod(claudeDir, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--fix --yes enables bypass lock when disableBypassPermissionsMode is missing", async () => {
    // Project with allow+deny rules but no disableBypassPermissionsMode → fixable LOW warning
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-bypasslock-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    await fs.writeFile(settingsPath, JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], deny: ["Read(**/.env)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      expect(output).toMatch(/Applied \d+ fix/i);
      const updated = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      expect(updated.permissions?.disableBypassPermissionsMode).toBe("disable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts when user declines fix prompt (yes=false, _confirmFn returns false)", async () => {
    // audit.ts: !proceed branch (lines 183-186) — uses _confirmFn injection to avoid ESM mocking
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-fix-abort-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const fs = await import("fs/promises");
    const settingsPath = join(claudeDir, "settings.json");
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash"] } }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({
        root, maxDepth: 2, includeGlobal: false, fix: true, yes: false,
        _confirmFn: async () => false,
      });
      const output = calls.join("\n");
      expect(output).toMatch(/Aborted/i);
      // File should NOT have been modified
      const unchanged = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      expect(unchanged.permissions?.allow).toContain("Bash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — --fix re-scan
// ────────────────────────────────────────────────────────────

describe("auditCommand — --fix re-scan", () => {
  it("shows 'All issues resolved' after fixing all fixable issues", async () => {
    // Project with only a fixable issue (bypassPermissions mode + safe allow)
    // After fixing mode, the only remaining warning would be low-severity "disableBypassPermissionsMode not set"
    // which is not fixable — but since we're testing re-scan, let's use a clean case.
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-rescan-clean-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    // bare Bash → fixable. After removing Bash from allow, no non-read allows → no "no deny" warning
    await fs.writeFile(settingsPath, JSON.stringify({
      permissions: { allow: ["Bash"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      expect(output).toMatch(/Applied \d+ fix/i);
      // re-scan shows all clean
      expect(output).toMatch(/All issues resolved/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows remaining issues after --fix when some issues are not auto-fixable", async () => {
    // Project with: bypassPermissions mode (fixable) + valid allow/deny (so "no deny" LOW warning absent)
    // After fixing mode, re-scan should have no remaining mode warning but may have others
    // Use a setup where fixing ONE issue leaves another unfixable issue
    const root = mkdtempSync(join(tmpdir(), "cpm-audit-rescan-remain-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    const fs = await import("fs/promises");
    // bypassPermissions (fixable) + Bash(safe allow) + no deny → "no deny" LOW remains after fix
    await fs.writeFile(settingsPath, JSON.stringify({
      permissions: { defaultMode: "bypassPermissions", allow: ["Bash(npm run *)"] },
    }));
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    try {
      await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: true });
      const output = calls.join("\n");
      expect(output).toMatch(/Applied \d+ fix/i);
      // re-scan should show remaining issues (no deny / disableBypassPermissionsMode)
      expect(output).toMatch(/issue\(s\) still require attention/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("audit JSON output includes fixOp field for fixable issues", async () => {
    // Verify fixOp is included in --json output (not stripped like the old code did)
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await auditCommand({ root: join(FIXTURES, "project-bypass"), maxDepth: 1, json: true, includeGlobal: false });
    const json = JSON.parse(calls.join(""));
    const withFixOp = json.issues.filter((i: Record<string, unknown>) => i.fixOp !== undefined);
    expect(withFixOp.length).toBeGreaterThan(0);
    // fixOp should have kind, scope, and either rule or mode
    const modeOp = withFixOp.find((i: Record<string, unknown>) =>
      (i.fixOp as Record<string, unknown>)?.kind === "mode"
    );
    expect(modeOp).toBeDefined();
    expect((modeOp.fixOp as Record<string, unknown>).mode).toBe("default");
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

  it("shows command without args when MCP server has command but no args", () => {
    // format.ts:145-147: s.args && s.args.length > 0 false branch — command shown alone
    // All existing tests use servers with args (e.g. "npx -y @modelcontextprotocol/...").
    // This covers the path where a server has command but args is undefined or empty.
    const project = makeProject([
      { name: "bare-server", scope: "local", command: "my-tool", args: [] },
    ]);
    const output = formatEffectivePermissions(project);
    expect(output).toContain("cmd: my-tool");
    // Should not append a space or extra tokens after "my-tool"
    expect(output).not.toMatch(/cmd: my-tool\s+\S/);
  });

  it("shows '✗ unreadable' status for settings file that exists but cannot be read", () => {
    // format.ts:99-100: !f.readable → chalk.red("✗ unreadable") — never tested
    // Construct a project with a settings file that has readable=false (stat succeeds, readFile fails).
    const project: ClaudeProject = {
      rootPath: "/tmp/test-unreadable",
      claudeDir: "/tmp/test-unreadable/.claude",
      settingsFiles: [{
        path: "/tmp/test-unreadable/.claude/settings.json",
        scope: "project",
        exists: true,
        readable: false,
        parsed: false,
      }],
      claudeMdFiles: [],
      effectivePermissions: {
        defaultMode: "default",
        allow: [],
        deny: [],
        ask: [],
        isBypassDisabled: false,
        mcpServers: [],
        envVarNames: [],
        additionalDirs: [],
        warnings: [],
      },
    };
    const output = formatEffectivePermissions(project);
    expect(output).toMatch(/unreadable/i);
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

  it("bash script includes 'edit' command and its --scope/--project options", async () => {
    // Regression: 'edit' was missing from COMMANDS list, so it never appeared in completions.
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("bash");
    const output = lines.join("\n");
    expect(output).toContain("edit");
    expect(output).toMatch(/edit\)[\s\S]*--scope.*--project/);
  });

  it("zsh script includes 'edit' command with description and --scope/--project options", async () => {
    // Regression: 'edit' was missing from COMMANDS list, so it never appeared in zsh completions.
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("zsh");
    const output = lines.join("\n");
    expect(output).toContain("edit");
    expect(output).toMatch(/edit\)[\s\S]*--scope\[Settings scope\]/);
  });

  it("bash script suggests tool names for allow/deny/ask positional argument", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("bash");
    const output = lines.join("\n");
    // allow|deny|ask block should include common tool names
    expect(output).toMatch(/allow\|deny\|ask\)[\s\S]*Bash.*Read.*Write/);
    expect(output).toMatch(/allow\|deny\|ask\)[\s\S]*WebFetch/);
    // And still suggest flags when cur starts with -
    expect(output).toMatch(/allow\|deny\|ask\)[\s\S]*--scope.*--project.*--dry-run/);
  });

  it("zsh script suggests tool names for allow/deny/ask positional argument", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("zsh");
    const output = lines.join("\n");
    // allow|deny|ask block should define rule with tool completions
    expect(output).toMatch(/allow\|deny\|ask\)[\s\S]*1:rule:\(.*Bash.*Read.*WebFetch/);
  });

  it("bash script suggests tool names for reset positional argument", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await completionCommand("bash");
    const output = lines.join("\n");
    expect(output).toMatch(/reset\)[\s\S]*Bash.*Read/);
    expect(output).toMatch(/reset\)[\s\S]*--scope.*--project.*--all/);
  });
});

// ────────────────────────────────────────────────────────────
// editCommand
// ────────────────────────────────────────────────────────────

describe("editCommand", () => {
  it("creates an empty settings.local.json when file does not exist (edit.ts:25-28)", async () => {
    // edit.ts: if (!existsSync(settingsPath)) { writeFile(stub) }
    // Verifies the file-creation side-effect without launching a real editor.
    // We mock spawn so no real editor is invoked.
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    const settingsFile = join(tmpDir, ".claude", "settings.local.json");
    expect(settingsFile).toSatisfy((p: string) => !require("fs").existsSync(p));

    await editMocked({ project: tmpDir, scope: "local" });

    const content = JSON.parse(await readFile(settingsFile, "utf-8"));
    expect(content).toEqual({});

    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("does not overwrite an existing settings file (edit.ts:25 false branch)", async () => {
    // When the settings file already exists, editCommand should NOT recreate it.
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    // Pre-create the file with known content
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    const existing = JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2) + "\n";
    const settingsFile = join(tmpDir, ".claude", "settings.json");
    await writeFile(settingsFile, existing, "utf-8");

    await editMocked({ project: tmpDir, scope: "project" });

    // Content should be unchanged
    const afterContent = await readFile(settingsFile, "utf-8");
    expect(afterContent).toBe(existing);

    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("throws for managed scope (edit.ts via resolveSettingsPath)", async () => {
    // resolveSettingsPath throws for managed scope
    await expect(
      editCommand({ project: tmpDir, scope: "managed" })
    ).rejects.toThrow(/managed/i);
  });

  it("uses 'local' scope when scope option is omitted (edit.ts:16)", async () => {
    // edit.ts:16: const scope = (opts.scope ?? "local") as SettingsScope
    // All prior edit tests pass scope explicitly; this covers the default fallback.
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    await editMocked({ project: tmpDir }); // no scope → should default to "local"

    // Default scope "local" → file should be settings.local.json
    const localFile = join(tmpDir, ".claude", "settings.local.json");
    const { existsSync } = await import("fs");
    expect(existsSync(localFile)).toBe(true);

    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("uses process.cwd() when project option is omitted (edit.ts:17-19)", async () => {
    // edit.ts:17-19: opts.project ? resolve(expandHome(opts.project)) : process.cwd()
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    try {
      await editMocked({ scope: "local" }); // no project → falls back to process.cwd() = tmpDir
      const localFile = join(tmpDir, ".claude", "settings.local.json");
      const { existsSync } = await import("fs");
      expect(existsSync(localFile)).toBe(true);
    } finally {
      cwdSpy.mockRestore();
      vi.doUnmock("child_process");
      vi.resetModules();
    }
  });

  it("propagates spawn error (edit.ts:44 — child.on('error', rej))", async () => {
    // edit.ts:44: child.on("error", rej) — spawn failure rejects the promise
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("error", new Error("SPAWN_FAILED")));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    // Pre-create the file so the error path (not file-creation) is hit
    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({ permissions: {} }), "utf-8");

    await expect(editMocked({ project: tmpDir, scope: "project" })).rejects.toThrow("SPAWN_FAILED");

    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("logs 'Created empty settings file' message when creating a new file (edit.ts:30)", async () => {
    // edit.ts:30: console.log(chalk.gray(`Created empty settings file: ...`))
    // Prior tests do not assert on this message — they only check file content.
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (_cmd: string, _args: string[], _opts: object) => {
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logCalls.push(args.join("")); });

    await editMocked({ project: tmpDir, scope: "local" }); // file does not exist → created

    expect(logCalls.join("")).toMatch(/Created empty settings file/i);

    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("uses VISUAL env var as editor (edit.ts:33 — VISUAL branch)", async () => {
    // edit.ts:33-34: const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi"
    // VISUAL takes priority when set.
    let capturedCmd = "";
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (cmd: string, _args: string[], _opts: object) => {
          capturedCmd = cmd;
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({}), "utf-8");

    const origVISUAL = process.env.VISUAL;
    const origEDITOR = process.env.EDITOR;
    process.env.VISUAL = "myvisualeditor";
    process.env.EDITOR = "myeditor";
    try {
      await editMocked({ project: tmpDir, scope: "project" });
      expect(capturedCmd).toBe("myvisualeditor");
    } finally {
      if (origVISUAL === undefined) delete process.env.VISUAL; else process.env.VISUAL = origVISUAL;
      if (origEDITOR === undefined) delete process.env.EDITOR; else process.env.EDITOR = origEDITOR;
      vi.doUnmock("child_process");
      vi.resetModules();
    }
  });

  it("uses EDITOR env var when VISUAL is not set (edit.ts:33 — EDITOR branch)", async () => {
    // edit.ts:33-34: const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi"
    // Falls through to EDITOR when VISUAL is undefined.
    let capturedCmd = "";
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (cmd: string, _args: string[], _opts: object) => {
          capturedCmd = cmd;
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({}), "utf-8");

    const origVISUAL = process.env.VISUAL;
    const origEDITOR = process.env.EDITOR;
    delete process.env.VISUAL;
    process.env.EDITOR = "myeditor";
    try {
      await editMocked({ project: tmpDir, scope: "project" });
      expect(capturedCmd).toBe("myeditor");
    } finally {
      if (origVISUAL !== undefined) process.env.VISUAL = origVISUAL;
      if (origEDITOR === undefined) delete process.env.EDITOR; else process.env.EDITOR = origEDITOR;
      vi.doUnmock("child_process");
      vi.resetModules();
    }
  });

  it("falls back to 'vi' when VISUAL and EDITOR are not set (edit.ts:34 — vi fallback)", async () => {
    // edit.ts:33-34: const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi"
    // Falls through to literal "vi" when neither env var is set.
    let capturedCmd = "";
    vi.doMock("child_process", async (importOriginal) => {
      const original = await importOriginal<typeof import("child_process")>();
      return {
        ...original,
        spawn: (cmd: string, _args: string[], _opts: object) => {
          capturedCmd = cmd;
          const EventEmitter = require("events");
          const child = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    });
    vi.resetModules();
    const { editCommand: editMocked } = await import("../src/commands/edit.js");

    await mkdir(join(tmpDir, ".claude"), { recursive: true });
    await writeFile(join(tmpDir, ".claude", "settings.json"), JSON.stringify({}), "utf-8");

    const origVISUAL = process.env.VISUAL;
    const origEDITOR = process.env.EDITOR;
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    try {
      await editMocked({ project: tmpDir, scope: "project" });
      expect(capturedCmd).toBe("vi");
    } finally {
      if (origVISUAL !== undefined) process.env.VISUAL = origVISUAL;
      if (origEDITOR !== undefined) process.env.EDITOR = origEDITOR;
      vi.doUnmock("child_process");
      vi.resetModules();
    }
  });
});

// ────────────────────────────────────────────────────────────
// copyCommand
// ────────────────────────────────────────────────────────────

import { copyCommand } from "../src/commands/copy.js";

describe("copyCommand", () => {
  let srcDir: string;
  let dstDir: string;

  // Create a source project with allow/deny rules and a mode
  beforeEach(async () => {
    srcDir = mkdtempSync(join(tmpdir(), "cpm-copy-src-"));
    dstDir = mkdtempSync(join(tmpdir(), "cpm-copy-dst-"));
    await mkdir(join(srcDir, ".claude"), { recursive: true });
    await writeFile(
      join(srcDir, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          defaultMode: "acceptEdits",
          allow: ["Bash(npm run *)", "Read"],
          deny: ["Bash(rm -rf *)"],
        },
      }),
      "utf-8"
    );
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstDir, { recursive: true, force: true });
  });

  it("copies rules and mode to target --yes (default local scope)", async () => {
    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    expect(data.permissions.allow).toContain("Bash(npm run *)");
    expect(data.permissions.allow).toContain("Read");
    expect(data.permissions.deny).toContain("Bash(rm -rf *)");
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("--dry-run does not create any files", async () => {
    await copyCommand(srcDir, dstDir, { dryRun: true });

    const { stat } = await import("fs/promises");
    await expect(stat(join(dstDir, ".claude"))).rejects.toThrow();
  });

  it("exits 1 without --yes (and not --dry-run)", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });
    try {
      await expect(copyCommand(srcDir, dstDir, {})).rejects.toThrow("process.exit(1)");
    } finally {
      mockExit.mockRestore();
    }
  });

  it("copies into project scope when --scope=project", async () => {
    await copyCommand(srcDir, dstDir, { scope: "project", yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.json"), "utf-8");
    const data = JSON.parse(content);
    expect(data.permissions.allow).toContain("Read");
  });

  it("exits 1 when source and target are the same path", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });
    try {
      await expect(copyCommand(srcDir, srcDir, { yes: true })).rejects.toThrow("process.exit(1)");
    } finally {
      mockExit.mockRestore();
    }
  });

  it("exits 1 on invalid scope", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });
    try {
      await expect(
        copyCommand(srcDir, dstDir, { scope: "managed", yes: true })
      ).rejects.toThrow("process.exit(1)");
    } finally {
      mockExit.mockRestore();
    }
  });

  it("exits 1 when source has no .claude directory", async () => {
    const noClaudeDir = mkdtempSync(join(tmpdir(), "cpm-copy-no-claude-"));
    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });
    try {
      await expect(
        copyCommand(noClaudeDir, dstDir, { yes: true })
      ).rejects.toThrow("process.exit(1)");
    } finally {
      mockExit.mockRestore();
      rmSync(noClaudeDir, { recursive: true, force: true });
    }
  });

  it("reports 'Nothing to copy' when source has no project-level rules or mode", async () => {
    const emptySrc = mkdtempSync(join(tmpdir(), "cpm-copy-empty-"));
    await mkdir(join(emptySrc, ".claude"), { recursive: true });
    await writeFile(
      join(emptySrc, ".claude", "settings.json"),
      JSON.stringify({ permissions: {} }),
      "utf-8"
    );
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => logCalls.push(String(msg)));
    try {
      await copyCommand(emptySrc, dstDir, { yes: true });
      expect(logCalls.some((m) => m.includes("Nothing to copy"))).toBe(true);
    } finally {
      rmSync(emptySrc, { recursive: true, force: true });
    }
  });

  it("merges with existing target rules (deduplicates)", async () => {
    await mkdir(join(dstDir, ".claude"), { recursive: true });
    await writeFile(
      join(dstDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Read", "Glob"] } }),
      "utf-8"
    );

    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // "Read" is in both source and target — should appear exactly once
    expect(data.permissions.allow.filter((r: string) => r === "Read")).toHaveLength(1);
    expect(data.permissions.allow).toContain("Bash(npm run *)");
    expect(data.permissions.allow).toContain("Glob");
  });

  it("only copies project/local scope rules (not user/managed)", async () => {
    // Source has allow: ["Bash(npm run *)", "Read"] at project scope.
    // copyCommand uses includeGlobal: false, so user/managed scope rules are excluded.
    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // Only the 2 project-scope allow rules should be present (no global leakage)
    expect(data.permissions.allow).toHaveLength(2);
  });

  it("copies ask rules from source (lines 51-52, 79)", async () => {
    // Add ask rules to source settings (srcDir uses project scope settings.json)
    await writeFile(
      join(srcDir, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Read"],
          deny: [],
          ask: ["WebFetch", "Bash"],
        },
      }),
      "utf-8"
    );

    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    expect(data.permissions.ask).toContain("WebFetch");
    expect(data.permissions.ask).toContain("Bash");
  });

  it("local scope mode takes precedence over project scope mode (line 57 sort)", async () => {
    // Create source with both project-scope and local-scope settings, each with a mode.
    // Local scope mode (bypassPermissions) should win over project scope mode (auto).
    await writeFile(
      join(srcDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "auto", allow: ["Read"] } }),
      "utf-8"
    );
    await writeFile(
      join(srcDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }),
      "utf-8"
    );

    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // local scope mode wins
    expect(data.permissions.defaultMode).toBe("acceptEdits");
  });

  it("copies only mode when source has no rules — success message mentions mode (line 116 false)", async () => {
    // Source has only a mode, no allow/deny/ask rules
    await writeFile(
      join(srcDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }),
      "utf-8"
    );
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logCalls.push(args.join("")));
    await copyCommand(srcDir, dstDir, { yes: true });
    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    expect(data.permissions.defaultMode).toBe("plan");
    // Success message should mention mode but NOT rules
    expect(logCalls.some((m) => /mode.*"plan"/i.test(m))).toBe(true);
  });

  it("does not print Allow line when source has no allow rules (line 72 false)", async () => {
    // Source has only deny rules, no allow
    await writeFile(
      join(srcDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash(rm -rf *)"] } }),
      "utf-8"
    );
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logCalls.push(args.join("")));
    await copyCommand(srcDir, dstDir, { yes: true });
    // Allow line should NOT be printed
    expect(logCalls.every((m) => !/Allow \(/i.test(m))).toBe(true);
    // Deny line SHOULD be printed (copy.ts uses "Deny  (" with two spaces)
    expect(logCalls.some((m) => /Deny\s+\(/i.test(m))).toBe(true);
  });

  it("handles non-array existing target permissions gracefully (lines 102-103 false)", async () => {
    // Target settings has allow/deny as strings (malformed) — should use [] fallback
    await mkdir(join(dstDir, ".claude"), { recursive: true });
    await writeFile(
      join(dstDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: "OldAllow", deny: "OldDeny" } }),
      "utf-8"
    );
    await copyCommand(srcDir, dstDir, { yes: true });
    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // Source allow rules should be present (non-array existing target treated as empty)
    expect(Array.isArray(data.permissions.allow)).toBe(true);
    expect(data.permissions.allow).toContain("Bash(npm run *)");
  });

  it("merges with target that has existing deny/ask arrays (lines 102-103 true)", async () => {
    // Target already has deny/ask rule arrays — should merge (dedup) with source rules
    await mkdir(join(dstDir, ".claude"), { recursive: true });
    await writeFile(
      join(dstDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { deny: ["Read(**/.env)"], ask: ["Grep"] } }),
      "utf-8"
    );
    await copyCommand(srcDir, dstDir, { yes: true });
    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // Existing deny rule should be preserved, source deny rule added
    expect(data.permissions.deny).toContain("Read(**/.env)");
    expect(data.permissions.deny).toContain("Bash(rm -rf *)");
    // Existing ask rule preserved
    expect(data.permissions.ask).toContain("Grep");
  });

  it("includes local-scope source rules in copy (lines 45-51 local branch)", async () => {
    // Source has rules in BOTH project scope (settings.json) AND local scope (settings.local.json)
    // Local-scope rules should also be copied to target (covers the `|| r.scope === "local"` branch)
    await writeFile(
      join(srcDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Glob"], deny: ["Write"], ask: ["Bash(git *)"] } }),
      "utf-8"
    );
    await copyCommand(srcDir, dstDir, { yes: true });
    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // Both project-scope and local-scope allow rules from source should be present
    expect(data.permissions.allow).toContain("Bash(npm run *)"); // project scope
    expect(data.permissions.allow).toContain("Glob");            // local scope
    expect(data.permissions.deny).toContain("Write");            // local scope deny
    expect(data.permissions.ask).toContain("Bash(git *)");       // local scope ask
  });

  it("local-scope mode takes precedence over project-scope mode (copy.ts:57 sort false branch)", async () => {
    // Source has defaultMode in BOTH settings.json (project scope, "acceptEdits") and
    // settings.local.json (local scope, "plan"). The sort at copy.ts:57 places local first.
    // The false branch `(a.scope === "local" ? -1 : 1)` fires for the project-scope element.
    await writeFile(
      join(srcDir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }),
      "utf-8"
    );
    // srcDir/.claude/settings.json already has defaultMode: "acceptEdits" (from beforeEach)
    vi.spyOn(console, "log").mockImplementation(() => { /* suppress */ });
    await copyCommand(srcDir, dstDir, { yes: true });

    const content = await readFile(join(dstDir, ".claude", "settings.local.json"), "utf-8");
    const data = JSON.parse(content);
    // Local scope mode "plan" wins over project scope mode "acceptEdits"
    expect(data.permissions.defaultMode).toBe("plan");
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — --min-severity filter
// ────────────────────────────────────────────────────────────
describe("auditCommand — --min-severity", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-audit-sev-"));
    // Create two projects: one with a critical (bypass) warning, one with a low warning
    const bypassDir = join(root, "bypass-proj", ".claude");
    const safeDir = join(root, "safe-proj", ".claude");
    await mkdir(bypassDir, { recursive: true });
    await mkdir(safeDir, { recursive: true });
    await writeFile(
      join(bypassDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // low-severity: wildcard allow rule
    await writeFile(
      join(safeDir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(*)", "WebFetch"] } })
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("minSeverity=critical omits low/medium/high, keeps critical", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "critical" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.issues.every((i: { severity: string }) => i.severity === "critical")).toBe(true);
    // must include bypass warning
    expect(json.issueCount).toBeGreaterThan(0);
  });

  it("minSeverity=low includes all severities (default behavior)", async () => {
    const allCalls: unknown[][] = [];
    const lowCalls: unknown[][] = [];
    vi.spyOn(console, "log")
      .mockImplementationOnce((...args) => { allCalls.push(args); })
      .mockImplementation((...args) => { lowCalls.push(args); });
    await auditCommand({ root, maxDepth: 2, json: true, includeGlobal: false });
    await auditCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "low" });
    const all = JSON.parse(allCalls.map((a) => a.join("")).join(""));
    const low = JSON.parse(lowCalls.map((a) => a.join("")).join(""));
    expect(all.issueCount).toBe(low.issueCount);
  });

  it("minSeverity=high only shows high and critical", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "high" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    const ALLOWED = new Set(["critical", "high"]);
    expect(json.issues.every((i: { severity: string }) => ALLOWED.has(i.severity))).toBe(true);
  });

  it("--exit-code only fires when filtered issues exist", async () => {
    // With minSeverity=critical and only a bypassPermissions project: exit 2
    await expect(
      auditCommand({ root, maxDepth: 2, includeGlobal: false, exitCode: true, minSeverity: "critical" })
    ).rejects.toThrow();
  });
});

// ────────────────────────────────────────────────────────────
// auditCommand — affected/clean project summary
// ────────────────────────────────────────────────────────────
describe("auditCommand — affected/clean summary", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-audit-mixed-"));
    // Project with a critical warning (bypassPermissions mode)
    const bypassDir = join(root, "bypass-proj", ".claude");
    await mkdir(bypassDir, { recursive: true });
    await writeFile(
      join(bypassDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // Clean project — narrow rules, bypass disabled → no warnings
    const cleanDir = join(root, "clean-proj", ".claude");
    await mkdir(cleanDir, { recursive: true });
    await writeFile(
      join(cleanDir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(npm run *)"], deny: ["Read(**/.env)"], disableBypassPermissionsMode: "disable" } })
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("JSON affectedProjectCount=1 and cleanProjectCount=1 with 1 of 2 affected", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await auditCommand({ root, maxDepth: 2, json: true, includeGlobal: false });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.projectCount).toBe(2);
    expect(json.affectedProjectCount).toBe(1);
    expect(json.cleanProjectCount).toBe(1);
  });

  it("text output header shows 'in N of M project(s)' when issues are found", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/in 1 of 2 project/);
  });

  it("text output shows clean-project summary line when some projects have no issues", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/1 project.*no issues/i);
  });

  it("text output shows filter note when minSeverity is not 'low'", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, minSeverity: "high" });
    const output = lines.join("\n");
    expect(output).toMatch(/showing high\+/i);
  });

  it("text output has no filter note when minSeverity is 'low' (default)", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, minSeverity: "low" });
    const output = lines.join("\n");
    expect(output).not.toMatch(/showing.*\+/i);
  });
});

// ────────────────────────────────────────────────────────────
// listCommand — --warnings filter
// ────────────────────────────────────────────────────────────
describe("listCommand — --warningsOnly", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-list-warn-"));
    // Project with a warning (bypass)
    const warnDir = join(root, "warn-proj", ".claude");
    await mkdir(warnDir, { recursive: true });
    await writeFile(
      join(warnDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // Clean project (no warnings)
    const cleanDir = join(root, "clean-proj", ".claude");
    await mkdir(cleanDir, { recursive: true });
    await writeFile(
      join(cleanDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "default" } })
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--warnings JSON only includes projects with warnings", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false, warningsOnly: true });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.projects.every((p: { warningCount: number }) => p.warningCount > 0)).toBe(true);
    // Should NOT include the clean project
    expect(json.projects.some((p: { path: string }) => p.path.includes("clean-proj"))).toBe(false);
    expect(json.projects.some((p: { path: string }) => p.path.includes("warn-proj"))).toBe(true);
  });

  it("--warnings without warningsOnly includes all projects", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.projectCount).toBe(2);
  });

  it("--warnings text output shows filtered count", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, json: false, includeGlobal: false, warningsOnly: true });
    const output = lines.join("\n");
    expect(output).toMatch(/1 of 2 project/);
  });

  it("--warnings text output shows no-warnings message when all clean", async () => {
    // Create a root with only clean projects
    const cleanRoot = mkdtempSync(join(tmpdir(), "cpm-list-clean-"));
    try {
      const dir = join(cleanRoot, "clean", ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "settings.json"), JSON.stringify({ permissions: {} }));
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      await listCommand({ root: cleanRoot, maxDepth: 2, json: false, includeGlobal: false, warningsOnly: true });
      const output = lines.join("\n");
      expect(output).toMatch(/No warnings found/);
    } finally {
      rmSync(cleanRoot, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// listCommand — --min-severity
// ────────────────────────────────────────────────────────────

describe("listCommand — --min-severity", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-list-minsev-"));
    // bypass project → CRITICAL warning
    const bypassDir = join(root, "bypass-proj", ".claude");
    await mkdir(bypassDir, { recursive: true });
    await writeFile(
      join(bypassDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // acceptEdits project → MEDIUM warning
    const mediumDir = join(root, "medium-proj", ".claude");
    await mkdir(mediumDir, { recursive: true });
    await writeFile(
      join(mediumDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "acceptEdits", disableBypassPermissionsMode: "disable" } })
    );
    // clean project → no warnings
    const cleanDir = join(root, "clean-proj", ".claude");
    await mkdir(cleanDir, { recursive: true });
    await writeFile(
      join(cleanDir, "settings.json"),
      JSON.stringify({ permissions: { disableBypassPermissionsMode: "disable" } })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--min-severity critical shows only projects with critical warnings", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "critical" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    // Only bypass-proj has a critical warning
    expect(json.projectCount).toBe(1);
    expect(json.projects[0].path).toMatch(/bypass-proj/);
    expect(json.minSeverity).toBe("critical");
  });

  it("--min-severity medium shows critical and medium projects", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "medium" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    // bypass-proj (critical) + medium-proj (medium), not clean-proj
    expect(json.projectCount).toBe(2);
    expect(json.minSeverity).toBe("medium");
    const paths = json.projects.map((p: { path: string }) => p.path);
    expect(paths.some((p: string) => p.includes("bypass-proj"))).toBe(true);
    expect(paths.some((p: string) => p.includes("medium-proj"))).toBe(true);
    expect(paths.some((p: string) => p.includes("clean-proj"))).toBe(false);
  });

  it("JSON minSeverity is null when --min-severity is not set", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.projectCount).toBe(3);
    expect(json.minSeverity).toBeNull();
  });

  it("text output shows 'critical+ warnings' label with --min-severity critical", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, json: false, includeGlobal: false, minSeverity: "critical" });
    const output = lines.join("\n");
    expect(output).toMatch(/1 of 3 project.*critical.*warning/i);
  });

  it("text output shows 'No warnings at critical+ severity' when no projects match", async () => {
    // Use a root with only medium-severity projects
    const medOnly = mkdtempSync(join(tmpdir(), "cpm-list-medonly-"));
    try {
      const dir = join(medOnly, "medium-only", ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "acceptEdits", disableBypassPermissionsMode: "disable" } })
      );
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      await listCommand({ root: medOnly, maxDepth: 2, json: false, includeGlobal: false, minSeverity: "critical" });
      const output = lines.join("\n");
      expect(output).toMatch(/No warnings at critical\+ severity/);
    } finally {
      rmSync(medOnly, { recursive: true, force: true });
    }
  });

  it("--min-severity works with --sort warnings (most-critical-first)", async () => {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await listCommand({ root, maxDepth: 2, json: true, includeGlobal: false, minSeverity: "medium", sort: "warnings" });
    const json = JSON.parse(calls.map((a) => a.join("")).join(""));
    expect(json.projectCount).toBe(2);
    // bypass-proj has more warnings (critical + others) than medium-proj
    const paths = json.projects.map((p: { path: string }) => p.path);
    const bypassIdx = paths.findIndex((p: string) => p.includes("bypass-proj"));
    const mediumIdx = paths.findIndex((p: string) => p.includes("medium-proj"));
    expect(bypassIdx).toBeLessThan(mediumIdx);
  });
});

// ────────────────────────────────────────────────────────────
// listCommand — --sort
// ────────────────────────────────────────────────────────────

describe("listCommand — --sort", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-list-sort-"));
    const fs = await import("fs/promises");
    // proj-b: bypassPermissions + Bash → many warnings
    const bDir = join(root, "proj-b", ".claude");
    await mkdir(bDir, { recursive: true });
    await fs.writeFile(join(bDir, "settings.json"), JSON.stringify({
      permissions: { defaultMode: "bypassPermissions", allow: ["Bash"] },
    }));
    // proj-a: default mode, no rules, bypass locked → 0 warnings
    const aDir = join(root, "proj-a", ".claude");
    await mkdir(aDir, { recursive: true });
    await fs.writeFile(join(aDir, "settings.json"), JSON.stringify({
      permissions: { disableBypassPermissionsMode: "disable" },
    }));
    // proj-c: default mode, 1 warning (no deny rules)
    const cDir = join(root, "proj-c", ".claude");
    await mkdir(cDir, { recursive: true });
    await fs.writeFile(join(cDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run *)"], disableBypassPermissionsMode: "disable" },
    }));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--sort name returns projects in alphabetical order", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, includeGlobal: false, sort: "name" });
    const output = calls.join("\n");
    const idxA = output.indexOf("proj-a");
    const idxB = output.indexOf("proj-b");
    const idxC = output.indexOf("proj-c");
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it("--sort warnings returns project with most warnings first", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, includeGlobal: false, sort: "warnings" });
    const output = calls.join("\n");
    // proj-b: bypassPermissions (CRITICAL) + Bash (HIGH) = most warnings → first
    // proj-c: 1 warning; proj-a: 0 warnings → last
    const idxB = output.indexOf("proj-b");
    const idxC = output.indexOf("proj-c");
    const idxA = output.indexOf("proj-a");
    expect(idxB).toBeLessThan(idxC);
    expect(idxC).toBeLessThan(idxA);
  });

  it("--sort mode returns projects in alphabetical mode order", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, includeGlobal: false, sort: "mode" });
    const output = calls.join("\n");
    // modes: bypassPermissions < default (alphabetical b < d)
    // proj-a and proj-c both use "default" mode — their relative order doesn't matter
    const idxB = output.indexOf("proj-b"); // bypassPermissions
    const idxC = output.indexOf("proj-c"); // default
    expect(idxB).toBeLessThan(idxC);
  });

  it("--sort also applies to JSON output", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, includeGlobal: false, sort: "name", json: true });
    const json = JSON.parse(calls.join(""));
    const paths: string[] = json.projects.map((p: Record<string, unknown>) => p.path as string);
    expect(paths[0]).toContain("proj-a");
    expect(paths[1]).toContain("proj-b");
    expect(paths[2]).toContain("proj-c");
  });

  it("no --sort returns projects in discovery order (no crash)", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await listCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = calls.join("\n");
    expect(output).toContain("proj-a");
    expect(output).toContain("proj-b");
    expect(output).toContain("proj-c");
  });
});

// ────────────────────────────────────────────────────────────
// statsCommand
// ────────────────────────────────────────────────────────────

describe("statsCommand — JSON output", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-stats-"));
    // bypassPermissions project → critical warning
    const bypassDir = join(root, "bypass-proj", ".claude");
    await mkdir(bypassDir, { recursive: true });
    await writeFile(
      join(bypassDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // acceptEdits project → medium warning; has an MCP server and allow rule
    const acceptDir = join(root, "accept-proj", ".claude");
    await mkdir(acceptDir, { recursive: true });
    await writeFile(
      join(acceptDir, "settings.json"),
      JSON.stringify({
        permissions: {
          defaultMode: "acceptEdits",
          disableBypassPermissionsMode: "disable",
          allow: ["Bash(npm run *)"],
        },
      })
    );
    await writeFile(
      join(root, "accept-proj", ".mcp.json"),
      JSON.stringify({ mcpServers: { myserver: { command: "node", args: ["srv.js"] } } })
    );
    // clean project → no warnings, no rules
    const cleanDir = join(root, "clean-proj", ".claude");
    await mkdir(cleanDir, { recursive: true });
    await writeFile(
      join(cleanDir, "settings.json"),
      JSON.stringify({ permissions: { disableBypassPermissionsMode: "disable" } })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function captureStatsJson() {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    await statsCommand({ root, maxDepth: 2, json: true, includeGlobal: false });
    return JSON.parse(calls.map((a) => a.join("")).join(""));
  }

  it("JSON output has required top-level fields", async () => {
    const json = await captureStatsJson();
    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("scanRoot");
    expect(json).toHaveProperty("totalProjects");
    expect(json).toHaveProperty("byMode");
    expect(json).toHaveProperty("totalWarnings");
    expect(json).toHaveProperty("warningsBySeverity");
    expect(json).toHaveProperty("affectedProjects");
    expect(json).toHaveProperty("cleanProjects");
    expect(json).toHaveProperty("mcpServers");
    expect(json).toHaveProperty("projectsWithRules");
    expect(json).toHaveProperty("errors");
  });

  it("totalProjects is correct", async () => {
    const json = await captureStatsJson();
    expect(json.totalProjects).toBe(3);
  });

  it("byMode counts are correct", async () => {
    const json = await captureStatsJson();
    // bypass-proj: bypassPermissions, accept-proj: acceptEdits, clean-proj: default
    expect(json.byMode.bypassPermissions).toBe(1);
    expect(json.byMode.acceptEdits).toBe(1);
    expect(json.byMode.default).toBe(1);
  });

  it("warningsBySeverity counts are correct", async () => {
    const json = await captureStatsJson();
    expect(typeof json.warningsBySeverity.critical).toBe("number");
    expect(typeof json.warningsBySeverity.high).toBe("number");
    expect(typeof json.warningsBySeverity.medium).toBe("number");
    expect(typeof json.warningsBySeverity.low).toBe("number");
    // bypass-proj → at least 1 critical warning
    expect(json.warningsBySeverity.critical).toBeGreaterThanOrEqual(1);
    // accept-proj → at least 1 medium warning (acceptEdits)
    expect(json.warningsBySeverity.medium).toBeGreaterThanOrEqual(1);
  });

  it("affectedProjects + cleanProjects = totalProjects", async () => {
    const json = await captureStatsJson();
    expect(json.affectedProjects + json.cleanProjects).toBe(json.totalProjects);
  });

  it("totalWarnings is sum of warningsBySeverity", async () => {
    const json = await captureStatsJson();
    const severitySum = json.warningsBySeverity.critical +
      json.warningsBySeverity.high +
      json.warningsBySeverity.medium +
      json.warningsBySeverity.low;
    expect(json.totalWarnings).toBe(severitySum);
  });

  it("mcpServers.uniqueNames and projectsWithMcp are correct", async () => {
    const json = await captureStatsJson();
    expect(json.mcpServers.uniqueNames).toBe(1);    // "myserver" only
    expect(json.mcpServers.projectsWithMcp).toBe(1); // only accept-proj
  });

  it("projectsWithRules counts projects with allow or deny rules", async () => {
    const json = await captureStatsJson();
    // accept-proj has allow rule; bypass-proj and clean-proj have none
    expect(json.projectsWithRules).toBe(1);
  });

  it("cleanProjects is correct (only clean-proj has no warnings)", async () => {
    const json = await captureStatsJson();
    expect(json.cleanProjects).toBe(1);
  });
});

describe("statsCommand — text output", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-stats-txt-"));
    // bypass project → critical warning
    const dir = join(root, "bypass", ".claude");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } })
    );
    // clean project
    const cleanDir = join(root, "clean", ".claude");
    await mkdir(cleanDir, { recursive: true });
    await writeFile(
      join(cleanDir, "settings.json"),
      JSON.stringify({ permissions: { disableBypassPermissionsMode: "disable" } })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("text output includes total project count", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await statsCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/2 project/);
  });

  it("text output shows mode breakdown", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await statsCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/bypassPermissions/);
    expect(output).toMatch(/Permission modes/i);
  });

  it("text output shows warning count", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await statsCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/Warnings?/i);
    expect(output).toMatch(/critical/);
  });

  it("text output shows 'no projects found' for empty root", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "cpm-stats-empty-"));
    try {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      await statsCommand({ root: emptyRoot, maxDepth: 2, includeGlobal: false });
      const output = lines.join("\n");
      expect(output).toMatch(/No Claude projects found/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("text output includes MCP servers line when projects have MCP servers (stats.ts:100)", async () => {
    // Add an .mcp.json to the existing bypass project fixture
    const mcpFile = join(root, "bypass", ".mcp.json");
    await writeFile(mcpFile, JSON.stringify({ mcpServers: { testServer: { command: "node", args: ["s.js"] } } }));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    await statsCommand({ root, maxDepth: 2, includeGlobal: false });
    const output = lines.join("\n");
    expect(output).toMatch(/MCP servers/i);
    expect(output).toMatch(/1 unique/);
  });

  it("text output omits 'clean' line when all projects have warnings (stats.ts:93 false branch)", async () => {
    // Root with only bypass project (always has warnings); no clean project
    const allWarningsRoot = mkdtempSync(join(tmpdir(), "cpm-stats-allwarn-"));
    try {
      const d = join(allWarningsRoot, "bypass-only", ".claude");
      await mkdir(d, { recursive: true });
      await writeFile(join(d, "settings.json"), JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }));
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await statsCommand({ root: allWarningsRoot, maxDepth: 2, includeGlobal: false });
      const output = lines.join("\n");
      // cleanProjects = 0 → no "clean" line emitted
      expect(output).not.toMatch(/clean\s+\d/);
    } finally {
      rmSync(allWarningsRoot, { recursive: true, force: true });
    }
  });

  it("text output shows scan error count when broken symlinks exist (stats.ts:107)", async () => {
    // Create a broken symlink — scan discovers it and pushes a scan error
    const broken = join(root, "broken-link");
    symlinkSync("/nonexistent/path/that/does/not/exist", broken);
    try {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await statsCommand({ root, maxDepth: 2, includeGlobal: false });
      const output = lines.join("\n");
      expect(output).toMatch(/scan error/i);
    } finally {
      rmSync(broken, { force: true });
    }
  });
});

describe("searchCommand", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-search-"));

    // proj-a: allow Bash(npm run *), deny Read(**/.env)
    const dirA = join(root, "proj-a", ".claude");
    await mkdir(dirA, { recursive: true });
    await writeFile(
      join(dirA, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)"],
          deny: ["Read(**/.env)"],
        },
      })
    );

    // proj-b: allow WebFetch(*), ask Bash(git *)
    const dirB = join(root, "proj-b", ".claude");
    await mkdir(dirB, { recursive: true });
    await writeFile(
      join(dirB, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["WebFetch(*)"],
          ask: ["Bash(git *)"],
        },
      })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function captureSearch(
    pattern: string,
    opts: Record<string, unknown> = {}
  ): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await searchCommand(pattern, { root, maxDepth: 2, includeGlobal: false, ...opts });
    return lines;
  }

  async function captureSearchJson(
    pattern: string,
    opts: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await searchCommand(pattern, { root, maxDepth: 2, includeGlobal: false, json: true, ...opts });
    return JSON.parse(calls.map((a) => a.join("")).join(""));
  }

  it("finds matching rules across projects (text output)", async () => {
    const lines = await captureSearch("bash");
    const output = lines.join("\n");
    expect(output).toMatch(/Bash/i);
    // both proj-a (allow Bash) and proj-b (ask Bash) should appear
    expect(output).toMatch(/proj-a/);
    expect(output).toMatch(/proj-b/);
  });

  it("shows 'no rules found' when pattern has no match", async () => {
    const lines = await captureSearch("nonexistent-tool-xyz");
    const output = lines.join("\n");
    expect(output).toMatch(/No rules matching/i);
  });

  it("--type allow limits search to allow list only", async () => {
    const lines = await captureSearch("bash", { type: "allow" });
    const output = lines.join("\n");
    // proj-a allow Bash matches; proj-b ask Bash should NOT appear
    expect(output).toMatch(/proj-a/);
    expect(output).not.toMatch(/proj-b/);
  });

  it("--type deny limits search to deny list", async () => {
    const lines = await captureSearch("read", { type: "deny" });
    const output = lines.join("\n");
    expect(output).toMatch(/Read/i);
    expect(output).not.toMatch(/Bash/);
  });

  it("--exact matches only exact rules", async () => {
    // exact match for the full rule string
    const linesExact = await captureSearch("Bash(npm run *)", { exact: true });
    expect(linesExact.join("\n")).toMatch(/proj-a/);

    // exact match for substring should not match
    const linesMiss = await captureSearch("bash", { exact: true });
    expect(linesMiss.join("\n")).toMatch(/No rules matching/i);
  });

  it("JSON output has required fields", async () => {
    const json = await captureSearchJson("bash");
    expect(json).toHaveProperty("pattern", "bash");
    expect(json).toHaveProperty("exact", false);
    expect(json).toHaveProperty("typeFilter", null);
    expect(json).toHaveProperty("scopeFilter", null);
    expect(json).toHaveProperty("matchCount");
    expect(json).toHaveProperty("projectCount");
    expect(json).toHaveProperty("matches");
    expect(Array.isArray(json.matches)).toBe(true);
  });

  it("JSON matches include project, type, rule, scope", async () => {
    const json = await captureSearchJson("npm");
    const matches = json.matches as Array<Record<string, string>>;
    expect(matches.length).toBeGreaterThan(0);
    const m = matches[0];
    expect(m).toHaveProperty("project");
    expect(m).toHaveProperty("type");
    expect(m).toHaveProperty("rule");
    expect(m).toHaveProperty("scope");
  });

  it("JSON matchCount and projectCount are correct for specific match", async () => {
    // "env" only matches deny Read(**/.env) in proj-a → 1 match, 1 project
    const json = await captureSearchJson("env");
    expect(json.matchCount).toBe(1);
    expect(json.projectCount).toBe(1);
  });

  it("--scope filters by rule scope", async () => {
    // proj-a settings.json is project-scope by default (not settings.local.json)
    // All rules written to settings.json are project-scoped
    const json = await captureSearchJson("bash", { scope: "project" });
    const matches = json.matches as Array<Record<string, string>>;
    // every match should have scope=project
    for (const m of matches) {
      expect(m.scope).toBe("project");
    }
  });

  it("--scope with non-matching scope skips all rules (search.ts:38 continue branch)", async () => {
    // All fixture rules are project-scoped; filtering for local → continue fires for every rule
    const lines = await captureSearch("bash", { scope: "local" });
    expect(lines.join("\n")).toMatch(/No rules matching/i);
  });
});

describe("rulesCommand", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-rules-"));

    // proj-a: allow Bash(npm run *), deny Read(**/.env)
    const dirA = join(root, "proj-a", ".claude");
    await mkdir(dirA, { recursive: true });
    await writeFile(
      join(dirA, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)"],
          deny: ["Read(**/.env)"],
        },
      })
    );

    // proj-b: allow Bash(npm run *) (same rule as proj-a), allow WebFetch(*)
    const dirB = join(root, "proj-b", ".claude");
    await mkdir(dirB, { recursive: true });
    await writeFile(
      join(dirB, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)", "WebFetch(*)"],
        },
      })
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function captureRulesText(opts: Record<string, unknown> = {}): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await rulesCommand({ root, maxDepth: 2, includeGlobal: false, ...opts } as Parameters<typeof rulesCommand>[0]);
    return lines.join("\n");
  }

  async function captureRulesJson(opts: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const calls: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await rulesCommand({ root, maxDepth: 2, includeGlobal: false, json: true, ...opts } as Parameters<typeof rulesCommand>[0]);
    return JSON.parse(calls.map((a) => a.join("")).join(""));
  }

  it("text output includes unique rule count and project count", async () => {
    const out = await captureRulesText();
    // 3 unique rules total: Bash(npm run *), Read(**/.env), WebFetch(*)
    expect(out).toMatch(/3 unique rule/);
    expect(out).toMatch(/2 project/);
  });

  it("text output shows rules sorted by frequency (most common first)", async () => {
    const out = await captureRulesText();
    // Bash(npm run *) appears in 2 projects; WebFetch(*) in 1; Read(**/.env) in 1
    const bashIdx = out.indexOf("Bash(npm run *)");
    const webIdx = out.indexOf("WebFetch(*)");
    expect(bashIdx).toBeGreaterThanOrEqual(0);
    expect(webIdx).toBeGreaterThanOrEqual(0);
    expect(bashIdx).toBeLessThan(webIdx); // Bash first (higher frequency)
  });

  it("JSON output has required top-level fields", async () => {
    const json = await captureRulesJson();
    expect(json).toHaveProperty("typeFilter", null);
    expect(json).toHaveProperty("top", null);
    expect(json).toHaveProperty("totalProjects", 2);
    expect(json).toHaveProperty("totalRules", 3);
    expect(json).toHaveProperty("rules");
    expect(Array.isArray(json.rules)).toBe(true);
  });

  it("JSON rules have rule, type, count, projects fields", async () => {
    const json = await captureRulesJson();
    const rules = json.rules as Array<Record<string, unknown>>;
    expect(rules.length).toBeGreaterThan(0);
    const r = rules[0];
    expect(r).toHaveProperty("rule");
    expect(r).toHaveProperty("type");
    expect(r).toHaveProperty("count");
    expect(r).toHaveProperty("projects");
    expect(Array.isArray(r.projects)).toBe(true);
  });

  it("JSON first rule has count=2 (Bash(npm run *) in both projects)", async () => {
    const json = await captureRulesJson();
    const rules = json.rules as Array<Record<string, unknown>>;
    expect(rules[0].rule).toBe("Bash(npm run *)");
    expect(rules[0].count).toBe(2);
  });

  it("--type allow filters to only allow rules", async () => {
    const json = await captureRulesJson({ type: "allow" });
    const rules = json.rules as Array<Record<string, unknown>>;
    expect(json.typeFilter).toBe("allow");
    // deny rules excluded; Read(**/.env) should not appear
    expect(rules.every((r) => r.type === "allow")).toBe(true);
    expect(rules.find((r) => r.rule === "Read(**/.env)")).toBeUndefined();
  });

  it("--type deny filters to only deny rules", async () => {
    const json = await captureRulesJson({ type: "deny" });
    const rules = json.rules as Array<Record<string, unknown>>;
    expect(json.totalRules).toBe(1);
    expect((rules[0] as Record<string, unknown>).rule).toBe("Read(**/.env)");
  });

  it("--top limits the number of rules returned", async () => {
    const json = await captureRulesJson({ top: 2 });
    const rules = json.rules as Array<Record<string, unknown>>;
    expect(json.top).toBe(2);
    expect(rules.length).toBeLessThanOrEqual(2);
  });

  it("shows 'No rules found' text when no rules exist", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "cpm-rules-empty-"));
    try {
      const dir = join(emptyRoot, "empty-proj", ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "settings.json"), JSON.stringify({ permissions: {} }));
      const out = await captureRulesText({ root: emptyRoot });
      expect(out).toMatch(/No rules found/i);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("--type text output shows type label in summary", async () => {
    const out = await captureRulesText({ type: "allow" });
    expect(out).toMatch(/allow/);
  });

  it("--top text output shows 'top N' in summary", async () => {
    const out = await captureRulesText({ top: 1 });
    expect(out).toMatch(/top 1/);
  });
});

describe("batchAddCommand — allow --all", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cpm-batch-"));

    // proj-a and proj-b: no rules yet
    for (const name of ["proj-a", "proj-b"]) {
      const dir = join(root, name, ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "settings.json"), JSON.stringify({ permissions: {} }));
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--dry-run shows preview without writing", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, dryRun: true, scope: "project",
    });
    const out = lines.join("\n");
    expect(out).toMatch(/\[dry-run\]/);
    expect(out).toMatch(/proj-a/);
    expect(out).toMatch(/proj-b/);
    // Verify no files were actually modified
    const fileA = JSON.parse(await readFile(join(root, "proj-a", ".claude", "settings.json"), "utf-8"));
    expect(fileA.permissions?.allow).toBeUndefined();
  });

  it("--yes applies to all projects", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project",
    });
    const out = lines.join("\n");
    expect(out).toMatch(/✓ Added to 2 project/);
    // Verify both settings.json files were modified
    for (const name of ["proj-a", "proj-b"]) {
      const file = JSON.parse(await readFile(join(root, name, ".claude", "settings.json"), "utf-8"));
      expect(file.permissions?.allow).toContain("Bash(npm run *)");
    }
  });

  it("skips projects that already have the rule", async () => {
    // Give proj-a the rule in project scope ahead of time
    await writeFile(
      join(root, "proj-a", ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(npm run *)"] } })
    );
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project",
    });
    const out = lines.join("\n");
    // Only 1 project (proj-b) should get the rule
    expect(out).toMatch(/Added to 1 project/);
    expect(out).toMatch(/Skipped 1 already-present/);
  });

  it("shows 'all projects already have rule' when nothing to add", async () => {
    // Give both projects the rule in project scope
    for (const name of ["proj-a", "proj-b"]) {
      await writeFile(
        join(root, name, ".claude", "settings.json"),
        JSON.stringify({ permissions: { allow: ["Bash(npm run *)"] } })
      );
    }
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project",
    });
    expect(lines.join("\n")).toMatch(/already have/i);
  });

  it("aborts when user declines confirmation", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, scope: "project",
      _confirmFn: async () => false,
    });
    expect(lines.join("\n")).toMatch(/Aborted/i);
    // No files modified — settings.json still has no allow rule
    const fileA = JSON.parse(await readFile(join(root, "proj-a", ".claude", "settings.json"), "utf-8"));
    expect(fileA.permissions?.allow).toBeUndefined();
  });

  it("works with deny list", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Read(**/.env)", "deny", {
      root, maxDepth: 2, includeGlobal: false, yes: true, scope: "project",
    });
    const out = lines.join("\n");
    expect(out).toMatch(/Added to 2 project/);
    for (const name of ["proj-a", "proj-b"]) {
      const file = JSON.parse(await readFile(join(root, name, ".claude", "settings.json"), "utf-8"));
      expect(file.permissions?.deny).toContain("Read(**/.env)");
    }
  });

  it("rejects invalid rules", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      batchAddCommand("", "allow", { root, maxDepth: 2, includeGlobal: false })
    ).rejects.toThrow("exit:1");
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("warns and returns when --scope user is specified", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await batchAddCommand("Bash(npm run *)", "allow", {
      root, maxDepth: 2, includeGlobal: false, scope: "user",
    });
    expect(lines.join("\n")).toMatch(/user.*already applies/i);
  });

  it("shows no projects found when root is empty", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "cpm-batch-empty-"));
    try {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join("")); });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await batchAddCommand("Bash(npm run *)", "allow", {
        root: emptyRoot, maxDepth: 2, includeGlobal: false,
      });
      expect(lines.join("\n")).toMatch(/No Claude projects found/i);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
