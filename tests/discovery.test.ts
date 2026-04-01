import { describe, it, expect } from "vitest";
import { join } from "path";
import { existsSync } from "fs";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "fs/promises";
import { tmpdir, homedir } from "os";
import { fileURLToPath } from "url";
import { scan } from "../src/core/discovery.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

describe("scan — fixture directory", () => {
  it("discovers all .claude directories in the fixture tree", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const paths = result.projects.map((p) => p.rootPath);
    expect(paths).toContain(join(FIXTURES, "project-a"));
    expect(paths).toContain(join(FIXTURES, "project-b"));
    expect(paths).toContain(join(FIXTURES, "project-bypass"));
    expect(paths).toContain(join(FIXTURES, "invalid"));
  });

  it("returns sorted project paths", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const paths = result.projects.map((p) => p.rootPath);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("finds project-a with its settings files", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const projectA = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "project-a")
    );
    expect(projectA).toBeDefined();
    const localFile = projectA!.settingsFiles.find((f) => f.scope === "local");
    const projectFile = projectA!.settingsFiles.find((f) => f.scope === "project");
    expect(localFile?.exists).toBe(true);
    expect(projectFile?.exists).toBe(true);
  });

  it("finds project-a MCP file", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const projectA = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "project-a")
    );
    expect(projectA!.mcpFile).toBeDefined();
    expect(projectA!.mcpFile!.servers.length).toBe(2);
  });

  it("correctly marks project-b local settings as not present", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const projectB = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "project-b")
    );
    expect(projectB).toBeDefined();
    const localFile = projectB!.settingsFiles.find((f) => f.scope === "local");
    expect(localFile?.exists).toBe(false);
  });

  it("handles invalid JSON gracefully — project still included", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const invalidProject = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "invalid")
    );
    expect(invalidProject).toBeDefined();
    const projectFile = invalidProject!.settingsFiles.find(
      (f) => f.scope === "project"
    );
    expect(projectFile?.exists).toBe(true);
    expect(projectFile?.parsed).toBe(false);
  });

  it("detects bypassPermissions mode in project-bypass", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const bypass = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "project-bypass")
    );
    expect(bypass!.effectivePermissions.defaultMode).toBe("bypassPermissions");
    const crit = bypass!.effectivePermissions.warnings.find(
      (w) => w.severity === "critical"
    );
    expect(crit).toBeDefined();
  });

  it("respects maxDepth — doesn't scan deeper than specified", async () => {
    // Scan with depth 0 — should find nothing because .claude is 1 level deep
    const result = await scan({ root: FIXTURES, maxDepth: 0 });
    expect(result.projects).toHaveLength(0);
  });

  it("records scanRoot correctly", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    expect(result.scanRoot).toBe(FIXTURES);
  });

  it("respects includeGlobal=false — no global settings loaded", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3, includeGlobal: false });
    expect(result.global.user).toBeUndefined();
    expect(result.global.managed).toBeUndefined();
    expect(result.global.userMcpServers).toHaveLength(0);
  });

  it("scannedAt is a recent Date", async () => {
    const before = new Date();
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const after = new Date();
    expect(result.scannedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.scannedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("scanning an empty directory returns 0 projects and 0 errors", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "cpm-empty-test-"));
    try {
      const result = await scan({ root: emptyDir, maxDepth: 3, includeGlobal: false });
      expect(result.projects).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.scannedAt).toBeInstanceOf(Date);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("does not treat ~/.claude as a project when scanning from home directory", async () => {
    const home = homedir();
    const userClaudeDir = join(home, ".claude");
    // Only meaningful when ~/.claude actually exists (always true on Claude Code machines)
    if (!existsSync(userClaudeDir)) return;

    const result = await scan({ root: home, maxDepth: 1, includeGlobal: false });
    const homeAsProject = result.projects.find((p) => p.rootPath === home);
    expect(homeAsProject).toBeUndefined();
  });

  it("effectivePermissions.mcpServers has no duplicate server names per project", async () => {
    // Regression test: servers from .mcp.json and ~/.claude.json are deduplicated by name
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    for (const project of result.projects) {
      const names = project.effectivePermissions.mcpServers.map((s) => s.name);
      const unique = new Set(names);
      expect(names.length).toBe(unique.size);
    }
  });

  it("does not treat a symlink .claude→~/.claude as a project", async () => {
    const home = homedir();
    const userClaudeDir = join(home, ".claude");
    if (!existsSync(userClaudeDir)) return;

    // Create a temp dir with a .claude symlink pointing to ~/.claude
    const tmpDir = await mkdtemp(join(tmpdir(), "cpm-symlink-test-"));
    try {
      await symlink(userClaudeDir, join(tmpDir, ".claude"));
      const result = await scan({ root: tmpDir, maxDepth: 1, includeGlobal: false });
      // The symlink .claude should be excluded (it resolves to ~/.claude)
      expect(result.projects).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("records broken symlinks as scan errors", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cpm-broken-sym-"));
    try {
      // Create a symlink whose target does not exist
      await symlink("/nonexistent-cpm-broken-target", join(tmpDir, "broken-link"));
      const result = await scan({ root: tmpDir, maxDepth: 1, includeGlobal: false });
      // discovery.ts:76-82: broken symlink → errors.push({ path, error: "Broken symlink: ..." })
      expect(result.errors.length).toBeGreaterThan(0);
      const entry = result.errors.find((e) => e.path.includes("broken-link"));
      expect(entry).toBeDefined();
      expect(entry!.error).toMatch(/Broken symlink/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles symlink cycles without hanging", async () => {
    // discovery.ts:72: if (visitedInodes.has(st.ino)) continue; — cycle detection
    // All existing symlink tests use broken symlinks or .claude→~/.claude, but none
    // creates a true directory cycle (dir/link → dir) that exercises the inode-visited check.
    const root = await mkdtemp(join(tmpdir(), "cpm-cycle-"));
    try {
      // Create root/cycle-link → root (self-referential symlink cycle)
      await symlink(root, join(root, "cycle-link"));
      // Scan should complete without hanging; the cycle is silently skipped (no error pushed)
      const result = await scan({ root, maxDepth: 4, includeGlobal: false });
      expect(result.errors).toHaveLength(0);
      expect(result.projects).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips directories whose name is in SKIP_DIR_NAMES (e.g. node_modules)", async () => {
    // discovery.ts:61: if (SKIP_DIR_NAMES.has(entry.name)) continue;
    // A .claude dir nested inside node_modules should never be discovered.
    const root = await mkdtemp(join(tmpdir(), "cpm-skip-nm-"));
    try {
      await mkdir(join(root, "node_modules", "my-pkg", ".claude"), { recursive: true });
      await writeFile(
        join(root, "node_modules", "my-pkg", ".claude", "settings.json"),
        JSON.stringify({ permissions: {} })
      );
      const result = await scan({ root, maxDepth: 4, includeGlobal: false });
      expect(result.projects).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("follows symlinks to valid directories and discovers .claude inside them", async () => {
    // discovery.ts:73-74: successful symlink to directory — visitedInodes.add + resolvedPath = real
    // The code then recurses into the symlinked dir (via fullPath) and discovers .claude inside.
    const actual = await mkdtemp(join(tmpdir(), "cpm-sym-actual-"));
    const root = await mkdtemp(join(tmpdir(), "cpm-sym-root-"));
    try {
      await mkdir(join(actual, ".claude"), { recursive: true });
      await writeFile(join(actual, ".claude", "settings.json"), JSON.stringify({ permissions: {} }));
      await symlink(actual, join(root, "linked-project"));
      const result = await scan({ root, maxDepth: 2, includeGlobal: false });
      expect(result.projects).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    } finally {
      await rm(actual, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips symlinks that resolve to a regular file (not a directory)", async () => {
    // discovery.ts:71: if (!st.isDirectory()) continue; — after resolving symlink
    // A symlink pointing to a plain file is silently skipped (no error recorded).
    const root = await mkdtemp(join(tmpdir(), "cpm-sym-file-"));
    try {
      await writeFile(join(root, "regular.txt"), "hello");
      await symlink(join(root, "regular.txt"), join(root, "file-link"));
      const result = await scan({ root, maxDepth: 1, includeGlobal: false });
      expect(result.projects).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("merges effective permissions across local and project scopes for project-a", async () => {
    const result = await scan({ root: FIXTURES, maxDepth: 3 });
    const projectA = result.projects.find(
      (p) => p.rootPath === join(FIXTURES, "project-a")
    );
    const perms = projectA!.effectivePermissions;
    // local settings adds "Bash(npx *)" and sets mode "default"
    // project settings adds "Bash(npm run *)", "Read", "Edit(/src/**)" and mode "acceptEdits"
    // local scope wins for mode
    expect(perms.defaultMode).toBe("default");
    const rawAllow = perms.allow.map((r) => r.raw);
    expect(rawAllow).toContain("Bash(npx *)");   // from local
    expect(rawAllow).toContain("Bash(npm run *)"); // from project
    expect(rawAllow).toContain("Read");
    const rawDeny = perms.deny.map((r) => r.raw);
    expect(rawDeny).toContain("Read(**/.env)");
  });
});
