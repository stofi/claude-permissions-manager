import { describe, it, expect } from "vitest";
import { parseRule, mergeSettingsFiles } from "../src/core/merger.js";
import type { SettingsFile } from "../src/core/types.js";

// Helpers to build fake SettingsFile objects
function makeFile(
  scope: SettingsFile["scope"],
  data: SettingsFile["data"],
  path = "/fake/path"
): SettingsFile {
  return {
    path,
    scope,
    exists: true,
    readable: true,
    parsed: true,
    data,
  };
}

// ────────────────────────────────────────────────────────────
// parseRule
// ────────────────────────────────────────────────────────────

describe("parseRule", () => {
  it("parses a bare tool name", () => {
    const r = parseRule("Read");
    expect(r.tool).toBe("Read");
    expect(r.specifier).toBeUndefined();
    expect(r.raw).toBe("Read");
  });

  it("parses tool with specifier", () => {
    const r = parseRule("Bash(npm run *)");
    expect(r.tool).toBe("Bash");
    expect(r.specifier).toBe("npm run *");
  });

  it("parses MCP tool", () => {
    const r = parseRule("mcp__github__create_issue");
    expect(r.tool).toBe("mcp__github__create_issue");
    expect(r.specifier).toBeUndefined();
  });

  it("parses file path specifier with slashes", () => {
    const r = parseRule("Read(**/.env)");
    expect(r.tool).toBe("Read");
    expect(r.specifier).toBe("**/.env");
  });

  it("handles empty specifier parens — treats as opaque raw string (not a valid rule)", () => {
    // Regex requires .+ inside parens, so "Bash()" falls through to fallback
    const r = parseRule("Bash()");
    expect(r.raw).toBe("Bash()");
    // tool will be the full string since the regex didn't match a specifier group
    expect(r.specifier).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// mergeSettingsFiles — basic merging
// ────────────────────────────────────────────────────────────

describe("mergeSettingsFiles — basic merging", () => {
  it("returns default mode when no files have data", () => {
    const result = mergeSettingsFiles([]);
    expect(result.defaultMode).toBe("default");
  });

  it("picks mode from first file (local > project priority)", () => {
    const local = makeFile("local", {
      permissions: { defaultMode: "acceptEdits" },
    });
    const project = makeFile("project", {
      permissions: { defaultMode: "plan" },
    });
    const result = mergeSettingsFiles([local, project]);
    expect(result.defaultMode).toBe("acceptEdits");
  });

  it("falls through to project mode if local has none", () => {
    const local = makeFile("local", { permissions: {} });
    const project = makeFile("project", {
      permissions: { defaultMode: "plan" },
    });
    const result = mergeSettingsFiles([local, project]);
    expect(result.defaultMode).toBe("plan");
  });

  it("concatenates allow rules across scopes", () => {
    const local = makeFile("local", {
      permissions: { allow: ["Bash(npx *)"] },
    });
    const project = makeFile("project", {
      permissions: { allow: ["Bash(npm run *)", "Read"] },
    });
    const result = mergeSettingsFiles([local, project]);
    expect(result.allow.map((r) => r.raw)).toEqual([
      "Bash(npx *)",
      "Bash(npm run *)",
      "Read",
    ]);
  });

  it("tags each rule with its source scope", () => {
    const local = makeFile("local", {
      permissions: { allow: ["Read"] },
    });
    const project = makeFile("project", {
      permissions: { deny: ["Bash"] },
    });
    const result = mergeSettingsFiles([local, project]);
    expect(result.allow[0].scope).toBe("local");
    expect(result.deny[0].scope).toBe("project");
  });

  it("deduplicates identical rules from different scopes", () => {
    const local = makeFile("local", {
      permissions: { allow: ["Read"] },
    });
    const user = makeFile("user", {
      permissions: { allow: ["Read", "Bash(git *)"] },
    });
    const result = mergeSettingsFiles([local, user]);
    const raws = result.allow.map((r) => r.raw);
    expect(raws.filter((r) => r === "Read").length).toBe(1);
    expect(raws).toContain("Bash(git *)");
  });

  it("merges env var names from all scopes", () => {
    const local = makeFile("local", { env: { MY_VAR: "x" } });
    const user = makeFile("user", { env: { OTHER: "y" } });
    const result = mergeSettingsFiles([local, user]);
    expect(result.envVarNames).toContain("MY_VAR");
    expect(result.envVarNames).toContain("OTHER");
  });

  it("sets isBypassDisabled when any file has disableBypassPermissionsMode=disable", () => {
    const managed = makeFile("managed", {
      permissions: { disableBypassPermissionsMode: "disable" },
    });
    const project = makeFile("project", {
      permissions: { allow: ["Read"] },
    });
    const result = mergeSettingsFiles([managed, project]);
    expect(result.isBypassDisabled).toBe(true);
  });

  it("skips files that don't exist", () => {
    const missing: SettingsFile = {
      path: "/missing",
      scope: "local",
      exists: false,
      readable: false,
      parsed: false,
    };
    const project = makeFile("project", {
      permissions: { allow: ["Read"] },
    });
    const result = mergeSettingsFiles([missing, project]);
    expect(result.allow.length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────
// mergeSettingsFiles — warning detection
// ────────────────────────────────────────────────────────────

describe("mergeSettingsFiles — warning detection", () => {
  it("emits critical warning for bypassPermissions mode", () => {
    const f = makeFile("local", {
      permissions: { defaultMode: "bypassPermissions" },
    });
    const result = mergeSettingsFiles([f]);
    const crit = result.warnings.find((w) => w.severity === "critical");
    expect(crit).toBeDefined();
    expect(crit!.message).toMatch(/bypassPermissions/);
  });

  it("emits high warning for dontAsk mode", () => {
    const f = makeFile("local", {
      permissions: { defaultMode: "dontAsk" },
    });
    const result = mergeSettingsFiles([f]);
    const high = result.warnings.find((w) => w.severity === "high" && /dontAsk/.test(w.message));
    expect(high).toBeDefined();
    expect(high!.message).toMatch(/executes actions without asking/i);
  });

  it("does NOT emit dontAsk warning for other modes", () => {
    for (const mode of ["default", "acceptEdits", "plan", "auto"] as const) {
      const f = makeFile("local", { permissions: { defaultMode: mode } });
      const result = mergeSettingsFiles([f]);
      const dontAskWarn = result.warnings.find((w) => /dontAsk/.test(w.message));
      expect(dontAskWarn).toBeUndefined();
    }
  });

  it("emits medium warning for acceptEdits mode", () => {
    const f = makeFile("local", { permissions: { defaultMode: "acceptEdits" } });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => w.severity === "medium" && /acceptEdits/.test(w.message));
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/file edits are accepted without confirmation/i);
  });

  it("does NOT emit acceptEdits warning for other modes", () => {
    for (const mode of ["default", "dontAsk", "plan", "auto"] as const) {
      const f = makeFile("local", { permissions: { defaultMode: mode } });
      const result = mergeSettingsFiles([f]);
      const warn = result.warnings.find((w) => /acceptEdits/.test(w.message));
      // dontAsk mode triggers its own warnings, just verify no acceptEdits-specific warning
      expect(warn).toBeUndefined();
    }
  });

  it("emits high warning for wildcard * in allow", () => {
    const f = makeFile("project", {
      permissions: { allow: ["*"] },
    });
    const result = mergeSettingsFiles([f]);
    const high = result.warnings.find(
      (w) => w.severity === "high" && w.rule === "*"
    );
    expect(high).toBeDefined();
    expect(high!.message).toMatch(/wildcard/i);
  });

  it("emits medium warning for wildcard * in deny list", () => {
    const f = makeFile("project", {
      permissions: { deny: ["*"] },
    });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "*" && w.message.includes("deny list")
    );
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/all tools are blocked/i);
  });

  it("emits low warning for wildcard * in ask list", () => {
    const f = makeFile("project", {
      permissions: { ask: ["*"] },
    });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find(
      (w) => w.severity === "low" && w.rule === "*" && w.message.includes("ask list")
    );
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/explicit approval/i);
  });

  it("does NOT emit wildcard deny/ask warnings for regular rules", () => {
    const f = makeFile("project", {
      permissions: { deny: ["Bash(git push *)"], ask: ["Read(**/.env)"] },
    });
    const result = mergeSettingsFiles([f]);
    const wildcardDenyWarn = result.warnings.find(
      (w) => w.message.includes("deny list") && w.rule === "*"
    );
    const wildcardAskWarn = result.warnings.find(
      (w) => w.message.includes("ask list") && w.rule === "*"
    );
    expect(wildcardDenyWarn).toBeUndefined();
    expect(wildcardAskWarn).toBeUndefined();
  });

  it("emits high warning for unqualified Bash allow", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Bash"], deny: ["Read(**/.env)"] },
    });
    const result = mergeSettingsFiles([f]);
    const high = result.warnings.find(
      (w) => w.severity === "high" && w.rule === "Bash"
    );
    expect(high).toBeDefined();
  });

  it("emits high warning for unqualified Write allow", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Write"] },
    });
    const result = mergeSettingsFiles([f]);
    const high = result.warnings.find(
      (w) => w.severity === "high" && w.rule === "Write"
    );
    expect(high).toBeDefined();
  });

  it("emits high warning for unqualified Edit allow", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Edit"] },
    });
    const result = mergeSettingsFiles([f]);
    const high = result.warnings.find(
      (w) => w.severity === "high" && w.rule === "Edit"
    );
    expect(high).toBeDefined();
    expect(high!.message).toMatch(/all file edits/i);
  });

  it("does NOT warn for Edit with specifier", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Edit(/src/**)"], deny: ["Read(**/.env)"] },
    });
    const result = mergeSettingsFiles([f]);
    const editWarn = result.warnings.find((w) => w.rule === "Edit(/src/**)");
    expect(editWarn).toBeUndefined();
  });

  it("emits medium warning for sensitive path in allow", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Read(**/.env)"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "Read(**/.env)"
    );
    expect(med).toBeDefined();
  });

  it("emits medium warning for .key sensitive path in allow", () => {
    // merger.ts:126: rule.specifier.includes(".key") — not covered by the /.env test above
    const f = makeFile("project", {
      permissions: { allow: ["Read(~/.config/secrets.key)"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "Read(~/.config/secrets.key)"
    );
    expect(med).toBeDefined();
  });

  it("emits medium warning for 'secrets' sensitive path in allow", () => {
    // merger.ts:127: rule.specifier.includes("secrets")
    const f = makeFile("project", {
      permissions: { allow: ["Write(/opt/app/secrets/token)"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "Write(/opt/app/secrets/token)"
    );
    expect(med).toBeDefined();
  });

  it("emits medium warning for ~/.ssh sensitive path in allow", () => {
    // merger.ts:128: rule.specifier.includes("~/.ssh")
    const f = makeFile("project", {
      permissions: { allow: ["Read(~/.ssh/id_rsa)"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "Read(~/.ssh/id_rsa)"
    );
    expect(med).toBeDefined();
  });

  it("emits medium warning for ~/.aws sensitive path in allow", () => {
    // merger.ts:129: rule.specifier.includes("~/.aws")
    const f = makeFile("project", {
      permissions: { allow: ["Read(~/.aws/credentials)"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "Read(~/.aws/credentials)"
    );
    expect(med).toBeDefined();
  });

  it("emits low warning for missing deny when Bash is allowed", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Bash(npm run *)"] },
    });
    const result = mergeSettingsFiles([f]);
    const low = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("deny rules")
    );
    expect(low).toBeDefined();
  });

  it("does NOT warn about missing deny rules when only read-only tools are allowed", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Read", "Glob", "Grep"] },
    });
    const result = mergeSettingsFiles([f]);
    const low = result.warnings.find(
      (w) => w.message.includes("deny rules")
    );
    expect(low).toBeUndefined();
  });

  it("does NOT warn about missing deny rules when only WebFetch/WebSearch are allowed", () => {
    const f = makeFile("project", {
      permissions: { allow: ["WebFetch", "WebSearch"] },
    });
    const result = mergeSettingsFiles([f]);
    const low = result.warnings.find(
      (w) => w.message.includes("deny rules")
    );
    expect(low).toBeUndefined();
  });

  it("emits medium warning for bare WebFetch allow (no URL specifier)", () => {
    const f = makeFile("project", {
      permissions: { allow: ["WebFetch"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "WebFetch" && w.message.includes("URL specifier")
    );
    expect(med).toBeDefined();
  });

  it("does NOT emit WebFetch warning when a URL specifier is provided", () => {
    const f = makeFile("project", {
      permissions: { allow: ["WebFetch(https://api.example.com/*)"] },
    });
    const result = mergeSettingsFiles([f]);
    const webFetchWarn = result.warnings.find(
      (w) => w.rule === "WebFetch(https://api.example.com/*)"
    );
    expect(webFetchWarn).toBeUndefined();
  });

  it("emits medium warning for bare WebSearch allow (no query specifier)", () => {
    const f = makeFile("project", {
      permissions: { allow: ["WebSearch"] },
    });
    const result = mergeSettingsFiles([f]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.rule === "WebSearch" && w.message.includes("query specifier")
    );
    expect(med).toBeDefined();
  });

  it("does NOT emit WebSearch warning when a query specifier is provided", () => {
    const f = makeFile("project", {
      permissions: { allow: ["WebSearch(site:example.com *)"] },
    });
    const result = mergeSettingsFiles([f]);
    const webSearchWarn = result.warnings.find(
      (w) => w.rule === "WebSearch(site:example.com *)"
    );
    expect(webSearchWarn).toBeUndefined();
  });

  it("does NOT warn about bypass mode when no explicit rules configured", () => {
    const f = makeFile("project", {
      permissions: {},
    });
    const result = mergeSettingsFiles([f]);
    const bypassWarn = result.warnings.find(
      (w) => w.message.includes("disableBypassPermissionsMode")
    );
    expect(bypassWarn).toBeUndefined();
  });

  it("emits medium warning for pending MCP server", () => {
    const f = makeFile("project", { permissions: {} });
    const result = mergeSettingsFiles([f], [
      {
        name: "my-server",
        scope: "project",
        approvalState: "pending",
      },
    ]);
    const med = result.warnings.find(
      (w) => w.severity === "medium" && w.message.includes("my-server")
    );
    expect(med).toBeDefined();
  });

  it("emits low warning for stdio MCP server with no command", () => {
    const f = makeFile("project", { permissions: {} });
    const result = mergeSettingsFiles([f], [
      {
        name: "broken-stdio",
        scope: "project",
        approvalState: "approved",
        type: "stdio",
        // command intentionally absent
      },
    ]);
    const w = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("broken-stdio") && w.message.includes("command")
    );
    expect(w).toBeDefined();
  });

  it("emits low warning for http MCP server with no url", () => {
    const f = makeFile("project", { permissions: {} });
    const result = mergeSettingsFiles([f], [
      {
        name: "broken-http",
        scope: "project",
        approvalState: "approved",
        type: "http",
        // url intentionally absent
      },
    ]);
    const w = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("broken-http") && w.message.includes("url")
    );
    expect(w).toBeDefined();
  });

  it("does NOT emit config warning for well-formed stdio server", () => {
    const f = makeFile("project", { permissions: {} });
    const result = mergeSettingsFiles([f], [
      {
        name: "ok-stdio",
        scope: "project",
        approvalState: "approved",
        type: "stdio",
        command: "npx",
        args: ["-y", "some-server"],
      },
    ]);
    const w = result.warnings.find(
      (w) => w.message.includes("ok-stdio") && w.message.includes("command")
    );
    expect(w).toBeUndefined();
  });

  it("does NOT emit disableBypassPermissionsMode warning when bypass already active", () => {
    const f = makeFile("project", {
      permissions: {
        defaultMode: "bypassPermissions",
        allow: ["Bash"],
      },
    });
    const result = mergeSettingsFiles([f]);
    // CRITICAL should fire for bypass mode being active
    const crit = result.warnings.find((w) => w.severity === "critical");
    expect(crit).toBeDefined();
    // LOW disableBypassPermissionsMode warning should NOT fire — bypass is already the problem
    const redundant = result.warnings.find((w) =>
      w.message.includes("disableBypassPermissionsMode")
    );
    expect(redundant).toBeUndefined();
  });

  it("no warnings for clean project with deny rules", () => {
    const f = makeFile("project", {
      permissions: {
        allow: ["Bash(npm run *)", "Read"],
        deny: ["Read(**/.env)"],
        disableBypassPermissionsMode: "disable",
      },
    });
    const result = mergeSettingsFiles([f]);
    expect(result.warnings).toHaveLength(0);
  });

  it("emits low warning when same rule appears in both allow and deny", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Read"], deny: ["Read"] },
    });
    const result = mergeSettingsFiles([f]);
    const conflict = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("both allow and deny")
    );
    expect(conflict).toBeDefined();
    expect(conflict!.rule).toBe("Read");
  });

  it("emits conflict warning when allow/deny conflict across scopes", () => {
    const local = makeFile("local", { permissions: { allow: ["Bash(npm run *)"] } });
    const project = makeFile("project", { permissions: { deny: ["Bash(npm run *)"] } });
    const result = mergeSettingsFiles([local, project]);
    const conflict = result.warnings.find(
      (w) => w.severity === "low" && w.rule === "Bash(npm run *)"
    );
    expect(conflict).toBeDefined();
  });

  it("emits low warning when bare tool deny overrides specific allow rule", () => {
    const f = makeFile("project", {
      permissions: {
        allow: ["Bash(git status)", "Bash(git log *)"],
        deny: ["Bash"],
      },
    });
    const result = mergeSettingsFiles([f]);
    const overriddenWarnings = result.warnings.filter(
      (w) => w.severity === "low" && w.message.includes("overridden by bare deny")
    );
    expect(overriddenWarnings).toHaveLength(2);
    expect(overriddenWarnings.map((w) => w.rule)).toContain("Bash(git status)");
    expect(overriddenWarnings.map((w) => w.rule)).toContain("Bash(git log *)");
  });

  it("does NOT emit bare-tool-deny warning for bare allow + bare deny (exact match handled separately)", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Bash"], deny: ["Bash"] },
    });
    const result = mergeSettingsFiles([f]);
    // Should get the exact-match conflict warning, not the bare-tool-override warning
    const exactConflict = result.warnings.find(
      (w) => w.message.includes("both allow and deny")
    );
    expect(exactConflict).toBeDefined();
    const overrideWarning = result.warnings.find(
      (w) => w.message.includes("overridden by bare deny")
    );
    expect(overrideWarning).toBeUndefined(); // no specifier, so this check doesn't apply
  });

  it("emits low warnings for allow rules overridden by wildcard deny *", () => {
    const f = makeFile("project", {
      permissions: {
        allow: ["Bash(npm run *)", "Read"],
        deny: ["*"],
      },
    });
    const result = mergeSettingsFiles([f]);
    const overrides = result.warnings.filter(
      (w) => w.severity === "low" && w.message.includes("wildcard deny")
    );
    expect(overrides).toHaveLength(2);
    expect(overrides.map((w) => w.rule)).toContain("Bash(npm run *)");
    expect(overrides.map((w) => w.rule)).toContain("Read");
  });

  it("does NOT emit wildcard deny override for allow * + deny * (exact match handled separately)", () => {
    const f = makeFile("project", {
      permissions: { allow: ["*"], deny: ["*"] },
    });
    const result = mergeSettingsFiles([f]);
    // Exact conflict warning fires, wildcard override does not
    const wildcardOverride = result.warnings.find(
      (w) => w.message.includes("wildcard deny")
    );
    expect(wildcardOverride).toBeUndefined();
    const exactConflict = result.warnings.find(
      (w) => w.message.includes("both allow and deny")
    );
    expect(exactConflict).toBeDefined();
  });

  it("emits low warning when same rule appears in both ask and deny", () => {
    const f = makeFile("project", {
      permissions: { ask: ["Bash(git *)"], deny: ["Bash(git *)"] },
    });
    const result = mergeSettingsFiles([f]);
    const conflict = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("both ask and deny")
    );
    expect(conflict).toBeDefined();
    expect(conflict!.rule).toBe("Bash(git *)");
  });

  it("emits low warning when same rule appears in both allow and ask", () => {
    const f = makeFile("project", {
      permissions: { allow: ["Bash(git status)"], ask: ["Bash(git status)"] },
    });
    const result = mergeSettingsFiles([f]);
    const conflict = result.warnings.find(
      (w) => w.severity === "low" && w.message.includes("both allow and ask")
    );
    expect(conflict).toBeDefined();
    expect(conflict!.rule).toBe("Bash(git status)");
  });

  it("emits low warning when bare tool deny overrides specific ask rule", () => {
    const f = makeFile("project", {
      permissions: {
        ask: ["Bash(git status)", "Bash(git log *)"],
        deny: ["Bash"],
      },
    });
    const result = mergeSettingsFiles([f]);
    const overriddenWarnings = result.warnings.filter(
      (w) => w.severity === "low" && w.message.includes("overridden by bare deny") && w.message.includes("Ask rule")
    );
    expect(overriddenWarnings).toHaveLength(2);
    expect(overriddenWarnings.map((w) => w.rule)).toContain("Bash(git status)");
  });

  it("emits low warnings for ask rules overridden by wildcard deny *", () => {
    const f = makeFile("project", {
      permissions: {
        ask: ["Bash(npm run *)", "Read"],
        deny: ["*"],
      },
    });
    const result = mergeSettingsFiles([f]);
    const overrides = result.warnings.filter(
      (w) => w.severity === "low" && w.message.includes("wildcard deny") && w.message.includes("Ask rule")
    );
    expect(overrides).toHaveLength(2);
    expect(overrides.map((w) => w.rule)).toContain("Bash(npm run *)");
  });

  it("emits high warning for allowManagedPermissionRulesOnly in managed settings", () => {
    const managed = makeFile("managed", {
      allowManagedPermissionRulesOnly: true,
    });
    const result = mergeSettingsFiles([managed]);
    const warn = result.warnings.find(
      (w) => w.severity === "high" && w.message.includes("allowManagedPermissionRulesOnly")
    );
    expect(warn).toBeDefined();
  });

  it("emits medium warnings for allowManagedHooksOnly and allowManagedMcpServersOnly in managed settings", () => {
    const managed = makeFile("managed", {
      allowManagedHooksOnly: true,
      allowManagedMcpServersOnly: true,
    });
    const result = mergeSettingsFiles([managed]);
    const hooksWarn = result.warnings.find(
      (w) => w.severity === "medium" && w.message.includes("allowManagedHooksOnly")
    );
    const mcpWarn = result.warnings.find(
      (w) => w.severity === "medium" && w.message.includes("allowManagedMcpServersOnly")
    );
    expect(hooksWarn).toBeDefined();
    expect(mcpWarn).toBeDefined();
  });

  it("does NOT warn about allowManaged* flags in non-managed scopes", () => {
    const project = makeFile("project", {
      allowManagedPermissionRulesOnly: true,
      allowManagedHooksOnly: true,
    });
    const result = mergeSettingsFiles([project]);
    const warn = result.warnings.find(
      (w) => w.message.includes("allowManaged")
    );
    expect(warn).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// additionalDirs expansion warning
// ────────────────────────────────────────────────────────────

describe("additionalDirs warning", () => {
  it("emits low warning when additionalDirs is non-empty", () => {
    const f = makeFile("project", { additionalDirectories: ["/tmp/extra"] });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => w.severity === "low" && /additional director/i.test(w.message));
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/filesystem access beyond the project root/i);
  });

  it("message uses singular 'directory' for one dir", () => {
    const f = makeFile("project", { additionalDirectories: ["/a"] });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => /additional director/i.test(w.message));
    expect(warn!.message).toMatch(/1 additional directory/);
  });

  it("message uses plural 'directories' for multiple dirs", () => {
    const f = makeFile("project", { additionalDirectories: ["/a", "/b"] });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => /additional director/i.test(w.message));
    expect(warn!.message).toMatch(/2 additional directories/);
  });

  it("does NOT emit warning when additionalDirs is empty", () => {
    const f = makeFile("project", { permissions: {} });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => /additional director/i.test(w.message));
    expect(warn).toBeUndefined();
  });

  it("does NOT emit additionalDirs warning when bypassPermissions is active (redundant with CRITICAL warning)", () => {
    const f = makeFile("local", {
      permissions: { defaultMode: "bypassPermissions", additionalDirectories: ["/extra"] },
      additionalDirectories: ["/extra"],
    });
    const result = mergeSettingsFiles([f]);
    const warn = result.warnings.find((w) => /additional director/i.test(w.message));
    expect(warn).toBeUndefined();
    // CRITICAL bypass warning should still fire
    const crit = result.warnings.find((w) => w.severity === "critical");
    expect(crit).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// Invalid defaultMode handling
// ────────────────────────────────────────────────────────────

describe("mergeSettingsFiles — invalid defaultMode", () => {
  it("ignores an invalid defaultMode value — falls back to 'default'", () => {
    const file = makeFile("local", {
      // Simulate a file that failed schema validation and was stored raw
      permissions: { defaultMode: "invalid-mode" as "default" },
    });
    const result = mergeSettingsFiles([file]);
    expect(result.defaultMode).toBe("default");
  });

  it("valid mode from higher-priority scope wins even when lower scope has invalid mode", () => {
    const local = makeFile("local", {
      permissions: { defaultMode: "typo-mode" as "default" },
    });
    const project = makeFile("project", {
      permissions: { defaultMode: "acceptEdits" },
    });
    // local has invalid mode → skipped; project has valid → used
    const result = mergeSettingsFiles([local, project]);
    expect(result.defaultMode).toBe("acceptEdits");
  });

  it("valid mode from higher-priority scope still wins over invalid lower scope", () => {
    const local = makeFile("local", {
      permissions: { defaultMode: "auto" },
    });
    const project = makeFile("project", {
      permissions: { defaultMode: "bogus" as "default" },
    });
    const result = mergeSettingsFiles([local, project]);
    expect(result.defaultMode).toBe("auto");
  });

  it("all valid modes are accepted", () => {
    const modes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"] as const;
    for (const m of modes) {
      const file = makeFile("local", { permissions: { defaultMode: m } });
      const result = mergeSettingsFiles([file]);
      expect(result.defaultMode).toBe(m);
    }
  });
});

describe("mergeSettingsFiles — non-string array element guards", () => {
  it("silently skips non-string elements in allow, deny, and ask arrays (merger.ts:354,359,364)", () => {
    // These guards protect against malformed JSON that passes Array.isArray()
    // but contains non-string values (e.g. allow: [123, "Read", null]).
    const f = makeFile("local", {
      permissions: {
        allow: [123, "Read", null] as unknown as string[],
        deny: [true, "Bash"] as unknown as string[],
        ask: [{}, "Write"] as unknown as string[],
      },
    });
    const result = mergeSettingsFiles([f]);
    expect(result.allow.map((r) => r.raw)).toEqual(["Read"]);
    expect(result.deny.map((r) => r.raw)).toEqual(["Bash"]);
    expect(result.ask.map((r) => r.raw)).toEqual(["Write"]);
  });
});
