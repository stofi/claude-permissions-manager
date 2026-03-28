import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Header } from "../components/Header.js";
import { SeverityBadge } from "../components/Badge.js";
import type { ScanResult, Warning, WarningSeverity, ClaudeProject } from "../../core/types.js";
import { collapseHome } from "../../utils/paths.js";

const SEVERITY_ORDER: WarningSeverity[] = ["critical", "high", "medium", "low"];

interface AuditItem {
  project: ClaudeProject;
  warning: Warning;
}

interface AuditProps {
  scanResult: ScanResult;
  onBack: () => void;
  onSelectProject: (project: ClaudeProject) => void;
}

export function Audit({ scanResult, onBack, onSelectProject }: AuditProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const visibleRows = Math.max(5, termHeight - 12);

  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Collect all warnings grouped by severity
  const byseverity: Record<WarningSeverity, AuditItem[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  for (const project of scanResult.projects) {
    for (const w of project.effectivePermissions.warnings) {
      byseverity[w.severity].push({ project, warning: w });
    }
  }

  // Flatten in severity order
  const items: AuditItem[] = SEVERITY_ORDER.flatMap((s) => byseverity[s]);

  useInput((input, key) => {
    if (key.escape || input === "q" || key.leftArrow) {
      onBack();
    } else if (key.return) {
      if (items[cursor]) onSelectProject(items[cursor].project);
    } else if (key.downArrow || input === "j") {
      const next = Math.min(cursor + 1, items.length - 1);
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
    }
  });

  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleRows);

  const totalWarnings = items.length;

  return (
    <Box flexDirection="column">
      <Header
        title="Security Audit"
        subtitle={`${totalWarnings} issue(s) across ${scanResult.projects.length} project(s)`}
      />

      {totalWarnings === 0 ? (
        <Text color="green">✓ No issues found across all projects.</Text>
      ) : (
        <Box flexDirection="column">
          {visibleItems.map((item, i) => {
            const idx = scrollOffset + i;
            const isSelected = idx === cursor;
            return (
              <Box
                key={idx}
                flexDirection="column"
                marginBottom={1}
                paddingLeft={isSelected ? 0 : 2}
              >
                <Box>
                  {isSelected && <Text color="cyan">▶ </Text>}
                  <SeverityBadge severity={item.warning.severity} />
                  <Text color="gray">{"  "}{collapseHome(item.project.rootPath)}</Text>
                </Box>
                <Box paddingLeft={isSelected ? 4 : 2}>
                  <Text>{item.warning.message}</Text>
                </Box>
                {item.warning.rule && (
                  <Box paddingLeft={isSelected ? 4 : 2}>
                    <Text color="gray">Rule: {item.warning.rule}</Text>
                  </Box>
                )}
              </Box>
            );
          })}

          {items.length > visibleRows && (
            <Text color="gray">
              {"  "}
              {scrollOffset > 0 ? "↑ " : "  "}
              {scrollOffset + visibleRows < items.length
                ? `↓ ${items.length - scrollOffset - visibleRows} more`
                : ""}
            </Text>
          )}
        </Box>
      )}

      {scanResult.errors.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>{scanResult.errors.length} project(s) could not be scanned:</Text>
          {scanResult.errors.map((e) => (
            <Text key={e.path} color="red">  {collapseHome(e.path)}: {e.error}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">↑↓/jk scroll  Enter: view project  ←/Esc/q: back</Text>
      </Box>
    </Box>
  );
}
