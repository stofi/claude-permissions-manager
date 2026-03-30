import chalk from "chalk";
import { resolve } from "path";
import { scan } from "../core/discovery.js";
import { expandHome, collapseHome } from "../utils/paths.js";
import type { SettingsScope } from "../core/types.js";

export async function diffCommand(
  path1: string,
  path2: string,
  opts: { json?: boolean } = {}
): Promise<void> {
  const root1 = resolve(expandHome(path1));
  const root2 = resolve(expandHome(path2));

  if (root1 === root2) {
    console.log(chalk.yellow("Note: comparing a project with itself — paths resolve to the same directory."));
  }

  const [result1, result2] = await Promise.all([
    scan({ root: root1, maxDepth: 1 }),
    scan({ root: root2, maxDepth: 1 }),
  ]);

  const proj1 = result1.projects.find((p) => p.rootPath === root1);
  const proj2 = result2.projects.find((p) => p.rootPath === root2);

  if (!proj1) {
    console.error(chalk.red(`No .claude directory found at: ${root1}`));
    process.exit(1);
  }
  if (!proj2) {
    console.error(chalk.red(`No .claude directory found at: ${root2}`));
    process.exit(1);
  }

  const p1 = proj1.effectivePermissions;
  const p2 = proj2.effectivePermissions;

  const mcpNamesA = new Set(p1.mcpServers.map((s) => s.name));
  const mcpNamesB = new Set(p2.mcpServers.map((s) => s.name));
  const mcpMapA = new Map(p1.mcpServers.map((s) => [s.name, s]));
  const mcpMapB = new Map(p2.mcpServers.map((s) => [s.name, s]));

  type McpEntry = (typeof p1.mcpServers)[number];
  function mcpServerChanged(a: McpEntry, b: McpEntry): boolean {
    if ((a.type ?? "stdio") !== (b.type ?? "stdio")) return true;
    if ((a.command ?? null) !== (b.command ?? null)) return true;
    if (JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? [])) return true;
    if ((a.url ?? null) !== (b.url ?? null)) return true;
    if ((a.approvalState ?? "pending") !== (b.approvalState ?? "pending")) return true;
    const sortStr = (arr: string[] | undefined) => [...(arr ?? [])].sort().join("\0");
    if (sortStr(a.envVarNames) !== sortStr(b.envVarNames)) return true;
    return false;
  }

  if (opts.json) {
    // Pre-compute Sets for O(1) lookup instead of O(n) per-item scan
    const p1AllowRaws = new Set(p1.allow.map((r) => r.raw));
    const p2AllowRaws = new Set(p2.allow.map((r) => r.raw));
    const p1DenyRaws = new Set(p1.deny.map((r) => r.raw));
    const p2DenyRaws = new Set(p2.deny.map((r) => r.raw));
    const p1AskRaws = new Set(p1.ask.map((r) => r.raw));
    const p2AskRaws = new Set(p2.ask.map((r) => r.raw));

    const toRuleObj = (r: { raw: string; scope: SettingsScope }) => ({ rule: r.raw, scope: r.scope });
    const allowOnlyA = p1.allow.filter((r) => !p2AllowRaws.has(r.raw)).map(toRuleObj);
    const allowOnlyB = p2.allow.filter((r) => !p1AllowRaws.has(r.raw)).map(toRuleObj);
    const denyOnlyA = p1.deny.filter((r) => !p2DenyRaws.has(r.raw)).map(toRuleObj);
    const denyOnlyB = p2.deny.filter((r) => !p1DenyRaws.has(r.raw)).map(toRuleObj);
    const askOnlyA = p1.ask.filter((r) => !p2AskRaws.has(r.raw)).map(toRuleObj);
    const askOnlyB = p2.ask.filter((r) => !p1AskRaws.has(r.raw)).map(toRuleObj);
    const toMcpObj = (s: (typeof p1.mcpServers)[number]) => ({
      name: s.name,
      type: s.type ?? "stdio",
      scope: s.scope,
      approvalState: s.approvalState ?? "pending",
      command: s.command,
      args: s.args,
      url: s.url,
      envVarNames: s.envVarNames ?? [],
      headerNames: s.headerNames ?? [],
    });
    const mcpOnlyA = p1.mcpServers.filter((s) => !mcpNamesB.has(s.name)).map(toMcpObj);
    const mcpOnlyB = p2.mcpServers.filter((s) => !mcpNamesA.has(s.name)).map(toMcpObj);
    const mcpBothNames = [...mcpNamesA].filter((n) => mcpNamesB.has(n));
    const mcpModified = mcpBothNames
      .filter((n) => mcpServerChanged(mcpMapA.get(n)!, mcpMapB.get(n)!))
      .map((n) => ({ name: n, a: toMcpObj(mcpMapA.get(n)!), b: toMcpObj(mcpMapB.get(n)!) }));
    const mcpInBoth = mcpBothNames.filter(
      (n) => !mcpServerChanged(mcpMapA.get(n)!, mcpMapB.get(n)!)
    );
    const envNamesA = new Set(p1.envVarNames);
    const envNamesB = new Set(p2.envVarNames);
    const envOnlyA = p1.envVarNames.filter((v) => !envNamesB.has(v));
    const envOnlyB = p2.envVarNames.filter((v) => !envNamesA.has(v));
    const dirNamesA = new Set(p1.additionalDirs);
    const dirNamesB = new Set(p2.additionalDirs);
    const dirsOnlyA = p1.additionalDirs.filter((d) => !dirNamesB.has(d));
    const dirsOnlyB = p2.additionalDirs.filter((d) => !dirNamesA.has(d));
    const identical =
      p1.defaultMode === p2.defaultMode &&
      p1.isBypassDisabled === p2.isBypassDisabled &&
      allowOnlyA.length === 0 && allowOnlyB.length === 0 &&
      denyOnlyA.length === 0 && denyOnlyB.length === 0 &&
      askOnlyA.length === 0 && askOnlyB.length === 0 &&
      mcpOnlyA.length === 0 && mcpOnlyB.length === 0 &&
      mcpModified.length === 0 &&
      envOnlyA.length === 0 && envOnlyB.length === 0 &&
      dirsOnlyA.length === 0 && dirsOnlyB.length === 0;

    const output = {
      projectA: root1,
      projectB: root2,
      identical,
      mode: { a: p1.defaultMode, b: p2.defaultMode },
      isBypassDisabled: { a: p1.isBypassDisabled, b: p2.isBypassDisabled },
      allow: {
        onlyInA: allowOnlyA,
        onlyInB: allowOnlyB,
        inBoth: p1.allow.filter((r) => p2AllowRaws.has(r.raw)).map((r) => r.raw),
      },
      deny: {
        onlyInA: denyOnlyA,
        onlyInB: denyOnlyB,
        inBoth: p1.deny.filter((r) => p2DenyRaws.has(r.raw)).map((r) => r.raw),
      },
      ask: {
        onlyInA: askOnlyA,
        onlyInB: askOnlyB,
        inBoth: p1.ask.filter((r) => p2AskRaws.has(r.raw)).map((r) => r.raw),
      },
      mcpServers: {
        onlyInA: mcpOnlyA,
        onlyInB: mcpOnlyB,
        inBoth: mcpInBoth,
        modified: mcpModified,
      },
      envVarNames: {
        onlyInA: envOnlyA,
        onlyInB: envOnlyB,
        inBoth: p1.envVarNames.filter((v) => envNamesB.has(v)),
      },
      additionalDirs: {
        onlyInA: dirsOnlyA,
        onlyInB: dirsOnlyB,
        inBoth: p1.additionalDirs.filter((d) => dirNamesB.has(d)),
      },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const shortA = collapseHome(root1);
  const shortB = collapseHome(root2);

  console.log(`\nDiff: ${chalk.cyan(shortA)} vs ${chalk.cyan(shortB)}\n`);

  // Mode
  if (p1.defaultMode !== p2.defaultMode) {
    console.log(
      chalk.bold("Mode:") +
      `  ${chalk.yellow(p1.defaultMode)} → ${chalk.yellow(p2.defaultMode)}`
    );
  } else {
    console.log(chalk.bold("Mode:") + `  ${chalk.gray(p1.defaultMode)} (same)`);
  }

  // Bypass lock
  if (p1.isBypassDisabled !== p2.isBypassDisabled) {
    const aStr = p1.isBypassDisabled ? "locked" : "not locked";
    const bStr = p2.isBypassDisabled ? "locked" : "not locked";
    console.log(chalk.bold("Bypass lock:") + `  ${chalk.yellow(aStr)} → ${chalk.yellow(bStr)}`);
  } else {
    const sameStr = p1.isBypassDisabled ? "locked" : "not locked";
    console.log(chalk.bold("Bypass lock:") + `  ${chalk.gray(sameStr)} (same)`);
  }

  console.log("");

  function printDiff(
    label: string,
    rulesA: { raw: string }[],
    rulesB: { raw: string }[],
    color: string
  ) {
    const setA = new Set(rulesA.map((r) => r.raw));
    const setB = new Set(rulesB.map((r) => r.raw));
    const all = new Set([...setA, ...setB]);
    if (all.size === 0) return;

    console.log(chalk.bold(label));
    for (const rule of all) {
      const inA = setA.has(rule);
      const inB = setB.has(rule);
      if (inA && inB) {
        console.log(chalk.gray(`  = ${rule}`));
      } else if (inA && !inB) {
        console.log(chalk.red(`  - ${rule}  (only in A)`));
      } else {
        console.log(chalk.green(`  + ${rule}  (only in B)`));
      }
    }
    console.log("");
  }

  printDiff("ALLOW", p1.allow, p2.allow, "green");
  printDiff("DENY", p1.deny, p2.deny, "red");
  printDiff("ASK", p1.ask, p2.ask, "yellow");

  // Helper for plain string set diffs (env vars, dirs)
  function printStringsDiff(label: string, a: string[], b: string[]) {
    const setA = new Set(a);
    const setB = new Set(b);
    const all = new Set([...setA, ...setB]);
    if (all.size === 0) return;
    console.log(chalk.bold(label));
    for (const v of all) {
      if (setA.has(v) && setB.has(v)) {
        console.log(chalk.gray(`  = ${v}`));
      } else if (setA.has(v)) {
        console.log(chalk.red(`  - ${v}  (only in A)`));
      } else {
        console.log(chalk.green(`  + ${v}  (only in B)`));
      }
    }
    console.log("");
  }

  printStringsDiff("ENV VARS", p1.envVarNames, p2.envVarNames);
  printStringsDiff("ADDITIONAL DIRS", p1.additionalDirs, p2.additionalDirs);

  // MCP servers diff
  const allMcp = new Set([...mcpNamesA, ...mcpNamesB]);
  if (allMcp.size > 0) {
    console.log(chalk.bold("MCP SERVERS"));
    for (const name of allMcp) {
      const inA = mcpNamesA.has(name);
      const inB = mcpNamesB.has(name);
      if (inA && inB) {
        const sA = mcpMapA.get(name)!;
        const sB = mcpMapB.get(name)!;
        if (mcpServerChanged(sA, sB)) {
          console.log(chalk.yellow(`  ~ ${name}  (modified)`));
          const typeA = sA.type ?? "stdio"; const typeB = sB.type ?? "stdio";
          if (typeA !== typeB) console.log(chalk.gray(`      type: ${typeA} → ${typeB}`));
          if ((sA.command ?? "") !== (sB.command ?? "")) {
            console.log(chalk.gray(`      cmd:  ${sA.command ?? "(none)"} → ${sB.command ?? "(none)"}`));
          }
          if (JSON.stringify(sA.args ?? []) !== JSON.stringify(sB.args ?? [])) {
            console.log(chalk.gray(`      args: [${(sA.args ?? []).join(", ")}] → [${(sB.args ?? []).join(", ")}]`));
          }
          if ((sA.url ?? "") !== (sB.url ?? "")) {
            console.log(chalk.gray(`      url:  ${sA.url ?? "(none)"} → ${sB.url ?? "(none)"}`));
          }
          const apA = sA.approvalState ?? "pending"; const apB = sB.approvalState ?? "pending";
          if (apA !== apB) console.log(chalk.gray(`      approval: ${apA} → ${apB}`));
        } else {
          console.log(chalk.gray(`  = ${name}`));
        }
      } else if (inA) {
        console.log(chalk.red(`  - ${name}  (only in A)`));
      } else {
        console.log(chalk.green(`  + ${name}  (only in B)`));
      }
    }
    console.log("");
  }

  function setsEqual(a: { raw: string }[], b: { raw: string }[]): boolean {
    const sa = new Set(a.map((r) => r.raw));
    const sb = new Set(b.map((r) => r.raw));
    if (sa.size !== sb.size) return false;
    for (const v of sa) if (!sb.has(v)) return false;
    return true;
  }

  function setsOfStringsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  const hasChanges =
    p1.defaultMode !== p2.defaultMode ||
    p1.isBypassDisabled !== p2.isBypassDisabled ||
    !setsEqual(p1.allow, p2.allow) ||
    !setsEqual(p1.deny, p2.deny) ||
    !setsEqual(p1.ask, p2.ask) ||
    !setsOfStringsEqual(mcpNamesA, mcpNamesB) ||
    !setsOfStringsEqual(new Set(p1.envVarNames), new Set(p2.envVarNames)) ||
    !setsOfStringsEqual(new Set(p1.additionalDirs), new Set(p2.additionalDirs));

  if (!hasChanges) {
    console.log(chalk.green("✓ Projects have identical effective permissions."));
  }
}
