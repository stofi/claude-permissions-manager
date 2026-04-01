import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import chalk from "chalk";
import { resolveSettingsPath, readSettingsOrEmpty } from "../core/writer.js";
import { collapseHome, expandHome } from "../utils/paths.js";
import type { SettingsScope } from "../core/types.js";

interface EditOptions {
  project?: string;
  scope?: string;
}

export async function editCommand(opts: EditOptions): Promise<void> {
  const scope = (opts.scope ?? "local") as SettingsScope;
  const projectPath = opts.project
    ? resolve(expandHome(opts.project))
    : process.cwd();

  const settingsPath = resolveSettingsPath(scope, projectPath);

  // Ensure parent directory exists
  await mkdir(dirname(settingsPath), { recursive: true });

  // Create an empty settings file if it doesn't exist yet
  if (!existsSync(settingsPath)) {
    const stub = await readSettingsOrEmpty(settingsPath); // returns {}
    await writeFile(settingsPath, JSON.stringify(stub, null, 2) + "\n", "utf-8");
    console.log(chalk.gray(`Created empty settings file: ${collapseHome(settingsPath)}`));
  }

  const editor =
    process.env.VISUAL ?? process.env.EDITOR ?? "vi";

  console.log(chalk.gray(`Opening ${collapseHome(settingsPath)} [${scope}] in ${editor}...`));

  await new Promise<void>((res, rej) => {
    const child = spawn(editor, [settingsPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", () => res());
    child.on("error", rej);
  });
}
