/**
 * CLI integration tests — spawn the actual dist/cli.js binary.
 *
 * These tests validate CLI-level concerns: argument parsing, --no-global,
 * --depth, exit codes, stderr error messages, and default behaviours.
 * They do NOT contribute to Vitest's V8 coverage (separate process), but
 * catch regressions that unit tests can't: Commander wiring, option defaults,
 * parseDepth, and the "no rule + no --all → exit 1" reset guard.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const FIXTURES = join(__dirname, "fixtures");

/** Spawn `node dist/cli.js ...args` and return stdout/stderr/status */
function run(args: string[], opts: { cwd?: string } = {}) {
  return spawnSync("node", [CLI, ...args], {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env },
    encoding: "utf-8",
    timeout: 15000,
  });
}

beforeAll(() => {
  execSync("npm run build", { cwd: ROOT, stdio: "ignore" });
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Version / help
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — version and help", () => {
  it("--version prints a semver string and exits 0", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help exits 0 and mentions cpm", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cpm");
  });

  it("list --help exits 0 and describes list command", () => {
    const r = run(["list", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("list");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — list command", () => {
  it("list --json outputs valid JSON with projects array", () => {
    const r = run(["list", "--json", "--root", FIXTURES, "--depth", "3", "--no-global"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(Array.isArray(json.projects)).toBe(true);
    expect(json.projects.length).toBeGreaterThan(0);
  });

  it("list --json --no-global excludes global scope allow rules (cli.ts --no-global wiring)", () => {
    const r = run(["list", "--json", "--root", FIXTURES, "--depth", "3", "--no-global"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    // When --no-global is passed, effective allow/deny/ask rules only come from local/project scope
    for (const p of json.projects) {
      const globalAllowRules = (p.allow as { rule: string; scope: string }[]).filter(
        (r) => r.scope === "user" || r.scope === "managed"
      );
      expect(globalAllowRules).toHaveLength(0);
    }
  });

  it("list --json --depth 1 limits scan depth (cli.ts:parseDepth)", () => {
    const r = run(["list", "--json", "--root", FIXTURES, "--depth", "1", "--no-global"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    // Fixtures are nested at depth 1, so all should still be found
    expect(Array.isArray(json.projects)).toBe(true);
  });

  it("list --json --depth invalid falls back to default depth (cli.ts:parseDepth fallback)", () => {
    const r = run(["list", "--json", "--root", FIXTURES, "--depth", "not-a-number", "--no-global"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(Array.isArray(json.projects)).toBe(true);
  });

  it("default action (non-TTY) calls list command (cli.ts:44)", () => {
    // When piped / non-TTY and no subcommand, the default action runs listCommand.
    // spawnSync uses a pipe (not a TTY), so stdout.isTTY is false.
    const r = run(["--root", FIXTURES, "--depth", "3", "--no-global"]);
    expect(r.status).toBe(0);
    // Output is table format (not JSON) since no --json flag
    expect(r.stdout.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// show command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — show command", () => {
  it("show --json <path> outputs project JSON (cli.ts:84-85)", () => {
    const r = run(["show", "--json", "--no-global", join(FIXTURES, "project-a")]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    // show --json output shape: {path, effectivePermissions, settingsFiles, mcpServers, ...}
    expect(json).toHaveProperty("path");
    expect(json).toHaveProperty("effectivePermissions");
    expect(json).toHaveProperty("mcpServers");
    expect(json).toHaveProperty("warnings");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// audit command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — audit command", () => {
  it("audit --json outputs issues array (cli.ts:96-103)", () => {
    const r = run(["audit", "--json", "--root", FIXTURES, "--depth", "3", "--no-global"]);
    // exit 0 (no critical issues) or 1 (issues present) or 2 (critical) are all valid
    const json = JSON.parse(r.stdout);
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it("audit --json --exit-code exits 0 when no issues (cli.ts:exitCode option)", () => {
    // Use an empty temp dir — no projects → no issues → exit 0
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-empty-"));
    try {
      const r = run(["audit", "--json", "--root", tmpDir, "--depth", "1", "--no-global", "--exit-code"]);
      expect(r.status).toBe(0);
      const json = JSON.parse(r.stdout);
      expect(json.issues).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diff command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — diff command", () => {
  it("diff --json <path1> <path2> outputs JSON diff (cli.ts:111-113)", () => {
    const r = run([
      "diff", "--json", "--no-global",
      join(FIXTURES, "project-a"),
      join(FIXTURES, "project-b"),
    ]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json).toHaveProperty("projectA");
    expect(json).toHaveProperty("projectB");
    expect(json).toHaveProperty("identical");
    expect(json).toHaveProperty("allow");
    expect(json.allow).toHaveProperty("onlyInA");
    expect(json.allow).toHaveProperty("onlyInB");
    expect(json.allow).toHaveProperty("inBoth");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// export command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — export command", () => {
  it("export --format json outputs valid JSON (cli.ts:189-198)", () => {
    const r = run(["export", "--format", "json", "--root", FIXTURES, "--depth", "3", "--no-global"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json).toHaveProperty("projects");
    expect(json).toHaveProperty("globalSettings");
  });

  it("export --format csv outputs CSV header (cli.ts:189-198)", () => {
    const r = run(["export", "--format", "csv", "--root", FIXTURES, "--depth", "3", "--no-global"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^path,mode,allow_count/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// completion command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — completion command", () => {
  it("completion bash outputs bash completion script (cli.ts:228-230)", () => {
    const r = run(["completion", "bash"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("complete -F");
  });

  it("completion zsh outputs zsh completion script", () => {
    const r = run(["completion", "zsh"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#compdef");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manage commands (allow / deny / ask / reset / mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — allow command", () => {
  it("allow adds rule to settings file (cli.ts:122-125)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-allow-"));
    try {
      const r = run(["allow", "Read", "--project", tmpDir, "--scope", "project"]);
      expect(r.status).toBe(0);
      const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(settings.permissions.allow).toContain("Read");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("allow --dry-run does not write file (cli.ts:122-125 dryRun forwarding)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-dry-"));
    try {
      const r = run(["allow", "Read", "--project", tmpDir, "--scope", "project", "--dry-run"]);
      expect(r.status).toBe(0);
      // No .claude directory should be created in dry-run mode
      expect(() => readFileSync(join(tmpDir, ".claude", "settings.json"))).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("CLI — deny command", () => {
  it("deny adds rule to deny list (cli.ts:133-136)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-deny-"));
    try {
      const r = run(["deny", "Bash(rm -rf *)", "--project", tmpDir, "--scope", "project"]);
      expect(r.status).toBe(0);
      const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(settings.permissions.deny).toContain("Bash(rm -rf *)");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("CLI — reset command", () => {
  it("reset with no rule and no --all exits 1 with error (cli.ts:163-166)", () => {
    const r = run(["reset", "--scope", "project"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Provide a rule.*--all/i);
  });

  it("reset <rule> removes rule from settings (cli.ts:161-162)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-reset-"));
    try {
      // Add a rule first, then remove it
      run(["allow", "Read", "--project", tmpDir, "--scope", "project"]);
      const r = run(["reset", "Read", "--project", tmpDir, "--scope", "project"]);
      expect(r.status).toBe(0);
      const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(settings.permissions?.allow ?? []).not.toContain("Read");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("CLI — mode command", () => {
  it("mode sets defaultMode in settings (cli.ts:176-179)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-mode-"));
    try {
      const r = run(["mode", "acceptEdits", "--project", tmpDir, "--scope", "project"]);
      expect(r.status).toBe(0);
      const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(settings.permissions.defaultMode).toBe("acceptEdits");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — error handling", () => {
  it("unknown command exits 1 with error message (cli.ts:32-36)", () => {
    const r = run(["unknowncommand"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown command");
    expect(r.stderr).toContain("unknowncommand");
  });

  it("export --format invalid exits 1 (cli.ts:parseAsync.catch propagates exit)", () => {
    const r = run(["export", "--format", "xml", "--root", FIXTURES, "--no-global"]);
    expect(r.status).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init command
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI — init command", () => {
  it("init creates settings.json from safe preset (cli.ts:209-212)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-init-"));
    try {
      const r = run(["init", "--project", tmpDir, "--preset", "safe", "--scope", "project"]);
      expect(r.status).toBe(0);
      const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
      expect(Array.isArray(settings.permissions.allow)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("init --dry-run does not create file (cli.ts:209-212 dryRun forwarding)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cpm-cli-init-dry-"));
    try {
      const r = run(["init", "--project", tmpDir, "--preset", "safe", "--dry-run"]);
      expect(r.status).toBe(0);
      expect(() => readFileSync(join(tmpDir, ".claude", "settings.json"))).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
