import chalk from "chalk";
import { resolve } from "path";
import { scan } from "../core/discovery.js";
import { expandHome, collapseHome } from "../utils/paths.js";

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

  if (opts.json) {
    const allowOnlyA = p1.allow.filter((r) => !p2.allow.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const allowOnlyB = p2.allow.filter((r) => !p1.allow.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const denyOnlyA = p1.deny.filter((r) => !p2.deny.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const denyOnlyB = p2.deny.filter((r) => !p1.deny.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const askOnlyA = p1.ask.filter((r) => !p2.ask.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const askOnlyB = p2.ask.filter((r) => !p1.ask.some((x) => x.raw === r.raw)).map((r) => ({ rule: r.raw, scope: r.scope }));
    const mcpOnlyA = [...mcpNamesA].filter((n) => !mcpNamesB.has(n));
    const mcpOnlyB = [...mcpNamesB].filter((n) => !mcpNamesA.has(n));
    const identical =
      p1.defaultMode === p2.defaultMode &&
      p1.isBypassDisabled === p2.isBypassDisabled &&
      allowOnlyA.length === 0 && allowOnlyB.length === 0 &&
      denyOnlyA.length === 0 && denyOnlyB.length === 0 &&
      askOnlyA.length === 0 && askOnlyB.length === 0 &&
      mcpOnlyA.length === 0 && mcpOnlyB.length === 0;

    const output = {
      projectA: root1,
      projectB: root2,
      identical,
      mode: { a: p1.defaultMode, b: p2.defaultMode },
      isBypassDisabled: { a: p1.isBypassDisabled, b: p2.isBypassDisabled },
      allow: {
        onlyInA: allowOnlyA,
        onlyInB: allowOnlyB,
        inBoth: p1.allow.filter((r) => p2.allow.some((x) => x.raw === r.raw)).map((r) => r.raw),
      },
      deny: {
        onlyInA: denyOnlyA,
        onlyInB: denyOnlyB,
        inBoth: p1.deny.filter((r) => p2.deny.some((x) => x.raw === r.raw)).map((r) => r.raw),
      },
      ask: {
        onlyInA: askOnlyA,
        onlyInB: askOnlyB,
        inBoth: p1.ask.filter((r) => p2.ask.some((x) => x.raw === r.raw)).map((r) => r.raw),
      },
      mcpServers: {
        onlyInA: mcpOnlyA,
        onlyInB: mcpOnlyB,
        inBoth: [...mcpNamesA].filter((n) => mcpNamesB.has(n)),
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

  // MCP servers diff
  const allMcp = new Set([...mcpNamesA, ...mcpNamesB]);
  if (allMcp.size > 0) {
    console.log(chalk.bold("MCP SERVERS"));
    for (const name of allMcp) {
      const inA = mcpNamesA.has(name);
      const inB = mcpNamesB.has(name);
      if (inA && inB) {
        console.log(chalk.gray(`  = ${name}`));
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
    !setsOfStringsEqual(mcpNamesA, mcpNamesB);

  if (!hasChanges) {
    console.log(chalk.green("✓ Projects have identical effective permissions."));
  }
}
