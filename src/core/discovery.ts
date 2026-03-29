import { readdir, stat, realpath } from "fs/promises";
import { join, relative, resolve } from "path";
import {
  parseSettingsFile,
  parseMcpFile,
  parseClaudeMdFile,
  parseClaudeJson,
} from "./parser.js";
import { mergeSettingsFiles } from "./merger.js";
import type {
  ClaudeProject,
  GlobalSettings,
  ScanResult,
  SettingsFile,
} from "./types.js";
import {
  homeDir,
  userSettingsPath,
  managedSettingsPath,
  claudeJsonPath,
  SKIP_DIR_NAMES,
  SKIP_DIRS,
} from "../utils/paths.js";

export interface ScanOptions {
  root?: string;
  maxDepth?: number;
  includeGlobal?: boolean;
}

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  root: homeDir(),
  maxDepth: 8,
  includeGlobal: true,
};

/**
 * Recursively find all .claude directories under root
 */
async function findClaudeDirs(
  dir: string,
  depth: number,
  maxDepth: number,
  results: string[],
  errors: Array<{ path: string; error: string }>,
  visitedInodes = new Set<number>()
): Promise<void> {
  if (depth > maxDepth) return;
  if (SKIP_DIRS.has(dir)) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Permission denied or other error — skip silently
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP_DIR_NAMES.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    let resolvedPath = fullPath;

    if (entry.isSymbolicLink()) {
      // Resolve to detect cycles and to get the canonical path for comparisons
      try {
        const real = await realpath(fullPath);
        const st = await stat(real);
        if (!st.isDirectory()) continue;
        if (visitedInodes.has(st.ino)) continue; // cycle
        visitedInodes.add(st.ino);
        resolvedPath = real;
      } catch (err) {
        // Broken symlink (target deleted or permission denied) — record and skip
        errors.push({
          path: fullPath,
          error: `Broken symlink: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }

    if (entry.name === ".claude") {
      // Skip ~/.claude — it's the user global settings dir, not a project.
      // Use resolvedPath so a symlink pointing to ~/.claude is also skipped.
      const userClaudeDir = join(homeDir(), ".claude");
      if (resolvedPath !== userClaudeDir) {
        results.push(fullPath);
      }
      // Don't recurse into .claude dirs themselves
      continue;
    }

    await findClaudeDirs(
      fullPath,
      depth + 1,
      maxDepth,
      results,
      errors,
      visitedInodes
    );
  }
}

async function buildProject(
  claudeDir: string,
  projectMcpServers: Map<string, import("./types.js").McpServer[]>,
  globalSettings: SettingsFile[],
  userMcpServers: import("./types.js").McpServer[]
): Promise<ClaudeProject> {
  const rootPath = resolve(claudeDir, "..");

  // Parse project-level settings files
  const projectSettings = await parseSettingsFile(
    join(claudeDir, "settings.json"),
    "project"
  );
  const localSettings = await parseSettingsFile(
    join(claudeDir, "settings.local.json"),
    "local"
  );

  const settingsFiles: SettingsFile[] = [localSettings, projectSettings];

  // MCP file in project root
  const mcpFile = await parseMcpFile(rootPath, "project");

  // CLAUDE.md files
  const claudeMdFiles = await Promise.all([
    parseClaudeMdFile(join(rootPath, "CLAUDE.md"), "project"),
    parseClaudeMdFile(join(claudeDir, "CLAUDE.md"), "project"),
  ]);

  // Collect MCP servers, deduplicating by name.
  // Priority (lowest → highest): global user servers → .mcp.json → project-specific.
  // Later entries always overwrite earlier ones so higher-priority sources win.
  const mcpByName = new Map<string, import("./types.js").McpServer>();
  for (const server of [
    ...userMcpServers,                          // global user (lowest priority)
    ...mcpFile.servers,                         // .mcp.json project declaration
    ...(projectMcpServers.get(rootPath) ?? []), // project-specific approvals (highest)
  ]) {
    mcpByName.set(server.name, server);
  }
  const allMcpServers = [...mcpByName.values()];

  // Merge: local > project > user > managed
  const allFiles = [...settingsFiles, ...globalSettings];
  const effectivePermissions = mergeSettingsFiles(allFiles, allMcpServers);

  return {
    rootPath,
    claudeDir,
    settingsFiles,
    mcpFile: mcpFile.exists ? mcpFile : undefined,
    claudeMdFiles: claudeMdFiles.filter((f) => f.exists),
    effectivePermissions,
  };
}

export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: Array<{ path: string; error: string }> = [];
  const scannedAt = new Date();

  // Load global settings
  const global: GlobalSettings = {
    userMcpServers: [],
  };

  let userFile: SettingsFile | undefined;
  let managedFile: SettingsFile | undefined;
  let projectServers: Awaited<ReturnType<typeof parseClaudeJson>>["projectServers"] = new Map();

  if (opts.includeGlobal) {
    const [mf, uf] = await Promise.all([
      parseSettingsFile(managedSettingsPath(), "managed"),
      parseSettingsFile(userSettingsPath(), "user"),
    ]);
    managedFile = mf;
    userFile = uf;

    if (managedFile.exists) global.managed = managedFile;
    if (userFile.exists) global.user = userFile;

    // Parse ~/.claude.json for MCP data
    const parsed = await parseClaudeJson(claudeJsonPath());
    global.userMcpServers = parsed.globalServers;
    projectServers = parsed.projectServers;
  }

  // Find all .claude directories
  const claudeDirs: string[] = [];
  await findClaudeDirs(opts.root, 0, opts.maxDepth, claudeDirs, errors);

  // Build global settings array for merging (lowest priority at end)
  const globalSettingsFiles: SettingsFile[] = [];
  if (userFile?.exists) globalSettingsFiles.push(userFile);
  if (managedFile?.exists) globalSettingsFiles.push(managedFile);

  // Build projects in parallel (batched to avoid overwhelming I/O)
  const BATCH_SIZE = 10;
  const projects: ClaudeProject[] = [];

  for (let i = 0; i < claudeDirs.length; i += BATCH_SIZE) {
    const batch = claudeDirs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((dir) => buildProject(dir, projectServers, globalSettingsFiles, global.userMcpServers))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        projects.push(result.value);
      } else {
        errors.push({
          path: batch[j],
          error: result.reason instanceof Error
            ? `${result.reason.name}: ${result.reason.message}`
            : String(result.reason),
        });
      }
    }
  }

  // Sort by path for stable output
  projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));

  return {
    global,
    projects,
    scanRoot: opts.root,
    scannedAt,
    errors,
  };
}
