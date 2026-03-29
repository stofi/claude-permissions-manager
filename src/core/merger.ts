import { PermissionModeSchema } from "./schemas.js";
import type {
  SettingsFile,
  SettingsScope,
  EffectivePermissions,
  PermissionRule,
  McpServer,
  Warning,
  PermissionMode,
} from "./types.js";

/** Parse a raw rule string like "Bash(npm run *)" into tool + specifier */
export function parseRule(raw: string): PermissionRule {
  const match = raw.match(/^([^(]+)(?:\((.+)\))?$/);
  if (!match) {
    return { tool: raw, raw };
  }
  return {
    tool: match[1].trim(),
    specifier: match[2]?.trim(),
    raw,
  };
}

function dedupeRules<T extends PermissionRule>(
  rules: Array<T & { scope: SettingsScope }>
): Array<T & { scope: SettingsScope }> {
  const seen = new Set<string>();
  return rules.filter((r) => {
    if (seen.has(r.raw)) return false;
    seen.add(r.raw);
    return true;
  });
}

function detectWarnings(
  permissions: EffectivePermissions,
  settingsFiles: SettingsFile[]
): Warning[] {
  const warnings: Warning[] = [];

  if (permissions.defaultMode === "bypassPermissions") {
    warnings.push({
      severity: "critical",
      message: "bypassPermissions mode is active — all permission checks disabled",
    });
  }

  if (permissions.defaultMode === "dontAsk") {
    warnings.push({
      severity: "high",
      message: "dontAsk mode is active — Claude executes actions without asking permission (deny rules still apply)",
    });
  }

  // Only warn about missing bypass lock-out when:
  // - bypass is NOT already active (redundant if it already is)
  // - project has explicit allow/deny rules (intentional permission config)
  const hasExplicitPermissions =
    permissions.allow.length > 0 || permissions.deny.length > 0;
  if (
    permissions.defaultMode !== "bypassPermissions" &&
    hasExplicitPermissions &&
    !permissions.isBypassDisabled
  ) {
    warnings.push({
      severity: "low",
      message: "disableBypassPermissionsMode is not set — bypassPermissions mode can be activated",
    });
  }

  for (const rule of permissions.allow) {
    if (rule.raw === "*") {
      warnings.push({
        severity: "high",
        message: 'Wildcard "*" in allow list — all tools permitted without prompting',
        rule: rule.raw,
      });
    }
    if (rule.tool === "Bash" && !rule.specifier) {
      warnings.push({
        severity: "high",
        message: "Bash is allowed without any specifier — all shell commands permitted",
        rule: rule.raw,
      });
    }
    if (rule.tool === "Write" && !rule.specifier) {
      warnings.push({
        severity: "high",
        message: "Write is allowed without any specifier — all file writes permitted",
        rule: rule.raw,
      });
    }
    if (rule.tool === "Edit" && !rule.specifier) {
      warnings.push({
        severity: "high",
        message: "Edit is allowed without any specifier — all file edits permitted",
        rule: rule.raw,
      });
    }
    if (rule.tool === "WebFetch" && !rule.specifier) {
      warnings.push({
        severity: "medium",
        message: "WebFetch is allowed without any URL specifier — arbitrary URLs can be fetched",
        rule: rule.raw,
      });
    }
    if (rule.tool === "WebSearch" && !rule.specifier) {
      warnings.push({
        severity: "medium",
        message: "WebSearch is allowed without any query specifier — arbitrary web searches can be performed",
        rule: rule.raw,
      });
    }
    // Check for sensitive paths in allow
    if (
      rule.specifier &&
      (rule.specifier.includes("/.env") ||
        rule.specifier.includes(".key") ||
        rule.specifier.includes("secrets") ||
        rule.specifier.includes("~/.ssh") ||
        rule.specifier.includes("~/.aws"))
    ) {
      warnings.push({
        severity: "medium",
        message: `Sensitive path in allow rule: ${rule.raw}`,
        rule: rule.raw,
      });
    }
  }

  // Only warn if there are non-trivial allow rules (not just read-only tools)
  const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"];
  const nonReadAllows = permissions.allow.filter(
    (r) => !READ_ONLY_TOOLS.includes(r.tool)
  );
  if (nonReadAllows.length > 0 && permissions.deny.length === 0) {
    warnings.push({
      severity: "low",
      message: "No deny rules configured — consider denying sensitive paths",
    });
  }

  const pendingMcp = permissions.mcpServers.filter(
    (s) => s.approvalState === "pending"
  );
  for (const server of pendingMcp) {
    warnings.push({
      severity: "medium",
      message: `MCP server "${server.name}" has not been approved or denied`,
    });
  }

  // Warn about MCP servers missing required connection config
  for (const server of permissions.mcpServers) {
    const type = server.type ?? "stdio";
    if (type === "stdio" && !server.command) {
      warnings.push({
        severity: "low",
        message: `MCP server "${server.name}" is type stdio but has no command configured`,
      });
    } else if (type === "http" && !server.url) {
      warnings.push({
        severity: "low",
        message: `MCP server "${server.name}" is type http but has no url configured`,
      });
    }
  }

  // Warn about rules that appear in both allow and deny (deny wins, allow is ineffective)
  const denySet = new Set(permissions.deny.map((r) => r.raw));
  for (const rule of permissions.allow) {
    if (denySet.has(rule.raw)) {
      warnings.push({
        severity: "low",
        message: `Rule "${rule.raw}" is in both allow and deny — deny wins, allow has no effect`,
        rule: rule.raw,
      });
    }
  }

  // Warn about rules that appear in both ask and deny (deny wins, ask prompt never shown)
  for (const rule of permissions.ask) {
    if (denySet.has(rule.raw)) {
      warnings.push({
        severity: "low",
        message: `Rule "${rule.raw}" is in both ask and deny — deny wins, ask prompt never shown`,
        rule: rule.raw,
      });
    }
  }

  // Warn about rules that appear in both allow and ask (allow wins, ask prompt never shown)
  const allowSet = new Set(permissions.allow.map((r) => r.raw));
  for (const rule of permissions.ask) {
    if (allowSet.has(rule.raw)) {
      warnings.push({
        severity: "low",
        message: `Rule "${rule.raw}" is in both allow and ask — allow wins, ask prompt never shown`,
        rule: rule.raw,
      });
    }
  }

  // Warn when a bare tool deny semantically covers a more specific allow rule
  // e.g. deny "Bash" overrides allow "Bash(git status)" — allow has no effect
  // Also warn when deny "*" (wildcard) overrides all allow rules
  const bareToolDenies = new Set(
    permissions.deny.filter((r) => !r.specifier).map((r) => r.tool)
  );
  const wildcardDenyPresent = bareToolDenies.has("*");
  for (const rule of permissions.allow) {
    if (rule.specifier && bareToolDenies.has(rule.tool)) {
      warnings.push({
        severity: "low",
        message: `Allow rule "${rule.raw}" is overridden by bare deny "${rule.tool}" — allow has no effect`,
        rule: rule.raw,
      });
    } else if (wildcardDenyPresent && !denySet.has(rule.raw)) {
      // Wildcard deny overrides all allow rules not already caught by exact-match check
      warnings.push({
        severity: "low",
        message: `Allow rule "${rule.raw}" is overridden by wildcard deny "*" — allow has no effect`,
        rule: rule.raw,
      });
    }
  }

  // Warn when a bare tool deny or wildcard deny overrides a specific ask rule
  for (const rule of permissions.ask) {
    if (rule.specifier && bareToolDenies.has(rule.tool)) {
      warnings.push({
        severity: "low",
        message: `Ask rule "${rule.raw}" is overridden by bare deny "${rule.tool}" — ask prompt never shown`,
        rule: rule.raw,
      });
    } else if (wildcardDenyPresent && !denySet.has(rule.raw)) {
      warnings.push({
        severity: "low",
        message: `Ask rule "${rule.raw}" is overridden by wildcard deny "*" — ask prompt never shown`,
        rule: rule.raw,
      });
    }
  }

  // Warn about managed-settings-only restriction flags
  // These flags are only respected when set in managed settings (enterprise deployment)
  for (const file of settingsFiles) {
    if (!file.exists || !file.data || file.scope !== "managed") continue;
    if (file.data.allowManagedPermissionRulesOnly) {
      warnings.push({
        severity: "high",
        message:
          "allowManagedPermissionRulesOnly is set in managed settings — project-level permission rules are overridden",
      });
    }
    if (file.data.allowManagedHooksOnly) {
      warnings.push({
        severity: "medium",
        message:
          "allowManagedHooksOnly is set in managed settings — project-level hooks are overridden",
      });
    }
    if (file.data.allowManagedMcpServersOnly) {
      warnings.push({
        severity: "medium",
        message:
          "allowManagedMcpServersOnly is set in managed settings — project-level MCP servers are overridden",
      });
    }
  }

  return warnings;
}

function mergeMode(modes: PermissionMode[]): PermissionMode {
  if (modes.length === 0) return "default";
  // Return the first explicitly set mode (local > project > user > managed)
  // which is the order we receive them in
  return modes[0];
}

export function mergeSettingsFiles(
  settingsFiles: SettingsFile[],
  mcpServers: McpServer[] = []
): EffectivePermissions {
  // settingsFiles ordered from highest priority (local) to lowest (managed)
  // For arrays: collect all, dedupe
  // For mode: first-set wins (highest priority first)
  // For deny: any level wins absolutely (deny is already ensured by the rule evaluation engine)

  const allAllow: Array<PermissionRule & { scope: SettingsScope }> = [];
  const allDeny: Array<PermissionRule & { scope: SettingsScope }> = [];
  const allAsk: Array<PermissionRule & { scope: SettingsScope }> = [];
  const allEnvVarNames: string[] = [];
  const allAdditionalDirs: string[] = [];
  const modes: PermissionMode[] = [];
  let isBypassDisabled = false;

  for (const file of settingsFiles) {
    if (!file.exists || !file.data) continue;

    const perms = file.data.permissions;
    if (perms) {
      if (perms.defaultMode) {
        const validMode = PermissionModeSchema.safeParse(perms.defaultMode);
        if (validMode.success) modes.push(validMode.data);
        // else: invalid mode value — schema warning in parseError already captures it
      }
      if (perms.disableBypassPermissionsMode === "disable") {
        isBypassDisabled = true;
      }
      // Guard against non-array values (can occur when schema validation falls back to raw JSON)
      if (Array.isArray(perms.allow)) {
        for (const raw of perms.allow) {
          if (typeof raw === "string") allAllow.push({ ...parseRule(raw), scope: file.scope });
        }
      }
      if (Array.isArray(perms.deny)) {
        for (const raw of perms.deny) {
          if (typeof raw === "string") allDeny.push({ ...parseRule(raw), scope: file.scope });
        }
      }
      if (Array.isArray(perms.ask)) {
        for (const raw of perms.ask) {
          if (typeof raw === "string") allAsk.push({ ...parseRule(raw), scope: file.scope });
        }
      }
    }

    if (file.data.env) {
      allEnvVarNames.push(...Object.keys(file.data.env));
    }
    if (file.data.additionalDirectories) {
      allAdditionalDirs.push(...file.data.additionalDirectories);
    }
  }

  const permissions: EffectivePermissions = {
    defaultMode: mergeMode(modes),
    allow: dedupeRules(allAllow),
    deny: dedupeRules(allDeny),
    ask: dedupeRules(allAsk),
    isBypassDisabled,
    mcpServers,
    envVarNames: [...new Set(allEnvVarNames)],
    additionalDirs: [...new Set(allAdditionalDirs)],
    warnings: [],
  };

  permissions.warnings = detectWarnings(permissions, settingsFiles);
  return permissions;
}
