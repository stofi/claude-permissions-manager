import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { parseSettingsFile, parseMcpFile, parseClaudeJson, parseClaudeMdFile } from "../src/core/parser.js";

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

  it("returns readable=false when file exists but cannot be read (EACCES)", async () => {
    // parser.ts:44-54: readFile throws → { exists: true, readable: false, parsed: false }
    // Skip if running as root — root bypasses file permission checks
    if (process.getuid?.() === 0) return;
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-unreadable-"));
    const path = join(tmpDir, "settings.json");
    try {
      writeFileSync(path, "{}");
      chmodSync(path, 0o000); // remove all permissions
      const f = await parseSettingsFile(path, "local");
      expect(f.exists).toBe(true);
      expect(f.readable).toBe(false);
      expect(f.parsed).toBe(false);
    } finally {
      chmodSync(path, 0o644); // restore before cleanup
      rmSync(tmpDir, { recursive: true, force: true });
    }
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
    // github server has no headers field — parser.ts:146: c.headers ? ... : undefined
    expect(github!.headerNames).toBeUndefined();

    const fs = mcp.servers.find((s) => s.name === "filesystem");
    expect(fs).toBeDefined();
    expect(fs!.type).toBe("http");
    expect(fs!.url).toBe("https://mcp.example.com/fs");
    // header values must NOT be present
    expect(fs!.headerNames).toContain("Authorization");
    // filesystem server has no env field — parser.ts:145: c.env ? ... : undefined
    expect(fs!.envVarNames).toBeUndefined();
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

  it("returns parsed=false and empty servers for invalid JSON .mcp.json", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-mcp-invalid-"));
    writeFileSync(join(tmpDir, ".mcp.json"), "{ not valid json {{");
    try {
      const mcp = await parseMcpFile(tmpDir, "project");
      expect(mcp.exists).toBe(true);
      expect(mcp.parsed).toBe(false);
      expect(mcp.parseError).toBeDefined();
      expect(mcp.parseError).toMatch(/JSON/i);
      expect(mcp.servers).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns exists=true, parsed=false when .mcp.json cannot be read (parser.ts:106-115)", async () => {
    // parser.ts:108-115: readFile catch → { exists: true, parsed: false, parseError: String(err) }
    // No prior test exercises this branch — only the JSON-parse-error path was tested.
    if (process.getuid?.() === 0) return; // root bypasses file permissions
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-mcp-eacces-"));
    const mcpPath = join(tmpDir, ".mcp.json");
    try {
      writeFileSync(mcpPath, JSON.stringify({ mcpServers: { foo: { command: "run" } } }));
      chmodSync(mcpPath, 0o000);
      const mcp = await parseMcpFile(tmpDir, "project");
      expect(mcp.exists).toBe(true);
      expect(mcp.parsed).toBe(false);
      expect(mcp.parseError).toMatch(/EACCES|permission denied/i);
      expect(mcp.servers).toHaveLength(0);
    } finally {
      chmodSync(mcpPath, 0o644);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns parsed=false when .mcp.json contains valid JSON that fails McpFileSchema (parser.ts:131-132,155-156)", async () => {
    // parser.ts:131: McpFileSchema.safeParse(json) → success=false for non-object JSON (e.g. array)
    // parser.ts:132: rawData = json (fallback) → mcpServers=undefined → servers=[]
    // parser.ts:155: parsed: result.success = false
    // parser.ts:156: parseError: result.error.message
    // No prior test triggers the schema-fail path — all prior tests either fail JSON parse first
    // or succeed schema validation. Passing "[1,2,3]" (valid JSON, wrong shape) covers this.
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-mcp-schema-fail-"));
    writeFileSync(join(tmpDir, ".mcp.json"), "[1, 2, 3]");
    try {
      const mcp = await parseMcpFile(tmpDir, "project");
      expect(mcp.exists).toBe(true);
      expect(mcp.parsed).toBe(false);     // schema validation failed
      expect(mcp.parseError).toBeDefined(); // error message from Zod
      expect(mcp.servers).toHaveLength(0); // no servers extractable from array
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────
// parseClaudeJson
// ────────────────────────────────────────────────────────────

describe("parseClaudeJson", () => {
  let tmpDir: string;
  let claudeJsonPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cpm-claude-json-test-"));
    claudeJsonPath = join(tmpDir, ".claude.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty results when file does not exist", async () => {
    const result = await parseClaudeJson(join(tmpDir, "nonexistent.json"));
    expect(result.globalServers).toHaveLength(0);
    expect(result.projectServers.size).toBe(0);
  });

  it("returns empty results for invalid JSON", async () => {
    writeFileSync(claudeJsonPath, "not json {{{");
    const result = await parseClaudeJson(claudeJsonPath);
    expect(result.globalServers).toHaveLength(0);
    expect(result.projectServers.size).toBe(0);
  });

  it("returns empty results when file exists but cannot be read (EACCES) (parser.ts:191-194)", async () => {
    // parser.ts:191-194: readFile throws → catch → return empty; warn to stderr
    // Skip if running as root — root bypasses file permission checks
    if (process.getuid?.() === 0) return;
    writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: { s: { command: "x", args: [] } } }));
    chmodSync(claudeJsonPath, 0o000);
    try {
      const result = await parseClaudeJson(claudeJsonPath);
      expect(result.globalServers).toHaveLength(0);
      expect(result.projectServers.size).toBe(0);
    } finally {
      chmodSync(claudeJsonPath, 0o644);
    }
  });

  it("returns empty servers array for project entry with no mcpServers field (parser.ts:231)", async () => {
    // parser.ts:231: if (projectData.mcpServers) false branch — project has approvals but no servers
    const projectPath = "/home/user/some-project";
    writeFileSync(claudeJsonPath, JSON.stringify({
      projects: {
        [projectPath]: {
          mcpServerApprovals: { someServer: "approved" },
          // no mcpServers field
        },
      },
    }));
    const result = await parseClaudeJson(claudeJsonPath);
    // projectServers.set(projectPath, servers) runs regardless — empty array not undefined
    expect(result.projectServers.get(projectPath)).toEqual([]);
    expect(result.globalServers).toHaveLength(0);
  });

  it("parses global MCP servers with all fields", async () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "secret" },
        },
        webservice: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer token" },
        },
      },
    }));

    const result = await parseClaudeJson(claudeJsonPath);
    expect(result.globalServers).toHaveLength(2);

    const github = result.globalServers.find((s) => s.name === "github");
    expect(github).toBeDefined();
    expect(github!.command).toBe("npx");
    expect(github!.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(github!.envVarNames).toContain("GITHUB_TOKEN");
    expect(github!.scope).toBe("user");
    expect(github!.approvalState).toBe("approved");

    const ws = result.globalServers.find((s) => s.name === "webservice");
    expect(ws).toBeDefined();
    expect(ws!.type).toBe("http");
    expect(ws!.url).toBe("https://mcp.example.com");
    expect(ws!.headerNames).toContain("Authorization");
  });

  it("parses per-project MCP servers with args and approval states", async () => {
    const projectPath = "/home/user/my-project";
    writeFileSync(claudeJsonPath, JSON.stringify({
      projects: {
        [projectPath]: {
          mcpServers: {
            github: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: { GITHUB_TOKEN: "secret" },
            },
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            },
            denied: {
              command: "npx",
              args: ["-y", "some-server"],
            },
          },
          mcpServerApprovals: {
            github: "approved",
            denied: "denied",
            // filesystem is absent → defaults to pending
          },
        },
      },
    }));

    const result = await parseClaudeJson(claudeJsonPath);
    const servers = result.projectServers.get(projectPath);
    expect(servers).toBeDefined();
    expect(servers!).toHaveLength(3);

    const github = servers!.find((s) => s.name === "github");
    expect(github!.approvalState).toBe("approved");
    expect(github!.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(github!.envVarNames).toContain("GITHUB_TOKEN");

    const filesystem = servers!.find((s) => s.name === "filesystem");
    expect(filesystem!.approvalState).toBe("pending");
    expect(filesystem!.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);

    const denied = servers!.find((s) => s.name === "denied");
    expect(denied!.approvalState).toBe("denied");
    expect(denied!.args).toEqual(["-y", "some-server"]);
  });

  it("assigns scope=user to global servers and scope=local to project servers", async () => {
    const projectPath = "/home/user/my-project";
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { globalServer: { command: "npx", args: [] } },
      projects: {
        [projectPath]: {
          mcpServers: { projectServer: { command: "node", args: [] } },
        },
      },
    }));

    const result = await parseClaudeJson(claudeJsonPath);
    expect(result.globalServers[0].scope).toBe("user");
    expect(result.projectServers.get(projectPath)![0].scope).toBe("local");
  });

  it("handles file with only projects section and no global servers", async () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      projects: {
        "/some/path": {
          mcpServers: { server: { command: "cmd", args: [] } },
        },
      },
    }));

    const result = await parseClaudeJson(claudeJsonPath);
    expect(result.globalServers).toHaveLength(0);
    expect(result.projectServers.size).toBe(1);
  });

  it("writes warning to stderr for invalid JSON (parser.ts:201)", async () => {
    // parser.ts:201: process.stderr.write(`Warning: ${claudeJsonPath} contains invalid JSON — ...`)
    // Prior test only checks that results are empty; stderr message is never asserted.
    writeFileSync(claudeJsonPath, "not json {{{");
    const stderrSpy = vi.spyOn(process.stderr, "write");
    try {
      await parseClaudeJson(claudeJsonPath);
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toMatch(/contains invalid JSON/);
      expect(output).toMatch(/MCP approval states not loaded/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("writes warning to stderr when file cannot be read (parser.ts:192)", async () => {
    // parser.ts:192: process.stderr.write(`Warning: could not read ${claudeJsonPath}: ${err.message}`)
    // Prior EACCES test only checks return value; stderr message is never asserted.
    if (process.getuid?.() === 0) return; // root bypasses permission checks
    writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: {} }));
    chmodSync(claudeJsonPath, 0o000);
    const stderrSpy = vi.spyOn(process.stderr, "write");
    try {
      await parseClaudeJson(claudeJsonPath);
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toMatch(/could not read/);
    } finally {
      chmodSync(claudeJsonPath, 0o644);
      stderrSpy.mockRestore();
    }
  });

  it("uses raw JSON when ClaudeJsonSchema validation fails for non-object input (parser.ts:205-206)", async () => {
    // parser.ts:205: ClaudeJsonSchema.safeParse(json) → success=false for non-object JSON (e.g. array)
    // parser.ts:206: data = json (fallback) — the else branch of `result.success ? ... : ...`
    // Since data is an array, data?.mcpServers and data?.projects are both undefined,
    // so globalServers=[] and projectServers is empty. All prior tests either fail JSON parse
    // or succeed schema validation — this is the only test that hits the schema-fail fallback.
    writeFileSync(claudeJsonPath, "[1, 2, 3]"); // valid JSON but wrong shape for ClaudeJsonSchema
    const result = await parseClaudeJson(claudeJsonPath);
    expect(result.globalServers).toHaveLength(0);  // no servers extractable from array
    expect(result.projectServers.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// parseClaudeMdFile
// ────────────────────────────────────────────────────────────

describe("parseClaudeMdFile", () => {
  let mdTmpDir: string;

  beforeEach(() => {
    mdTmpDir = mkdtempSync(join(tmpdir(), "cpm-parser-md-test-"));
  });

  afterEach(() => {
    rmSync(mdTmpDir, { recursive: true, force: true });
  });

  it("returns exists=true with lineCount when file exists", async () => {
    const filePath = join(mdTmpDir, "CLAUDE.md");
    writeFileSync(filePath, "# Title\nLine two\nLine three");
    const result = await parseClaudeMdFile(filePath, "project");
    expect(result.exists).toBe(true);
    expect(result.scope).toBe("project");
    expect(result.path).toBe(filePath);
    expect(result.lineCount).toBe(3);
  });

  it("returns exists=false when file does not exist", async () => {
    const filePath = join(mdTmpDir, "MISSING.md");
    const result = await parseClaudeMdFile(filePath, "local");
    expect(result.exists).toBe(false);
    expect(result.scope).toBe("local");
    expect(result.path).toBe(filePath);
    expect(result.lineCount).toBeUndefined();
  });

  it("returns lineCount=0 when file exists but cannot be read (parser.ts:29-30)", async () => {
    // parser.ts:29-30: countLines() catch block returns 0 on readFile error.
    // fileExists() uses access(F_OK) which succeeds for chmod-000 files (file exists).
    // countLines readFile then fails with EACCES → catch returns 0 instead of undefined.
    if (process.getuid?.() === 0) return; // root bypasses file permissions
    const filePath = join(mdTmpDir, "CLAUDE.md");
    writeFileSync(filePath, "Line one\nLine two\n");
    chmodSync(filePath, 0o000);
    try {
      const result = await parseClaudeMdFile(filePath, "project");
      expect(result.exists).toBe(true);
      expect(result.lineCount).toBe(0); // catch block returns 0
    } finally {
      chmodSync(filePath, 0o644);
    }
  });
});
