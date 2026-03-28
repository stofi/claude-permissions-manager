import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "../components/Header.js";
import { ModeBadge, SeverityBadge } from "../components/Badge.js";
import { TextInput } from "../components/TextInput.js";
import { ScopePicker } from "../components/ScopePicker.js";
import { addRule, removeRule, resolveSettingsPath } from "../../core/writer.js";
import type {
  ClaudeProject,
  PermissionRule,
  SettingsScope,
} from "../../core/types.js";
import { collapseHome } from "../../utils/paths.js";

type Tab = "permissions" | "mcp" | "warnings";
type DetailMode =
  | "view"
  | "typing"
  | "picking-scope"
  | "confirming-delete"
  | "status";
type RuleList = "allow" | "deny" | "ask";

interface ScopedRule extends PermissionRule {
  scope: SettingsScope;
  list: RuleList;
}

function ScopeTag({ scope }: { scope: SettingsScope }) {
  const colors: Record<SettingsScope, string> = {
    managed: "red",
    user: "blue",
    project: "green",
    local: "yellow",
  };
  return <Text color={colors[scope]}>[{scope}]</Text>;
}

function RuleListView({
  rules,
  color,
  label,
  cursor,
  cursorOffset,
  isActive,
}: {
  rules: Array<PermissionRule & { scope: SettingsScope }>;
  color: string;
  label: string;
  cursor: number;
  cursorOffset: number;
  isActive: boolean;
}) {
  if (rules.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={color}>
        {label} ({rules.length})
      </Text>
      {rules.map((r, i) => {
        const globalIdx = cursorOffset + i;
        const selected = isActive && cursor === globalIdx;
        return (
          <Box key={r.raw + r.scope}>
            <Text
              color={selected ? "black" : color}
              backgroundColor={selected ? color : undefined}
            >
              {selected ? "▶ " : "  "}
              {r.raw.padEnd(42)}
            </Text>
            <Text color={selected ? "black" : "gray"}
              backgroundColor={selected ? color : undefined}
            >
              {"  "}[{r.scope}]
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

interface ProjectDetailProps {
  project: ClaudeProject;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}

export function ProjectDetail({ project, onBack, onRefresh }: ProjectDetailProps) {
  const [tab, setTab] = useState<Tab>("permissions");
  const [mode, setMode] = useState<DetailMode>("view");
  const [cursor, setCursor] = useState(0);
  const [pendingList, setPendingList] = useState<RuleList>("allow");
  const [pendingRule, setPendingRule] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusColor, setStatusColor] = useState("green");

  const perms = project.effectivePermissions;

  // Build a flat list of all rules for cursor navigation (on permissions tab)
  const allRules: ScopedRule[] = [
    ...perms.allow.map((r) => ({ ...r, list: "allow" as RuleList })),
    ...perms.deny.map((r) => ({ ...r, list: "deny" as RuleList })),
    ...perms.ask.map((r) => ({ ...r, list: "ask" as RuleList })),
  ];

  const allowOffset = 0;
  const denyOffset = perms.allow.length;
  const askOffset = perms.allow.length + perms.deny.length;

  const selectedRule: ScopedRule | undefined = allRules[cursor];

  function showStatus(msg: string, color = "green") {
    setStatusMessage(msg);
    setStatusColor(color);
    setMode("status");
    setTimeout(() => setMode("view"), 2000);
  }

  async function handleScopeSelect(scope: SettingsScope) {
    setMode("view");
    try {
      const path = resolveSettingsPath(scope, project.rootPath);
      const result = await addRule(pendingRule, pendingList, path);
      if (result.alreadyPresent) {
        showStatus(`Rule already exists in ${scope}`, "yellow");
      } else {
        await onRefresh();
        if (result.conflictsWith) {
          const conflictNote = result.conflictsWith === "deny" ? "deny wins" : "check for conflicts";
          showStatus(`Added — but also in ${result.conflictsWith} (${conflictNote})`, "yellow");
        } else {
          showStatus(`Added "${pendingRule}" to ${pendingList} [${scope}]`);
        }
      }
    } catch (err) {
      showStatus(`Error: ${String(err)}`, "red");
    }
  }

  async function handleDeleteConfirm(yes: boolean) {
    setMode("view");
    if (!yes || !selectedRule) return;
    if (selectedRule.scope === "managed" || selectedRule.scope === "user") {
      showStatus(`Cannot edit ${selectedRule.scope} scope from here`, "red");
      return;
    }
    try {
      const path = resolveSettingsPath(selectedRule.scope, project.rootPath);
      const result = await removeRule(selectedRule.raw, path);
      if (result.removed) {
        // If deleted item was last in list, move cursor up; otherwise stay in place
        const newLength = allRules.length - 1;
        setCursor(Math.min(cursor, Math.max(0, newLength - 1)));
        await onRefresh();
        showStatus(`Removed "${selectedRule.raw}" from ${selectedRule.scope}`);
      } else {
        showStatus("Rule not found in file", "yellow");
      }
    } catch (err) {
      showStatus(`Error: ${String(err)}`, "red");
    }
  }

  useInput(
    (input, key) => {
      if (mode !== "view") return;

      if (key.escape || input === "q" || input === "h" || key.leftArrow) {
        onBack();
        return;
      }

      // Tab switching
      if (input === "1") { setTab("permissions"); return; }
      if (input === "2") { setTab("mcp"); return; }
      if (input === "3") { setTab("warnings"); return; }

      if (tab !== "permissions") return;

      // Cursor movement
      if (key.upArrow || input === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow || input === "j") {
        setCursor((c) => allRules.length > 0 ? Math.min(allRules.length - 1, c + 1) : 0);
      }

      // Add rules
      if (input === "a") {
        setPendingList("allow");
        setPendingRule("");
        setMode("typing");
      } else if (input === "d") {
        setPendingList("deny");
        setPendingRule("");
        setMode("typing");
      } else if (input === "s") {
        setPendingList("ask");
        setPendingRule("");
        setMode("typing");
      }

      // Delete rule
      if (input === "x" && selectedRule) {
        if (selectedRule.scope === "managed" || selectedRule.scope === "user") {
          showStatus(`Cannot delete ${selectedRule.scope} scope rules`, "red");
        } else {
          setMode("confirming-delete");
        }
      }
    },
    { isActive: mode === "view" }
  );

  const path = collapseHome(project.rootPath);

  return (
    <Box flexDirection="column">
      <Header
        title={`Project: ${path}`}
        subtitle={
          `${perms.allow.length} allow  •  ${perms.deny.length} deny  •  ` +
          `${perms.ask.length} ask  •  ${perms.mcpServers.length} MCP`
        }
      />

      {/* Mode line */}
      <Box marginBottom={1}>
        <Text>Mode: </Text>
        <ModeBadge mode={perms.defaultMode} />
        {perms.isBypassDisabled && (
          <Text color="green">{"  "}[bypass locked]</Text>
        )}
      </Box>

      {/* Tab bar */}
      <Box marginBottom={1}>
        {(["permissions", "mcp", "warnings"] as Tab[]).map((t, i) => (
          <React.Fragment key={t}>
            <Text
              bold={tab === t}
              color={tab === t ? "cyan" : "gray"}
              underline={tab === t}
            >
              {i + 1}:{t}
            </Text>
            <Text color="gray">{"  "}</Text>
          </React.Fragment>
        ))}
      </Box>

      {/* Settings files (always shown) */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="gray">
          Settings Files:
        </Text>
        {project.settingsFiles.map((f) => {
          const status = !f.exists
            ? { sym: "✗", color: "gray" }
            : !f.readable
            ? { sym: "✗", color: "red" }
            : !f.parsed
            ? { sym: "⚠", color: "yellow" }
            : f.parseError
            ? { sym: "⚠", color: "yellow" }
            : { sym: "✓", color: "green" };
          const errorLabel = f.parseError
            ? (f.parsed ? "⚠ schema warning" : "⚠ parse error")
            : null;
          return (
            <Box key={f.path}>
              <Text color={status.color}>{"  " + status.sym + " "}</Text>
              <Text color="gray">{collapseHome(f.path).padEnd(52)}</Text>
              <ScopeTag scope={f.scope} />
              {errorLabel && (
                <Text color="yellow">{"  "}{errorLabel}</Text>
              )}
            </Box>
          );
        })}
        {project.claudeMdFiles.map((f) => (
          <Box key={f.path}>
            <Text color="green">{"  ✓ "}</Text>
            <Text color="gray">
              {collapseHome(f.path).padEnd(52)}
            </Text>
            <Text color="gray">CLAUDE.md ({f.lineCount} lines)</Text>
          </Box>
        ))}
      </Box>

      {/* Tab content */}
      {tab === "permissions" && (
        <Box flexDirection="column">
          {allRules.length === 0 && (
            <Text color="gray" dimColor>
              No permission rules configured (using defaults)
            </Text>
          )}
          <RuleListView
            rules={perms.allow}
            color="green"
            label="ALLOW"
            cursor={cursor}
            cursorOffset={allowOffset}
            isActive={mode === "view"}
          />
          <RuleListView
            rules={perms.deny}
            color="red"
            label="DENY"
            cursor={cursor}
            cursorOffset={denyOffset}
            isActive={mode === "view"}
          />
          <RuleListView
            rules={perms.ask}
            color="yellow"
            label="ASK"
            cursor={cursor}
            cursorOffset={askOffset}
            isActive={mode === "view"}
          />
          {perms.envVarNames.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="blue">
                ENV VARS ({perms.envVarNames.length} set)
              </Text>
              <Text color="gray">
                {"  "}
                {perms.envVarNames.join(", ")}
              </Text>
            </Box>
          )}
          {perms.additionalDirs.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="blue">
                ADDITIONAL DIRS
              </Text>
              {perms.additionalDirs.map((d) => (
                <Text key={d} color="gray">
                  {"  "}
                  {d}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {tab === "mcp" && (
        <Box flexDirection="column">
          {perms.mcpServers.length === 0 ? (
            <Text color="gray" dimColor>
              No MCP servers configured
            </Text>
          ) : (
            perms.mcpServers.map((s) => {
              const approvalColor =
                s.approvalState === "approved"
                  ? "green"
                  : s.approvalState === "denied"
                  ? "red"
                  : "yellow";
              return (
                <Box key={s.name + s.scope} flexDirection="column" marginBottom={1}>
                  <Box>
                    <Text bold>{s.name.padEnd(24)}</Text>
                    <ScopeTag scope={s.scope} />
                    <Text color="gray">{"  "}</Text>
                    <Text color="gray">{(s.type ?? "stdio").padEnd(8)}</Text>
                    <Text color={approvalColor}>
                      {s.approvalState ?? "pending"}
                    </Text>
                  </Box>
                  {s.command && (
                    <Text color="gray">{"    "}cmd: {s.command}</Text>
                  )}
                  {s.url && (
                    <Text color="gray">{"    "}url: {s.url}</Text>
                  )}
                  {s.envVarNames && s.envVarNames.length > 0 && (
                    <Text color="gray">
                      {"    "}env: {s.envVarNames.join(", ")}
                    </Text>
                  )}
                  {s.headerNames && s.headerNames.length > 0 && (
                    <Text color="gray">
                      {"    "}headers: {s.headerNames.join(", ")}
                    </Text>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      )}

      {tab === "warnings" && (
        <Box flexDirection="column">
          {perms.warnings.length === 0 ? (
            <Text color="green">✓ No warnings</Text>
          ) : (
            perms.warnings.map((w, i) => (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Box>
                  <SeverityBadge severity={w.severity} />
                  <Text>{"  "}{w.message}</Text>
                </Box>
                {w.rule && (
                  <Text color="gray">{"    "}Rule: {w.rule}</Text>
                )}
              </Box>
            ))
          )}
        </Box>
      )}

      {/* Overlays */}
      {mode === "typing" && (
        <TextInput
          prompt={`Add to ${pendingList.toUpperCase()}: `}
          placeholder="e.g. Bash(npm run *)"
          onSubmit={(val) => {
            setPendingRule(val);
            setMode("picking-scope");
          }}
          onCancel={() => setMode("view")}
        />
      )}

      {mode === "picking-scope" && (
        <ScopePicker
          label={`Choose scope for "${pendingRule}" → ${pendingList}:`}
          onSelect={handleScopeSelect}
          onCancel={() => setMode("view")}
        />
      )}

      {mode === "confirming-delete" && selectedRule && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">
            Delete "{selectedRule.raw}" from {selectedRule.scope}:{selectedRule.list}?
          </Text>
          <Text color="gray">y: confirm  n: cancel</Text>
          {/* Inline input for y/n */}
          <ConfirmInput onConfirm={handleDeleteConfirm} />
        </Box>
      )}

      {mode === "status" && (
        <Box marginTop={1}>
          <Text color={statusColor}>{statusMessage}</Text>
        </Box>
      )}

      {/* Key hints */}
      <Box marginTop={1}>
        {tab === "permissions" && mode === "view" ? (
          <Text color="gray">
            1:permissions  2:mcp  3:warnings  j/k:move  a:allow  d:deny  s:ask  x:delete  ←/q:back
          </Text>
        ) : (
          <Text color="gray">
            1:permissions  2:mcp  3:warnings  ←/Esc/q: back
          </Text>
        )}
      </Box>
    </Box>
  );
}

// Minimal inline confirm (y/n) — only rendered while mode === "confirming-delete"
function ConfirmInput({ onConfirm }: { onConfirm: (yes: boolean) => void }) {
  useInput(
    (input) => {
      if (input === "y" || input === "Y") onConfirm(true);
      else if (input === "n" || input === "N" || input === "q") onConfirm(false);
    },
    { isActive: true }
  );
  return null;
}
