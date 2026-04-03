/**
 * Tests for audit.ts deduplication false branch (line 224).
 *
 * The `if (!seen.has(key))` false branch fires when a second fixable issue shares
 * the same (settingsFile, fixOp) key as an earlier one — i.e., user-scope fixes
 * that affect multiple projects but only need to be applied once.
 *
 * Uses vi.mock("../src/core/discovery.js") at file scope (hoisted) so that the
 * static import of auditCommand below uses the mock. This lets V8 track the real
 * audit.ts module instance and count branch coverage.
 */
import { vi, describe, it, expect } from "vitest";

// ── Module-level mock (hoisted) ────────────────────────────────────────────────
// Returns two projects that both have the same user-scope critical fix.
// resolveSettingsPath("user", any_path) → same ~/.claude/settings.json for all,
// so both issues share the same dedup key → the false branch fires.
vi.mock("../src/core/discovery.js", () => {
  const userModeWarning = {
    severity: "critical" as const,
    message: "bypassPermissions mode disables all permission checks",
    fixCmd: "cpm mode default --scope user",
    fixOp: { kind: "mode" as const, mode: "default" as const, scope: "user" as const },
  };

  const makeProject = (rootPath: string) => ({
    rootPath,
    settingsFiles: [],
    claudeMdFiles: [],
    effectivePermissions: {
      defaultMode: "bypassPermissions",
      allow: [],
      deny: [],
      ask: [],
      isBypassDisabled: false,
      envVarNames: [],
      additionalDirs: [],
      mcpServers: [],
      warnings: [userModeWarning],
    },
  });

  return {
    scan: vi.fn(async () => ({
      projects: [makeProject("/fake/proj-a"), makeProject("/fake/proj-b")],
      global: { user: undefined, managed: undefined, userMcpServers: [] },
      errors: [],
      scannedAt: new Date(),
      scanRoot: "/fake",
    })),
  };
});

// ── Static import AFTER mock setup ─────────────────────────────────────────────
import { auditCommand } from "../src/commands/audit.js";

describe("auditCommand — dedup false branch (audit.ts:224)", () => {
  it("collapses two identical user-scope fixes into one (dedup false branch)", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });

    // fix: true, _confirmFn refuses → triggers dedup logic without actually writing files
    await auditCommand({ root: "/fake", fix: true, _confirmFn: async () => false });

    const output = calls.join("\n");
    // 1 unique fix (not 2) — dedup reduced from 2 to 1
    expect(output).toMatch(/1 fix\(es\) available/);
    // affectedCount=2 → shows "(affects 2 projects)"
    expect(output).toMatch(/affects 2 projects/);
    // _confirmFn returned false → aborted without applying
    expect(output).toMatch(/Aborted/i);
  });

  it("shows 'affects N projects' only when N > 1 (single-project case has no annotation)", async () => {
    const { scan } = await import("../src/core/discovery.js");
    // Override mock to return only ONE project
    (scan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      projects: [
        {
          rootPath: "/fake/proj-a",
          settingsFiles: [],
          claudeMdFiles: [],
          effectivePermissions: {
            defaultMode: "bypassPermissions",
            allow: [],
            deny: [],
            ask: [],
            isBypassDisabled: false,
            envVarNames: [],
            additionalDirs: [],
            mcpServers: [],
            warnings: [{
              severity: "critical" as const,
              message: "bypassPermissions mode disables all permission checks",
              fixCmd: "cpm mode default --scope user",
              fixOp: { kind: "mode" as const, mode: "default" as const, scope: "user" as const },
            }],
          },
        },
      ],
      global: { user: undefined, managed: undefined, userMcpServers: [] },
      errors: [],
      scannedAt: new Date(),
      scanRoot: "/fake",
    });

    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });

    await auditCommand({ root: "/fake", fix: true, _confirmFn: async () => false });

    const output = calls.join("\n");
    expect(output).toMatch(/1 fix\(es\) available/);
    // Single project — no "(affects N projects)" annotation
    expect(output).not.toMatch(/affects/);
  });
});
