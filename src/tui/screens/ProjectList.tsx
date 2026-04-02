import React, { useState, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Header } from "../components/Header.js";
import type { ScanResult, ClaudeProject, PermissionMode } from "../../core/types.js";
import { collapseHome } from "../../utils/paths.js";

const MODE_COLORS: Record<PermissionMode, string> = {
  default: "gray",
  acceptEdits: "blue",
  plan: "cyan",
  auto: "yellow",
  dontAsk: "magenta",
  bypassPermissions: "red",
};

interface ProjectListProps {
  scanResult: ScanResult;
  onSelectProject: (project: ClaudeProject) => void;
  onAudit: () => void;
  onDiff: () => void;
  onQuit: () => void;
  onRefresh: () => Promise<void>;
}

export function ProjectList({
  scanResult,
  onSelectProject,
  onAudit,
  onDiff,
  onQuit,
  onRefresh,
}: ProjectListProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;

  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { projects } = scanResult;

  const filteredProjects = useMemo(() => {
    if (!filter) return projects;
    const lower = filter.toLowerCase();
    return projects.filter((p) =>
      collapseHome(p.rootPath).toLowerCase().includes(lower)
    );
  }, [projects, filter]);

  // Reserve extra row for filter bar when active
  const visibleRows = Math.max(5, termHeight - (filterMode ? 13 : 12));

  const totalWarnings = useMemo(
    () => projects.reduce((sum, p) => sum + p.effectivePermissions.warnings.length, 0),
    [projects]
  );

  // Shared up/down/enter navigation — used in both filter and normal mode
  function handleNavigate(input: string, key: { downArrow?: boolean; upArrow?: boolean; return?: boolean }) {
    if (key.downArrow || input === "j") {
      const next = Math.min(cursor + 1, filteredProjects.length - 1);
      setCursor(next);
      if (next >= scrollOffset + visibleRows) setScrollOffset(next - visibleRows + 1);
    } else if (key.upArrow || input === "k") {
      const prev = Math.max(cursor - 1, 0);
      setCursor(prev);
      if (prev < scrollOffset) setScrollOffset(prev);
    } else if (key.return) {
      if (filteredProjects[cursor]) onSelectProject(filteredProjects[cursor]);
    }
  }

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) {
        setFilter("");
        setFilterMode(false);
        setCursor(0);
        setScrollOffset(0);
      } else if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
        setCursor(0);
        setScrollOffset(0);
      } else if (key.downArrow || input === "j" || key.upArrow || input === "k" || key.return) {
        handleNavigate(input, key);
      } else if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
        setCursor(0);
        setScrollOffset(0);
      }
      return;
    }

    // Normal (non-filter) mode
    if (key.downArrow || input === "j" || key.upArrow || input === "k" || key.return) {
      handleNavigate(input, key);
    } else if (input === "a") {
      onAudit();
    } else if (input === "d") {
      onDiff();
    } else if (input === "r" && !isRefreshing) {
      setIsRefreshing(true);
      onRefresh().finally(() => setIsRefreshing(false));
    } else if (input === "/") {
      setFilterMode(true);
      setFilter("");
      setCursor(0);
      setScrollOffset(0);
    } else if (input === "q" || (key.ctrl && input === "c")) {
      onQuit();
    }
  });

  const visibleProjects = filteredProjects.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <Box flexDirection="column">
      <Header
        title="Claude Permissions Manager"
        subtitle={
          isRefreshing
            ? "Refreshing…"
            : filter
            ? `${filteredProjects.length} of ${projects.length} project(s)  •  ${totalWarnings} warning(s)  •  root: ${collapseHome(scanResult.scanRoot)}`
            : `Found ${projects.length} project(s)  •  ${totalWarnings} warning(s)  •  root: ${collapseHome(scanResult.scanRoot)}`
        }
      />

      {/* Filter bar — only shown while in filter mode */}
      {filterMode && (
        <Box marginBottom={0}>
          <Text color="cyan" bold>Filter: </Text>
          <Text>{filter}</Text>
          <Text color="cyan">█</Text>
          <Text color="gray">  (Esc to clear)</Text>
        </Box>
      )}

      {/* Column headers */}
      <Box marginBottom={0}>
        <Text color="gray" bold>
          {"  "}
          {"Project".padEnd(38)}
          {"Mode".padEnd(23)}
          {"Allow".padEnd(7)}
          {"Deny".padEnd(6)}
          {"Ask".padEnd(5)}
          {"⚠"}
        </Text>
      </Box>

      {/* Project rows */}
      {filteredProjects.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">No projects match "{filter}"</Text>
        </Box>
      )}
      {visibleProjects.map((project, i) => {
        const idx = scrollOffset + i;
        const isSelected = idx === cursor;
        const perms = project.effectivePermissions;
        const hasWarnings = perms.warnings.length > 0;
        const hasCritical = perms.warnings.some(
          (w) => w.severity === "critical"
        );
        const path = collapseHome(project.rootPath);
        const shortPath =
          path.length > 37 ? "…" + path.slice(path.length - 36) : path;

        return (
          <Box key={project.rootPath}>
            <Text
              color={isSelected ? "black" : undefined}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {isSelected ? "▶ " : "  "}
              {shortPath.padEnd(38)}
            </Text>
            <Text
              color={isSelected ? "black" : undefined}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {"  "}
            </Text>
            <Text
              color={isSelected ? "black" : (MODE_COLORS[perms.defaultMode] ?? "white")}
              backgroundColor={isSelected ? "cyan" : undefined}
              bold={!isSelected && perms.defaultMode === "bypassPermissions"}
            >
              {("[" + perms.defaultMode + "]").padEnd(19)}
            </Text>
            <Text
              color={isSelected ? "black" : undefined}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {"  "}
              <Text color={isSelected ? "black" : "green"}>
                {String(perms.allow.length).padEnd(5)}
              </Text>
              {"  "}
              <Text color={perms.deny.length > 0 ? (isSelected ? "black" : "red") : "gray"}>
                {String(perms.deny.length).padEnd(4)}
              </Text>
              {"  "}
              <Text color={perms.ask.length > 0 ? (isSelected ? "black" : "yellow") : "gray"}>
                {String(perms.ask.length).padEnd(3)}
              </Text>
              {"  "}
              {hasCritical ? (
                <Text color="red" bold>🚨 {perms.warnings.length}</Text>
              ) : hasWarnings ? (
                <Text color="yellow">⚠ {perms.warnings.length}</Text>
              ) : (
                <Text color="gray">-</Text>
              )}
              {perms.isBypassDisabled && (
                <Text color="green">  [lock]</Text>
              )}
            </Text>
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {filteredProjects.length > visibleRows && (
        <Text color="gray">
          {"  "}
          {scrollOffset > 0 ? "↑ " : "  "}
          {scrollOffset + visibleRows < filteredProjects.length
            ? `↓ ${filteredProjects.length - scrollOffset - visibleRows} more`
            : ""}
        </Text>
      )}

      {/* Global settings summary */}
      <Box marginTop={1} flexDirection="column">
        {scanResult.global.user?.exists && (
          <Text color="gray" dimColor>
            User settings: {collapseHome(scanResult.global.user.path)}
          </Text>
        )}
        {scanResult.global.managed?.exists && (
          <Text color="yellow" dimColor>
            Managed settings: {collapseHome(scanResult.global.managed.path)}
          </Text>
        )}
        {scanResult.errors.length > 0 && (
          <Text color="red" dimColor>
            {scanResult.errors.length} scan error(s)
          </Text>
        )}
      </Box>

      {/* Key hints */}
      <Box marginTop={1}>
        <Text color="gray">
          {filterMode
            ? "Type to filter  ↑↓/jk navigate  Enter: details  Esc: clear filter"
            : "↑↓/jk navigate  Enter: details  /: filter  a: audit  d: diff  r: refresh  q: quit"}
        </Text>
      </Box>
    </Box>
  );
}
