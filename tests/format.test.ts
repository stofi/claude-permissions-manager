import { describe, it, expect } from "vitest";
import {
  formatMode,
  formatWarning,
  formatProjectRow,
  formatProjectTable,
  formatEffectivePermissions,
} from "../src/utils/format.js";
import type {
  ClaudeProject,
  EffectivePermissions,
  SettingsFile,
  Warning,
} from "../src/core/types.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function makePerms(overrides: Partial<EffectivePermissions> = {}): EffectivePermissions {
  return {
    defaultMode: "default",
    allow: [],
    deny: [],
    ask: [],
    isBypassDisabled: false,
    mcpServers: [],
    envVarNames: [],
    additionalDirs: [],
    warnings: [],
    ...overrides,
  };
}

function makeProject(overrides: {
  rootPath?: string;
  settingsFiles?: SettingsFile[];
  perms?: Partial<EffectivePermissions>;
} = {}): ClaudeProject {
  return {
    rootPath: overrides.rootPath ?? "/home/user/my-project",
    claudeDir: (overrides.rootPath ?? "/home/user/my-project") + "/.claude",
    settingsFiles: overrides.settingsFiles ?? [],
    claudeMdFiles: [],
    effectivePermissions: makePerms(overrides.perms),
  };
}

function makeSettingsFile(overrides: Partial<SettingsFile>): SettingsFile {
  return {
    path: "/home/user/my-project/.claude/settings.json",
    scope: "project",
    exists: true,
    readable: true,
    parsed: true,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// formatMode
// ─────────────────────────────────────────────────────────────

describe("formatMode", () => {
  it("renders 'default' mode", () => {
    expect(stripAnsi(formatMode("default"))).toBe("default");
  });

  it("renders 'bypassPermissions' mode with 'bypass!' label", () => {
    // format.ts:11: bypassPermissions → "bypass!"
    expect(stripAnsi(formatMode("bypassPermissions"))).toBe("bypass!");
  });

  it("renders all known modes without throwing", () => {
    const modes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"] as const;
    for (const m of modes) {
      expect(() => formatMode(m)).not.toThrow();
      expect(typeof formatMode(m)).toBe("string");
    }
  });

  it("falls back to raw mode string for unknown mode (format.ts:31-32)", () => {
    // format.ts:31: MODE_LABELS[mode] ?? mode  (unknown key → undefined → mode)
    // format.ts:32: MODE_COLORS[mode] ?? chalk.white  (unknown key → chalk.white)
    const unknown = "unknownMode" as Parameters<typeof formatMode>[0];
    expect(stripAnsi(formatMode(unknown))).toBe("unknownMode");
  });
});

// ─────────────────────────────────────────────────────────────
// formatWarning
// ─────────────────────────────────────────────────────────────

describe("formatWarning", () => {
  it("includes severity prefix in uppercase for critical", () => {
    const w: Warning = { severity: "critical", message: "test msg" };
    const out = stripAnsi(formatWarning(w));
    expect(out).toContain("[CRITICAL]");
    expect(out).toContain("test msg");
  });

  it("includes severity prefix for high", () => {
    const out = stripAnsi(formatWarning({ severity: "high", message: "hi" }));
    expect(out).toContain("[HIGH]");
  });

  it("includes severity prefix for medium", () => {
    const out = stripAnsi(formatWarning({ severity: "medium", message: "med" }));
    expect(out).toContain("[MEDIUM]");
  });

  it("includes severity prefix for low", () => {
    const out = stripAnsi(formatWarning({ severity: "low", message: "lo" }));
    expect(out).toContain("[LOW]");
    expect(out).toContain("lo");
  });
});

// ─────────────────────────────────────────────────────────────
// formatProjectRow
// ─────────────────────────────────────────────────────────────

describe("formatProjectRow", () => {
  it("returns a non-empty string", () => {
    const row = formatProjectRow(makeProject());
    expect(typeof row).toBe("string");
    expect(row.length).toBeGreaterThan(0);
  });

  it("shows deny count in output", () => {
    const project = makeProject({
      perms: {
        deny: [{ tool: "Bash", raw: "Bash", scope: "project" }],
      },
    });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("1 deny");
  });

  it("shows zero deny when no deny rules (format.ts:56 gray branch)", () => {
    const row = stripAnsi(formatProjectRow(makeProject()));
    expect(row).toContain("0 deny");
  });

  it("shows ask count when ask rules present (format.ts:58 yellow branch)", () => {
    const project = makeProject({
      perms: { ask: [{ tool: "Read", raw: "Read", scope: "project" }] },
    });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("1 ask");
  });

  it("shows zero ask when no ask rules (format.ts:58 gray branch)", () => {
    const row = stripAnsi(formatProjectRow(makeProject()));
    expect(row).toContain("0 ask");
  });

  it("includes [locked] when isBypassDisabled=true (format.ts:59)", () => {
    const project = makeProject({ perms: { isBypassDisabled: true } });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("[locked]");
  });

  it("omits [locked] when isBypassDisabled=false (format.ts:59 empty string branch)", () => {
    const row = stripAnsi(formatProjectRow(makeProject()));
    expect(row).not.toContain("[locked]");
  });

  it("includes warning indicator when warnings present (format.ts:60-62)", () => {
    const project = makeProject({
      perms: { warnings: [{ severity: "high", message: "test" }] },
    });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("⚠");
  });

  it("omits warning indicator when no warnings (format.ts:60-62 empty string branch)", () => {
    const row = stripAnsi(formatProjectRow(makeProject()));
    expect(row).not.toContain("⚠");
  });

  it("truncates very long paths with leading ellipsis (truncatePath format.ts:42-43)", () => {
    const longPath = "/home/user/" + "a".repeat(60);
    const project = makeProject({ rootPath: longPath });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("…");
  });

  it("does not truncate paths within limit (truncatePath format.ts:42 <=maxLen branch)", () => {
    const shortPath = "/home/user/short";
    const project = makeProject({ rootPath: shortPath });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).not.toContain("…");
  });

  it("falls back to raw mode string for unknown mode (format.ts:51-52 — MODE_LABELS/COLORS null branch)", () => {
    // format.ts:51: MODE_LABELS[perms.defaultMode] ?? perms.defaultMode — unknown key → raw string
    // format.ts:52: MODE_COLORS[perms.defaultMode] ?? chalk.white — unknown key → chalk.white
    // Exercises the null branches of both ?? operators, which are skipped for all known modes.
    const project = makeProject({ perms: { defaultMode: "futureModeX" as Parameters<typeof formatMode>[0] } });
    const row = stripAnsi(formatProjectRow(project));
    expect(row).toContain("futureModeX");
  });
});

// ─────────────────────────────────────────────────────────────
// formatProjectTable
// ─────────────────────────────────────────────────────────────

describe("formatProjectTable", () => {
  it("returns a table with header, divider, and a row per project", () => {
    const projects = [makeProject(), makeProject({ rootPath: "/home/user/proj-b" })];
    const table = stripAnsi(formatProjectTable(projects));
    expect(table).toContain("Project");
    expect(table).toContain("Mode");
    expect(table).toContain("Allow");
    expect(table).toContain("Deny");
    // divider
    expect(table).toContain("─");
    // both rows
    expect(table).toContain("my-project");
    expect(table).toContain("proj-b");
  });

  it("works with empty project list (header + divider only)", () => {
    const table = stripAnsi(formatProjectTable([]));
    expect(table).toContain("Project");
    expect(table).toContain("─");
    const lines = table.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2); // header + divider
  });
});

// ─────────────────────────────────────────────────────────────
// formatEffectivePermissions — settings file status branches
// ─────────────────────────────────────────────────────────────

describe("formatEffectivePermissions — settings file status", () => {
  it("shows '✗ not present' for a missing file (format.ts:98)", () => {
    const f = makeSettingsFile({ exists: false, readable: false, parsed: false });
    const project = makeProject({ settingsFiles: [f] });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("✗ not present");
  });

  it("shows '✗ unreadable' when file exists but is not readable (format.ts:100)", () => {
    const f = makeSettingsFile({ exists: true, readable: false, parsed: false });
    const project = makeProject({ settingsFiles: [f] });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("✗ unreadable");
  });

  it("shows '⚠ parse error' when file exists, readable, but not parsed (format.ts:102)", () => {
    const f = makeSettingsFile({
      exists: true, readable: true, parsed: false, parseError: "unexpected token",
    });
    const project = makeProject({ settingsFiles: [f] });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("⚠ parse error");
    expect(out).toContain("unexpected token");
  });

  it("shows '⚠ schema warning' when parsed=true but parseError set (format.ts:104)", () => {
    // parsed=true means JSON was valid but schema validation found a mismatch
    const f = makeSettingsFile({
      exists: true, readable: true, parsed: true, parseError: "extra field",
    });
    const project = makeProject({ settingsFiles: [f] });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("⚠ schema warning");
  });

  it("shows '✓' for a fully valid file (format.ts:105)", () => {
    const f = makeSettingsFile({ exists: true, readable: true, parsed: true });
    const project = makeProject({ settingsFiles: [f] });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("✓");
  });

  it("includes globalFiles in settings file listing", () => {
    const gf = makeSettingsFile({ path: "/etc/managed.json", scope: "managed" });
    const project = makeProject();
    const out = stripAnsi(formatEffectivePermissions(project, [gf]));
    expect(out).toContain("managed");
  });
});

// ─────────────────────────────────────────────────────────────
// formatEffectivePermissions — allow / deny / ask sections
// ─────────────────────────────────────────────────────────────

describe("formatEffectivePermissions — allow/deny/ask sections", () => {
  it("shows ALLOW section when allow rules present (format.ts:111)", () => {
    const project = makeProject({
      perms: { allow: [{ tool: "Read", raw: "Read", scope: "project" }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("ALLOW:");
    expect(out).toContain("Read");
  });

  it("omits ALLOW section when allow is empty (format.ts:111 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("ALLOW:");
  });

  it("shows DENY section when deny rules present (format.ts:119)", () => {
    const project = makeProject({
      perms: { deny: [{ tool: "Bash", raw: "Bash(**/.env)", scope: "local" }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("DENY:");
    expect(out).toContain("Bash(**/.env)");
  });

  it("omits DENY section when deny is empty (format.ts:119 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("DENY:");
  });

  it("shows ASK section when ask rules present (format.ts:127)", () => {
    const project = makeProject({
      perms: { ask: [{ tool: "Write", raw: "Write", scope: "user" }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("ASK:");
    expect(out).toContain("Write");
  });

  it("omits ASK section when ask is empty (format.ts:127 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("ASK:");
  });
});

// ─────────────────────────────────────────────────────────────
// formatEffectivePermissions — bypass lock display
// ─────────────────────────────────────────────────────────────

describe("formatEffectivePermissions — bypass lock", () => {
  it("shows [bypass locked] when isBypassDisabled=true (format.ts:89)", () => {
    const project = makeProject({ perms: { isBypassDisabled: true } });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("[bypass locked]");
  });

  it("omits [bypass locked] when isBypassDisabled=false (format.ts:89 empty string branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("[bypass locked]");
  });
});

// ─────────────────────────────────────────────────────────────
// formatEffectivePermissions — MCP servers section
// ─────────────────────────────────────────────────────────────

describe("formatEffectivePermissions — MCP servers", () => {
  it("shows MCP Servers section when servers present (format.ts:135)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{
          name: "github", type: "stdio", scope: "project", approvalState: "approved",
          command: "npx", args: ["-y", "@modelcontextprotocol/server-github"],
          envVarNames: ["GITHUB_TOKEN"],
        }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("MCP Servers:");
    expect(out).toContain("github");
  });

  it("shows 'approved' approval state (format.ts:138-139)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", approvalState: "approved" }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("approved");
  });

  it("shows 'denied' approval state (format.ts:140-141)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", approvalState: "denied" }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("denied");
  });

  it("shows 'pending' approval state (format.ts:142 else branch)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", approvalState: "pending" }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("pending");
  });

  it("shows cmd line with args when command+args present (format.ts:144-148)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{
          name: "s", scope: "project",
          command: "npx", args: ["-y", "pkg"],
        }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("cmd: npx -y pkg");
  });

  it("shows cmd without args when args empty (format.ts:145-147 else branch)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", command: "mybin", args: [] }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("cmd: mybin");
    // Should not have trailing space
    expect(out).not.toContain("cmd: mybin ");
  });

  it("shows url when present (format.ts:150-152)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", url: "https://mcp.example.com" }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("url: https://mcp.example.com");
  });

  it("shows envVarNames when present (format.ts:153-155)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", envVarNames: ["TOKEN", "KEY"] }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("env: TOKEN, KEY");
  });

  it("omits envVarNames line when empty (format.ts:153 false branch)", () => {
    const project = makeProject({
      perms: { mcpServers: [{ name: "s", scope: "project", envVarNames: [] }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).not.toContain("env:");
  });

  it("shows headerNames when present (format.ts:156-158)", () => {
    const project = makeProject({
      perms: {
        mcpServers: [{ name: "s", scope: "project", headerNames: ["Authorization"] }],
      },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("headers: Authorization");
  });

  it("omits headerNames line when empty (format.ts:156 false branch)", () => {
    const project = makeProject({
      perms: { mcpServers: [{ name: "s", scope: "project", headerNames: [] }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).not.toContain("headers:");
  });

  it("omits MCP Servers section when no servers (format.ts:135 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("MCP Servers:");
  });
});

// ─────────────────────────────────────────────────────────────
// formatEffectivePermissions — envVarNames, additionalDirs, warnings
// ─────────────────────────────────────────────────────────────

describe("formatEffectivePermissions — envVarNames / additionalDirs / warnings", () => {
  it("shows ENV VARS section when envVarNames non-empty (format.ts:163)", () => {
    const project = makeProject({ perms: { envVarNames: ["FOO", "BAR"] } });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("ENV VARS (2 set):");
    expect(out).toContain("FOO, BAR");
  });

  it("omits ENV VARS section when envVarNames empty (format.ts:163 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("ENV VARS");
  });

  it("shows ADDITIONAL DIRS section when additionalDirs non-empty (format.ts:169)", () => {
    const project = makeProject({ perms: { additionalDirs: ["/tmp/extra"] } });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("ADDITIONAL DIRS:");
    expect(out).toContain("/tmp/extra");
  });

  it("omits ADDITIONAL DIRS section when empty (format.ts:169 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("ADDITIONAL DIRS:");
  });

  it("shows Warnings section when warnings non-empty (format.ts:177)", () => {
    const project = makeProject({
      perms: { warnings: [{ severity: "high", message: "Watch out!" }] },
    });
    const out = stripAnsi(formatEffectivePermissions(project));
    expect(out).toContain("Warnings:");
    expect(out).toContain("[HIGH]");
    expect(out).toContain("Watch out!");
  });

  it("omits Warnings section when warnings empty (format.ts:177 false branch)", () => {
    const out = stripAnsi(formatEffectivePermissions(makeProject()));
    expect(out).not.toContain("Warnings:");
  });
});
