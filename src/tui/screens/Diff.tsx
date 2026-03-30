import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Header } from "../components/Header.js";
import { ModeBadge } from "../components/Badge.js";
import type { ScanResult, ClaudeProject } from "../../core/types.js";
import { collapseHome } from "../../utils/paths.js";

interface DiffProps {
  scanResult: ScanResult;
  onBack: () => void;
}

type DiffState =
  | { phase: "selectA"; cursorA: number }
  | { phase: "selectB"; projectA: ClaudeProject; cursorA: number; cursorB: number }
  | { phase: "view"; projectA: ClaudeProject; projectB: ClaudeProject; cursorA: number };

function ProjectPicker({
  projects,
  cursor,
  label,
  onSelect,
  onBack,
  scrollOffset,
  visibleRows,
}: {
  projects: ClaudeProject[];
  cursor: number;
  label: string;
  onSelect: (p: ClaudeProject) => void;
  onBack: () => void;
  scrollOffset: number;
  visibleRows: number;
}) {
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onBack();
    } else if (key.downArrow || input === "j") {
      // handled by parent
    } else if (key.upArrow || input === "k") {
      // handled by parent
    } else if (key.return) {
      if (projects[cursor]) onSelect(projects[cursor]);
    }
  });

  const visible = projects.slice(scrollOffset, scrollOffset + visibleRows);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {label}
      </Text>
      {visible.map((p, i) => {
        const idx = scrollOffset + i;
        const isSelected = idx === cursor;
        return (
          <Box key={p.rootPath}>
            <Text
              color={isSelected ? "black" : undefined}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {isSelected ? "▶ " : "  "}
              {collapseHome(p.rootPath)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function DiffView({
  projectA,
  projectB,
}: {
  projectA: ClaudeProject;
  projectB: ClaudeProject;
}) {
  const pa = projectA.effectivePermissions;
  const pb = projectB.effectivePermissions;

  const allowA = new Set(pa.allow.map((r) => r.raw));
  const allowB = new Set(pb.allow.map((r) => r.raw));
  const denyA = new Set(pa.deny.map((r) => r.raw));
  const denyB = new Set(pb.deny.map((r) => r.raw));
  const askA = new Set(pa.ask.map((r) => r.raw));
  const askB = new Set(pb.ask.map((r) => r.raw));
  const mcpSetA = new Set(pa.mcpServers.map((s) => s.name));
  const mcpSetB = new Set(pb.mcpServers.map((s) => s.name));
  const mcpMapA = new Map(pa.mcpServers.map((s) => [s.name, s]));
  const mcpMapB = new Map(pb.mcpServers.map((s) => [s.name, s]));
  const envSetA = new Set(pa.envVarNames);
  const envSetB = new Set(pb.envVarNames);
  const dirSetA = new Set(pa.additionalDirs);
  const dirSetB = new Set(pb.additionalDirs);

  const allAllow = new Set([...allowA, ...allowB]);
  const allDeny = new Set([...denyA, ...denyB]);
  const allAsk = new Set([...askA, ...askB]);
  const allEnv = new Set([...envSetA, ...envSetB]);
  const allDirs = new Set([...dirSetA, ...dirSetB]);

  type McpEntry = (typeof pa.mcpServers)[number];
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

  const mcpBothNames = [...mcpSetA].filter((n) => mcpSetB.has(n));
  const mcpModifiedNames = new Set(
    mcpBothNames.filter((n) => mcpServerChanged(mcpMapA.get(n)!, mcpMapB.get(n)!))
  );

  function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  const isIdentical =
    pa.defaultMode === pb.defaultMode &&
    pa.isBypassDisabled === pb.isBypassDisabled &&
    setsEqual(allowA, allowB) &&
    setsEqual(denyA, denyB) &&
    setsEqual(askA, askB) &&
    setsEqual(mcpSetA, mcpSetB) &&
    mcpModifiedNames.size === 0 &&
    setsEqual(envSetA, envSetB) &&
    setsEqual(dirSetA, dirSetB);

  function DiffRow({
    rule,
    inA,
    inB,
    color,
  }: {
    rule: string;
    inA: boolean;
    inB: boolean;
    color: string;
  }) {
    const both = inA && inB;
    return (
      <Box>
        <Text color={inA ? color : "gray"}>{inA ? "✓" : "✗"} </Text>
        <Text color={both ? color : inA ? color : "gray"}>
          {rule.padEnd(44)}
        </Text>
        <Text color={inB ? color : "gray"}>{inB ? "✓" : "✗"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Same-project note */}
      {projectA.rootPath === projectB.rootPath && (
        <Box marginBottom={1}>
          <Text color="yellow">Note: comparing a project with itself</Text>
        </Box>
      )}

      {/* Header row */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {"".padEnd(47)}
          {collapseHome(projectA.rootPath).slice(-16).padEnd(20)}
          {collapseHome(projectB.rootPath).slice(-16)}
        </Text>
      </Box>

      {/* Mode diff */}
      <Box marginBottom={1}>
        <Text>Mode: </Text>
        <ModeBadge mode={pa.defaultMode} />
        <Text color="gray">{"  →  "}</Text>
        <ModeBadge mode={pb.defaultMode} />
      </Box>

      {/* Bypass lock diff (only when they differ) */}
      {pa.isBypassDisabled !== pb.isBypassDisabled && (
        <Box marginBottom={1}>
          <Text>Bypass lock: </Text>
          <Text color={pa.isBypassDisabled ? "green" : "gray"}>
            {pa.isBypassDisabled ? "locked" : "not locked"}
          </Text>
          <Text color="gray">{"  →  "}</Text>
          <Text color={pb.isBypassDisabled ? "green" : "gray"}>
            {pb.isBypassDisabled ? "locked" : "not locked"}
          </Text>
        </Box>
      )}

      {/* Allow */}
      {allAllow.size > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">
            ALLOW
          </Text>
          {[...allAllow].map((r) => (
            <DiffRow
              key={r}
              rule={r}
              inA={allowA.has(r)}
              inB={allowB.has(r)}
              color="green"
            />
          ))}
        </Box>
      )}

      {/* Deny */}
      {allDeny.size > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="red">
            DENY
          </Text>
          {[...allDeny].map((r) => (
            <DiffRow
              key={r}
              rule={r}
              inA={denyA.has(r)}
              inB={denyB.has(r)}
              color="red"
            />
          ))}
        </Box>
      )}

      {/* Ask */}
      {allAsk.size > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            ASK
          </Text>
          {[...allAsk].map((r) => (
            <DiffRow
              key={r}
              rule={r}
              inA={askA.has(r)}
              inB={askB.has(r)}
              color="yellow"
            />
          ))}
        </Box>
      )}

      {/* MCP Servers */}
      {(() => {
        const allMcp = new Set([...mcpSetA, ...mcpSetB]);
        if (allMcp.size === 0) return null;
        return (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="blue">MCP SERVERS</Text>
            {[...allMcp].map((name) => {
              const inA = mcpSetA.has(name);
              const inB = mcpSetB.has(name);
              const modified = inA && inB && mcpModifiedNames.has(name);
              const sA = mcpMapA.get(name);
              const sB = mcpMapB.get(name);
              if (modified && sA && sB) {
                return (
                  <Box key={name} flexDirection="column">
                    <Text color="yellow">{"  ~ "}{name.padEnd(44)}{"(modified)"}</Text>
                    {(sA.type ?? "stdio") !== (sB.type ?? "stdio") && (
                      <Text color="gray">{"      type: "}{sA.type ?? "stdio"}{" → "}{sB.type ?? "stdio"}</Text>
                    )}
                    {(sA.command ?? "") !== (sB.command ?? "") && (
                      <Text color="gray">{"      cmd:  "}{sA.command ?? "(none)"}{" → "}{sB.command ?? "(none)"}</Text>
                    )}
                    {(sA.url ?? "") !== (sB.url ?? "") && (
                      <Text color="gray">{"      url:  "}{sA.url ?? "(none)"}{" → "}{sB.url ?? "(none)"}</Text>
                    )}
                    {(sA.approvalState ?? "pending") !== (sB.approvalState ?? "pending") && (
                      <Text color="gray">{"      approval: "}{sA.approvalState ?? "pending"}{" → "}{sB.approvalState ?? "pending"}</Text>
                    )}
                  </Box>
                );
              }
              const server = sA ?? sB;
              return (
                <Box key={name} flexDirection="column">
                  <DiffRow
                    rule={name}
                    inA={inA}
                    inB={inB}
                    color="blue"
                  />
                  {server?.command && (
                    <Text color="gray">{"    "}cmd: {server.command}</Text>
                  )}
                  {server?.url && (
                    <Text color="gray">{"    "}url: {server.url}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })()}

      {/* Env vars */}
      {allEnv.size > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="magenta">ENV VARS</Text>
          {[...allEnv].map((v) => (
            <DiffRow
              key={v}
              rule={v}
              inA={envSetA.has(v)}
              inB={envSetB.has(v)}
              color="magenta"
            />
          ))}
        </Box>
      )}

      {/* Additional dirs */}
      {allDirs.size > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">ADDITIONAL DIRS</Text>
          {[...allDirs].map((d) => (
            <DiffRow
              key={d}
              rule={d}
              inA={dirSetA.has(d)}
              inB={dirSetB.has(d)}
              color="cyan"
            />
          ))}
        </Box>
      )}

      {isIdentical && (
        <Text color="green">✓ Projects have identical effective permissions.</Text>
      )}
    </Box>
  );
}

export function Diff({ scanResult, onBack }: DiffProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const visibleRows = Math.max(5, termHeight - 14);

  const projects = scanResult.projects;
  const [state, setState] = useState<DiffState>({
    phase: "selectA",
    cursorA: 0,
  });
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    if (state.phase === "view") {
      if (key.escape || input === "q" || key.leftArrow) {
        setState({ phase: "selectA", cursorA: state.cursorA });
        setScrollOffset(0);
      }
      return;
    }

    const cursor =
      state.phase === "selectA" ? state.cursorA : state.cursorB;

    if (key.escape || (input === "q" && state.phase === "selectA")) {
      onBack();
      return;
    }
    if (key.escape && state.phase === "selectB") {
      setState({ phase: "selectA", cursorA: state.cursorA });
      setScrollOffset(0);
      return;
    }

    if (key.downArrow || input === "j") {
      const next = Math.min(cursor + 1, projects.length - 1);
      if (state.phase === "selectA") setState({ phase: "selectA", cursorA: next });
      else setState({ ...state, cursorB: next });
      if (next >= scrollOffset + visibleRows) {
        setScrollOffset(next - visibleRows + 1);
      }
    } else if (key.upArrow || input === "k") {
      const prev = Math.max(cursor - 1, 0);
      if (state.phase === "selectA") setState({ phase: "selectA", cursorA: prev });
      else setState({ ...state, cursorB: prev });
      if (prev < scrollOffset) setScrollOffset(prev);
    } else if (key.return) {
      if (state.phase === "selectA" && projects[cursor]) {
        setState({ phase: "selectB", projectA: projects[cursor], cursorA: cursor, cursorB: 0 });
        setScrollOffset(0);
      } else if (state.phase === "selectB" && projects[cursor]) {
        setState({
          phase: "view",
          projectA: state.projectA,
          projectB: projects[cursor],
          cursorA: state.cursorA,
        });
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="Compare Projects" subtitle="Select two projects to diff" />

      {state.phase === "selectA" && (
        <ProjectPicker
          projects={projects}
          cursor={state.cursorA}
          label="Select first project:"
          onSelect={(p) => {
            setState({ phase: "selectB", projectA: p, cursorA: state.cursorA, cursorB: 0 });
            setScrollOffset(0);
          }}
          onBack={onBack}
          scrollOffset={scrollOffset}
          visibleRows={visibleRows}
        />
      )}

      {state.phase === "selectB" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="gray">
              A: {collapseHome(state.projectA.rootPath)}
            </Text>
          </Box>
          <ProjectPicker
            projects={projects}
            cursor={state.cursorB}
            label="Select second project:"
            onSelect={(p) => {
              setState({
                phase: "view",
                projectA: state.projectA,
                projectB: p,
                cursorA: state.cursorA,
              });
            }}
            onBack={() => {
              setState({ phase: "selectA", cursorA: state.cursorA });
              setScrollOffset(0);
            }}
            scrollOffset={scrollOffset}
            visibleRows={visibleRows}
          />
        </Box>
      )}

      {state.phase === "view" && (
        <DiffView projectA={state.projectA} projectB={state.projectB} />
      )}

      <Box marginTop={1}>
        <Text color="gray">
          {state.phase === "view"
            ? "←/Esc/q: back to selection"
            : state.phase === "selectB"
            ? "↑↓ select  Enter: confirm  Esc: back"
            : "↑↓ select  Enter: confirm  q: back"}
        </Text>
      </Box>
    </Box>
  );
}
