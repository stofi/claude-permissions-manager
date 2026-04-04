import chalk from "chalk";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";
import type { McpServer } from "../core/types.js";

type ApprovalState = "approved" | "denied" | "pending";

interface McpEntry {
  name: string;
  type: string;
  count: number;
  approvalCounts: Record<ApprovalState, number>;
  projects: Array<{
    path: string;
    approvalState: ApprovalState;
    scope: string;
    command?: string;
    args?: string[];
    url?: string;
    envVarNames?: string[];
  }>;
}

function approvalColor(state: ApprovalState): string {
  if (state === "approved") return chalk.green(state);
  if (state === "denied") return chalk.red(state);
  return chalk.yellow(state);
}

export async function mcpCommand(
  serverName: string | undefined,
  options: ScanOptions & {
    json?: boolean;
    type?: string;
    approval?: string;
  }
): Promise<void> {
  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  // Gather all MCP servers from all projects (effective permissions already merges all scopes)
  const allServers: Array<{ server: McpServer; projectPath: string }> = [];
  for (const project of result.projects) {
    for (const server of project.effectivePermissions.mcpServers) {
      allServers.push({ server, projectPath: project.rootPath });
    }
  }

  // Apply filters
  let filtered = allServers;
  if (options.type) {
    filtered = filtered.filter((s) => (s.server.type ?? "stdio") === options.type);
  }
  if (options.approval) {
    filtered = filtered.filter((s) => (s.server.approvalState ?? "pending") === options.approval);
  }
  if (serverName) {
    filtered = filtered.filter((s) => s.server.name === serverName);
  }

  // Group by server name
  const map = new Map<string, McpEntry>();
  for (const { server, projectPath } of filtered) {
    const name = server.name;
    if (!map.has(name)) {
      map.set(name, {
        name,
        type: server.type ?? "stdio",
        count: 0,
        approvalCounts: { approved: 0, denied: 0, pending: 0 },
        projects: [],
      });
    }
    const entry = map.get(name)!;
    entry.count++;
    const state: ApprovalState = (server.approvalState as ApprovalState | undefined) ?? "pending";
    entry.approvalCounts[state]++;
    entry.projects.push({
      path: projectPath,
      approvalState: state,
      scope: server.scope,
      command: server.command,
      args: server.args,
      url: server.url,
      envVarNames: server.envVarNames,
    });
  }

  // Sort by frequency desc, then name asc
  const entries = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // ── JSON output ──────────────────────────────────────────────
  if (options.json) {
    const summary = entries.map((e) => ({
      name: e.name,
      type: e.type,
      projectCount: e.count,
      approvalCounts: e.approvalCounts,
      projects: e.projects.map((p) => ({
        path: p.path,
        approvalState: p.approvalState,
        scope: p.scope,
        command: p.command ?? null,
        args: p.args ?? [],
        url: p.url ?? null,
        envVarNames: p.envVarNames ?? [],
      })),
    }));
    console.log(JSON.stringify({
      typeFilter: options.type ?? null,
      approvalFilter: options.approval ?? null,
      nameFilter: serverName ?? null,
      totalProjects: result.projects.length,
      totalServerCount: filtered.length,
      uniqueServerCount: entries.length,
      servers: summary,
    }, null, 2));
    return;
  }

  // ── Text output ──────────────────────────────────────────────
  if (entries.length === 0) {
    if (serverName) {
      console.log(chalk.yellow(`\nNo MCP server named "${serverName}" found.`));
    } else {
      console.log(chalk.yellow("\nNo MCP servers found."));
    }
    return;
  }

  const typeLabel = options.type ? ` [${options.type}]` : "";
  const approvalLabel = options.approval ? ` [${options.approval}]` : "";
  const nameLabel = serverName ? ` matching "${serverName}"` : "";

  // Detail mode: single server name
  if (serverName && entries.length === 1) {
    const e = entries[0]!;
    const approvalSummary = (Object.entries(e.approvalCounts) as [ApprovalState, number][])
      .filter(([, n]) => n > 0)
      .map(([state, n]) => `${approvalColor(state)}: ${n}`)
      .join(", ");
    console.log(`\nMCP server: ${chalk.bold(e.name)}  ${chalk.dim(`[${e.type}]`)}  ${approvalSummary}`);
    console.log(`\n${e.projects.length} project(s):\n`);
    for (const p of e.projects.sort((a, b) => a.path.localeCompare(b.path))) {
      const connStr = p.command
        ? chalk.dim(`command: ${p.command}${p.args?.length ? " " + p.args.join(" ") : ""}`)
        : p.url
          ? chalk.dim(`url: ${p.url}`)
          : "";
      const envStr = p.envVarNames?.length
        ? chalk.dim(`  env: ${p.envVarNames.join(", ")}`)
        : "";
      console.log(
        `  ${collapseHome(p.path).padEnd(45)}  ${approvalColor(p.approvalState).padEnd(8)}  ${chalk.dim(`[${p.scope}]`)}  ${connStr}${envStr}`
      );
    }
    return;
  }

  // List mode: all servers
  const projectWord = result.projects.length === 1 ? "project" : "projects";
  console.log(`\n${chalk.bold(entries.length)} unique MCP server(s)${typeLabel}${approvalLabel}${nameLabel} across ${chalk.bold(result.projects.length)} ${projectWord}:\n`);

  for (const e of entries) {
    const countStr = e.count === 1 ? "1 project " : `${e.count} projects`;
    const approvalParts = (Object.entries(e.approvalCounts) as [ApprovalState, number][])
      .filter(([, n]) => n > 0)
      .map(([state, n]) => `${approvalColor(state)}: ${n}`)
      .join(", ");
    console.log(`  ${e.name.padEnd(35)}  ${chalk.dim(countStr.padEnd(12))}  [${approvalParts}]`);
    if (result.projects.length <= 20) {
      for (const p of e.projects.sort((a, b) => a.path.localeCompare(b.path))) {
        console.log(`           ${chalk.dim(collapseHome(p.path))}  ${approvalColor(p.approvalState)}`);
      }
    }
  }
}
