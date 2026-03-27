import { describe, it, expect } from "vitest";
import { join } from "path";
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
