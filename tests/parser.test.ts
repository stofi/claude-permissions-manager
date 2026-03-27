import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { parseSettingsFile, parseMcpFile } from "../src/core/parser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

// ────────────────────────────────────────────────────────────
// parseSettingsFile
// ────────────────────────────────────────────────────────────

describe("parseSettingsFile", () => {
  it("parses a valid settings.json", async () => {
    const f = await parseSettingsFile(
      join(FIXTURES, "project-a/.claude/settings.json"),
      "project"
    );
    expect(f.exists).toBe(true);
    expect(f.readable).toBe(true);
    expect(f.parsed).toBe(true);
    expect(f.scope).toBe("project");
    expect(f.data?.permissions?.allow).toContain("Bash(npm run *)");
    expect(f.data?.permissions?.deny).toContain("Read(**/.env)");
    expect(f.data?.permissions?.ask).toContain("Bash(git push *)");
    expect(f.data?.permissions?.defaultMode).toBe("acceptEdits");
    expect(f.data?.env?.NODE_ENV).toBe("development");
  });

  it("parses settings.local.json", async () => {
    const f = await parseSettingsFile(
      join(FIXTURES, "project-a/.claude/settings.local.json"),
      "local"
    );
    expect(f.exists).toBe(true);
    expect(f.parsed).toBe(true);
    expect(f.data?.permissions?.allow).toContain("Bash(npx *)");
    expect(f.data?.permissions?.defaultMode).toBe("default");
  });

  it("returns exists=false for a missing file", async () => {
    const f = await parseSettingsFile("/nonexistent/path/settings.json", "project");
    expect(f.exists).toBe(false);
    expect(f.readable).toBe(false);
    expect(f.parsed).toBe(false);
    expect(f.data).toBeUndefined();
  });

  it("returns parsed=false for invalid JSON", async () => {
    const f = await parseSettingsFile(
      join(FIXTURES, "invalid/.claude/settings.json"),
      "project"
    );
    expect(f.exists).toBe(true);
    expect(f.readable).toBe(true);
    expect(f.parsed).toBe(false);
    expect(f.parseError).toBeDefined();
    expect(f.parseError).toMatch(/JSON/i);
  });

  it("correctly identifies the scope on the returned object", async () => {
    const f = await parseSettingsFile(
      join(FIXTURES, "project-a/.claude/settings.json"),
      "user"
    );
    expect(f.scope).toBe("user");
  });

  it("parses bypass permissions fixture", async () => {
    const f = await parseSettingsFile(
      join(FIXTURES, "project-bypass/.claude/settings.json"),
      "project"
    );
    expect(f.data?.permissions?.defaultMode).toBe("bypassPermissions");
    expect(f.data?.permissions?.allow).toContain("Bash");
  });

  it("returns parsed=true with parseError when JSON valid but schema fails", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-parser-test-"));
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir);
    const path = join(claudeDir, "settings.json");
    writeFileSync(path, JSON.stringify({ permissions: { allow: 42 } }));
    try {
      const f = await parseSettingsFile(path, "project");
      expect(f.exists).toBe(true);
      expect(f.readable).toBe(true);
      expect(f.parsed).toBe(true); // JSON parsed OK, schema failed
      expect(f.parseError).toBeDefined();
      expect(f.parseError).toMatch(/schema/i);
      expect(f.data).toBeDefined(); // raw data still returned
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// parseMcpFile
// ────────────────────────────────────────────────────────────

describe("parseMcpFile", () => {
  it("parses a valid .mcp.json", async () => {
    const mcp = await parseMcpFile(join(FIXTURES, "project-a"), "project");
    expect(mcp.exists).toBe(true);
    expect(mcp.parsed).toBe(true);
    expect(mcp.servers).toHaveLength(2);

    const github = mcp.servers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    expect(github!.type).toBe("stdio");
    expect(github!.command).toBe("npx");
    expect(github!.args).toContain("-y");
    // env values must NOT be present, only the key names
    expect(github!.envVarNames).toContain("GITHUB_TOKEN");

    const fs = mcp.servers.find((s) => s.name === "filesystem");
    expect(fs).toBeDefined();
    expect(fs!.type).toBe("http");
    expect(fs!.url).toBe("https://mcp.example.com/fs");
    // header values must NOT be present
    expect(fs!.headerNames).toContain("Authorization");
  });

  it("returns exists=false when .mcp.json is not present", async () => {
    const mcp = await parseMcpFile(join(FIXTURES, "project-b"), "project");
    expect(mcp.exists).toBe(false);
    expect(mcp.servers).toHaveLength(0);
  });

  it("sets scope on each server", async () => {
    const mcp = await parseMcpFile(join(FIXTURES, "project-a"), "project");
    for (const server of mcp.servers) {
      expect(server.scope).toBe("project");
    }
  });

  it("approvalState defaults to pending for project-scoped servers", async () => {
    const mcp = await parseMcpFile(join(FIXTURES, "project-a"), "project");
    for (const server of mcp.servers) {
      expect(server.approvalState).toBe("pending");
    }
  });
});
