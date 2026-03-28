import { readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import {
  SettingsDataSchema,
  McpFileSchema,
  ClaudeJsonSchema,
} from "./schemas.js";
import type {
  SettingsFile,
  SettingsScope,
  McpFile,
  McpServer,
  ClaudeMdFile,
} from "./types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

export async function parseSettingsFile(
  path: string,
  scope: SettingsScope
): Promise<SettingsFile> {
  const exists = await fileExists(path);
  if (!exists) {
    return { path, scope, exists: false, readable: false, parsed: false };
  }

  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    return {
      path,
      scope,
      exists: true,
      readable: false,
      parsed: false,
      parseError: String(err),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    return {
      path,
      scope,
      exists: true,
      readable: true,
      parsed: false,
      parseError: `JSON parse error: ${String(err)}`,
    };
  }

  const result = SettingsDataSchema.safeParse(json);
  if (!result.success) {
    // Still return the raw data; schema errors are non-fatal
    return {
      path,
      scope,
      exists: true,
      readable: true,
      parsed: true,
      parseError: `Schema warning: ${result.error.message}`,
      data: json as ReturnType<typeof SettingsDataSchema.parse>,
    };
  }

  return {
    path,
    scope,
    exists: true,
    readable: true,
    parsed: true,
    data: result.data,
  };
}

export async function parseMcpFile(
  projectRoot: string,
  scope: SettingsScope
): Promise<McpFile> {
  const path = join(projectRoot, ".mcp.json");
  const exists = await fileExists(path);
  if (!exists) {
    return { path, exists: false, parsed: false, servers: [] };
  }

  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    return {
      path,
      exists: true,
      parsed: false,
      parseError: String(err),
      servers: [],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    return {
      path,
      exists: true,
      parsed: false,
      parseError: `JSON parse error: ${String(err)}`,
      servers: [],
    };
  }

  const result = McpFileSchema.safeParse(json);
  const rawData = result.success ? result.data : (json as typeof result.data);

  const servers: McpServer[] = [];
  const mcpServers = (rawData as { mcpServers?: Record<string, unknown> })?.mcpServers ?? {};

  for (const [name, config] of Object.entries(mcpServers)) {
    const c = config as Record<string, unknown>;
    servers.push({
      name,
      type: (c.type as "stdio" | "http" | undefined) ?? "stdio",
      command: c.command as string | undefined,
      args: c.args as string[] | undefined,
      url: c.url as string | undefined,
      envVarNames: c.env ? Object.keys(c.env as object) : undefined,
      headerNames: c.headers ? Object.keys(c.headers as object) : undefined,
      scope,
      approvalState: "pending",
    });
  }

  return {
    path,
    exists: true,
    parsed: result.success,
    parseError: result.success ? undefined : result.error.message,
    servers,
  };
}

export async function parseClaudeMdFile(
  path: string,
  scope: SettingsScope
): Promise<ClaudeMdFile> {
  const exists = await fileExists(path);
  if (!exists) {
    return { path, exists: false, scope };
  }
  const lineCount = await countLines(path);
  return { path, exists: true, lineCount, scope };
}

/**
 * Parse ~/.claude.json and extract per-project MCP server data.
 * Returns a map from projectPath -> McpServer[]
 */
export async function parseClaudeJson(claudeJsonPath: string): Promise<{
  globalServers: McpServer[];
  projectServers: Map<string, McpServer[]>;
}> {
  const globalServers: McpServer[] = [];
  const projectServers = new Map<string, McpServer[]>();

  const exists = await fileExists(claudeJsonPath);
  if (!exists) return { globalServers, projectServers };

  let content: string;
  try {
    content = await readFile(claudeJsonPath, "utf-8");
  } catch (err) {
    process.stderr.write(
      `Warning: could not read ${claudeJsonPath}: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return { globalServers, projectServers };
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    process.stderr.write(`Warning: ${claudeJsonPath} contains invalid JSON — MCP approval states not loaded\n`);
    return { globalServers, projectServers };
  }

  const result = ClaudeJsonSchema.safeParse(json);
  const data = result.success ? result.data : (json as typeof result.data);

  // Global MCP servers
  if (data?.mcpServers) {
    for (const [name, config] of Object.entries(data.mcpServers)) {
      const c = config as Record<string, unknown>;
      globalServers.push({
        name,
        type: (c.type as "stdio" | "http" | undefined) ?? "stdio",
        command: c.command as string | undefined,
        args: c.args as string[] | undefined,
        url: c.url as string | undefined,
        envVarNames: c.env ? Object.keys(c.env as object) : undefined,
        headerNames: c.headers ? Object.keys(c.headers as object) : undefined,
        scope: "user",
        approvalState: "approved",
      });
    }
  }

  // Per-project MCP servers
  if (data?.projects) {
    for (const [projectPath, projectData] of Object.entries(data.projects)) {
      const servers: McpServer[] = [];

      if (projectData.mcpServers) {
        const approvals = projectData.mcpServerApprovals ?? {};
        for (const [name, config] of Object.entries(projectData.mcpServers)) {
          const c = config as Record<string, unknown>;
          const approvalState =
            approvals[name] === "approved"
              ? "approved"
              : approvals[name] === "denied"
              ? "denied"
              : "pending";
          servers.push({
            name,
            type: (c.type as "stdio" | "http" | undefined) ?? "stdio",
            command: c.command as string | undefined,
            args: c.args as string[] | undefined,
            url: c.url as string | undefined,
            envVarNames: c.env ? Object.keys(c.env as object) : undefined,
            headerNames: c.headers ? Object.keys(c.headers as object) : undefined,
            scope: "local",
            approvalState,
          });
        }
      }

      projectServers.set(projectPath, servers);
    }
  }

  return { globalServers, projectServers };
}
