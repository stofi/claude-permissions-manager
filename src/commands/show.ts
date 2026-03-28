import chalk from "chalk";
import { resolve } from "path";
import { scan } from "../core/discovery.js";
import { formatEffectivePermissions } from "../utils/format.js";
import { expandHome } from "../utils/paths.js";

export async function showCommand(
  projectPath: string | undefined,
  options: { json?: boolean } = {}
): Promise<void> {
  const targetPath = resolve(projectPath ? expandHome(projectPath) : process.cwd());

  process.stderr.write(chalk.gray(`Scanning for project at ${targetPath}...\n`));
  const result = await scan({ root: targetPath, maxDepth: 1 });

  const project = result.projects.find((p) => p.rootPath === targetPath);
  if (!project) {
    // Check if the project was found but failed to load (errors use claudeDir path)
    const loadError = result.errors.find(
      (e) => e.path === targetPath || e.path.startsWith(targetPath + "/")
    );
    if (loadError) {
      console.error(chalk.red(`Failed to load project at: ${targetPath}`));
      console.error(chalk.red(`  ${loadError.error}`));
    } else {
      console.error(chalk.red(`No .claude directory found at: ${targetPath}`));
    }
    process.exit(1);
  }

  const globalFiles = [
    result.global.user,
    result.global.managed,
  ].filter((f): f is NonNullable<typeof result.global.user> => f !== undefined);

  if (options.json) {
    const perms = project.effectivePermissions;
    const allSettingsFiles = [...project.settingsFiles, ...globalFiles];
    const output = {
      path: project.rootPath,
      settingsFiles: allSettingsFiles.map((f) => ({
        path: f.path,
        scope: f.scope,
        exists: f.exists,
        readable: f.readable,
        parsed: f.parsed,
        parseError: f.parseError,
      })),
      effectivePermissions: {
        defaultMode: perms.defaultMode,
        allow: perms.allow.map((r) => ({ rule: r.raw, scope: r.scope })),
        deny: perms.deny.map((r) => ({ rule: r.raw, scope: r.scope })),
        ask: perms.ask.map((r) => ({ rule: r.raw, scope: r.scope })),
        isBypassDisabled: perms.isBypassDisabled,
        envVarNames: perms.envVarNames,
        additionalDirs: perms.additionalDirs,
      },
      mcpServers: perms.mcpServers.map((s) => ({
        name: s.name,
        type: s.type,
        scope: s.scope,
        approvalState: s.approvalState,
        envVarNames: s.envVarNames,
        headerNames: s.headerNames,
      })),
      claudeMdFiles: project.claudeMdFiles,
      warnings: perms.warnings,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(formatEffectivePermissions(project, globalFiles));
}
