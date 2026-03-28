import React, { useState } from "react";
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
}

export function ProjectList({
  scanResult,
  onSelectProject,
  onAudit,
  onDiff,
  onQuit,
}: ProjectListProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const visibleRows = Math.max(5, termHeight - 12);

  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const { projects } = scanResult;
  const totalWarnings = projects.reduce(
    (sum, p) => sum + p.effectivePermissions.warnings.length,
    0
  );

  useInput((input, key) => {
    if (key.downArrow || input === "j") {
      const next = Math.min(cursor + 1, projects.length - 1);
      setCursor(next);
      if (next >= scrollOffset + visibleRows) {
        setScrollOffset(next - visibleRows + 1);
      }
    } else if (key.upArrow || input === "k") {
      const prev = Math.max(cursor - 1, 0);
      setCursor(prev);
      if (prev < scrollOffset) {
        setScrollOffset(prev);
      }
    } else if (key.return) {
      if (projects[cursor]) onSelectProject(projects[cursor]);
    } else if (input === "a") {
      onAudit();
    } else if (input === "d") {
      onDiff();
    } else if (input === "q" || (key.ctrl && input === "c")) {
      onQuit();
    }
  });

  const visibleProjects = projects.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <Box flexDirection="column">
      <Header
        title="Claude Permissions Manager"
        subtitle={`Found ${projects.length} project(s)  •  ${totalWarnings} warning(s)  •  root: ${collapseHome(scanResult.scanRoot)}`}
      />

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
            </Text>
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {projects.length > visibleRows && (
        <Text color="gray">
          {"  "}
          {scrollOffset > 0 ? "↑ " : "  "}
          {scrollOffset + visibleRows < projects.length
            ? `↓ ${projects.length - scrollOffset - visibleRows} more`
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
          ↑↓/jk navigate  Enter: details  a: audit  d: diff  q: quit
        </Text>
      </Box>
    </Box>
  );
}
