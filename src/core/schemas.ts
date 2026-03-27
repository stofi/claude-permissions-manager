import { z } from "zod";

export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const McpServerFilterSchema = z
  .object({
    serverName: z.string().optional(),
    serverCommand: z.array(z.string()).optional(),
    serverUrl: z.string().optional(),
  })
  .passthrough();

export const AutoModeConfigSchema = z
  .object({
    environment: z.array(z.string()).optional(),
    allow: z.array(z.string()).optional(),
    soft_deny: z.array(z.string()).optional(),
  })
  .passthrough();

export const PermissionsSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
    defaultMode: PermissionModeSchema.optional(),
    disableBypassPermissionsMode: z.literal("disable").optional(),
  })
  .passthrough();

export const SettingsDataSchema = z
  .object({
    permissions: PermissionsSchema.optional(),
    env: z.record(z.string()).optional(),
    additionalDirectories: z.array(z.string()).optional(),
    model: z.string().optional(),
    cleanupPeriodDays: z.number().optional(),
    autoMemoryEnabled: z.boolean().optional(),
    enableAllProjectMcpServers: z.boolean().optional(),
    allowedMcpServers: z.array(McpServerFilterSchema).optional(),
    deniedMcpServers: z.array(McpServerFilterSchema).optional(),
    allowManagedPermissionRulesOnly: z.boolean().optional(),
    allowManagedHooksOnly: z.boolean().optional(),
    allowManagedMcpServersOnly: z.boolean().optional(),
    claudeMdExcludes: z.array(z.string()).optional(),
    autoMode: AutoModeConfigSchema.optional(),
  })
  .passthrough();

export type SettingsData = z.infer<typeof SettingsDataSchema>;

export const McpServerConfigSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    type: z.enum(["stdio", "http"]).optional(),
    url: z.string().optional(),
    env: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
  })
  .passthrough();

export const McpFileSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema).optional(),
});

export type McpFileData = z.infer<typeof McpFileSchema>;

// ~/.claude.json structure (partially documented)
export const ClaudeJsonProjectSchema = z
  .object({
    mcpServers: z.record(McpServerConfigSchema).optional(),
    mcpServerApprovals: z.record(z.enum(["approved", "denied"])).optional(),
  })
  .passthrough();

export const ClaudeJsonSchema = z
  .object({
    mcpServers: z.record(McpServerConfigSchema).optional(),
    projects: z.record(ClaudeJsonProjectSchema).optional(),
  })
  .passthrough();

export type ClaudeJsonData = z.infer<typeof ClaudeJsonSchema>;
