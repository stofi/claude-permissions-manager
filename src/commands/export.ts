import chalk from "chalk";
import { dirname } from "path";
import { stat } from "fs/promises";
import { scan } from "../core/discovery.js";
import { collapseHome } from "../utils/paths.js";
import type { ScanOptions } from "../core/discovery.js";
import type { ClaudeProject } from "../core/types.js";

type ExportFormat = "json" | "csv";

/** Safely coerce a possibly-corrupt settings field to a string array */
function toStringArray(val: unknown): string[] {
  return Array.isArray(val) ? (val as string[]) : [];
}

function projectToJsonRecord(project: ClaudeProject) {
  const perms = project.effectivePermissions;
  return {
    path: project.rootPath,
    mode: perms.defaultMode,
    isBypassDisabled: perms.isBypassDisabled,
    allow: perms.allow.map((r) => ({ rule: r.raw, scope: r.scope })),
    deny: perms.deny.map((r) => ({ rule: r.raw, scope: r.scope })),
    ask: perms.ask.map((r) => ({ rule: r.raw, scope: r.scope })),
    mcpServers: perms.mcpServers.map((s) => ({
      name: s.name,
      type: s.type ?? "stdio",
      scope: s.scope,
      approvalState: s.approvalState ?? "pending",
      command: s.command,
      args: s.args,
      url: s.url,
      envVarNames: s.envVarNames ?? [],
      headerNames: s.headerNames ?? [],
    })),
    envVarNames: perms.envVarNames,
    additionalDirs: perms.additionalDirs,
    warningCount: perms.warnings.length,
    claudeMdFiles: project.claudeMdFiles
      .filter((f) => f.exists)
      .map((f) => f.path),
    settingsFiles: project.settingsFiles.map((f) => ({
      path: f.path,
      scope: f.scope,
      exists: f.exists,
      readable: f.readable,
      parsed: f.parsed,
      parseError: f.parseError,
    })),
  };
}

function toCsv(projects: ClaudeProject[]): string {
  const headers = [
    "path",
    "mode",
    "allow_count",
    "deny_count",
    "ask_count",
    "mcp_count",
    "warning_count",
    "bypass_disabled",
  ];

  const rows = projects.map((p) => {
    const perms = p.effectivePermissions;
    return [
      JSON.stringify(p.rootPath),
      perms.defaultMode,
      perms.allow.length,
      perms.deny.length,
      perms.ask.length,
      perms.mcpServers.length,
      perms.warnings.length,
      perms.isBypassDisabled,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export async function exportCommand(
  options: ScanOptions & { format?: string; output?: string }
): Promise<void> {
  const format = (options.format ?? "json") as ExportFormat;
  if (format !== "json" && format !== "csv") {
    console.error(chalk.red(`Unknown format "${format}". Use: json, csv`));
    process.exit(1);
  }

  process.stderr.write(chalk.gray("Scanning for Claude projects...\n"));
  const result = await scan(options);

  let output: string;

  if (format === "json") {
    const data = {
      generatedAt: result.scannedAt.toISOString(),
      scanRoot: result.scanRoot,
      globalSettings: {
        user: result.global.user
          ? {
              path: result.global.user.path,
              exists: result.global.user.exists,
              parsed: result.global.user.parsed,
              allow: toStringArray(result.global.user.data?.permissions?.allow),
              deny: toStringArray(result.global.user.data?.permissions?.deny),
              ask: toStringArray(result.global.user.data?.permissions?.ask),
              mode: result.global.user.data?.permissions?.defaultMode,
            }
          : null,
        managed: result.global.managed
          ? {
              path: result.global.managed.path,
              exists: result.global.managed.exists,
              parsed: result.global.managed.parsed,
              allow: toStringArray(result.global.managed.data?.permissions?.allow),
              deny: toStringArray(result.global.managed.data?.permissions?.deny),
              ask: toStringArray(result.global.managed.data?.permissions?.ask),
              mode: result.global.managed.data?.permissions?.defaultMode,
            }
          : null,
        userMcpServers: result.global.userMcpServers.map((s) => ({
          name: s.name,
          type: s.type ?? "stdio",
          scope: s.scope,
          approvalState: s.approvalState ?? "pending",
          command: s.command,
          args: s.args,
          url: s.url,
          envVarNames: s.envVarNames ?? [],
          headerNames: s.headerNames ?? [],
        })),
      },
      projects: result.projects.map(projectToJsonRecord),
      errors: result.errors,
    };
    output = JSON.stringify(data, null, 2);
  } else {
    output = toCsv(result.projects);
  }

  if (options.output) {
    const dir = dirname(options.output);
    try {
      await stat(dir);
    } catch {
      throw new Error(`Output directory does not exist: ${dir}`);
    }
    const { writeFile } = await import("fs/promises");
    await writeFile(options.output, output, "utf-8");
    process.stderr.write(
      chalk.green(`✓ Exported ${result.projects.length} projects to ${options.output}\n`)
    );
  } else {
    process.stdout.write(output + "\n");
  }
}
