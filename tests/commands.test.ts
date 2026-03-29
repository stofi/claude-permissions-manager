/**
 * Integration tests for CLI commands: initCommand, exportCommand, listCommand, manage commands
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { readFile, mkdir } from "fs/promises";
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
      expect(project).toHaveProperty("warnings");
      expect(typeof project.warnings).toBe("number");
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
    expect(header).toBe("path,mode,allow_count,deny_count,ask_count,mcp_count,warnings,bypass_disabled");
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

  it("warnings is a number", async () => {
    const json = await captureListJson();
    for (const project of json.projects) {
      expect(typeof project.warnings).toBe("number");
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
