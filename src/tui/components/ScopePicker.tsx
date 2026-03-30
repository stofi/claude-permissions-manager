import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { WRITABLE_SCOPES } from "../../core/types.js";
import type { SettingsScope } from "../../core/types.js";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  local: "settings.local.json (you, this project)",
  project: "settings.json (team-shared, commit to git)",
  user: "~/.claude/settings.json (you, all projects)",
};

interface ScopePickerProps {
  label: string;
  onSelect: (scope: SettingsScope) => void;
  onCancel: () => void;
  defaultScope?: SettingsScope;
}

export function ScopePicker({
  label,
  onSelect,
  onCancel,
  defaultScope = "local",
}: ScopePickerProps) {
  const [cursor, setCursor] = useState(
    WRITABLE_SCOPES.indexOf(defaultScope) >= 0
      ? WRITABLE_SCOPES.indexOf(defaultScope)
      : 0
  );

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onCancel();
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(WRITABLE_SCOPES.length - 1, c + 1));
    } else if (key.return) {
      onSelect(WRITABLE_SCOPES[cursor]);
    } else if (input === "l" || input === "p" || input === "u") {
      const map: Record<string, SettingsScope> = { l: "local", p: "project", u: "user" };
      onSelect(map[input]);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan">{label}</Text>
      {WRITABLE_SCOPES.map((scope, i) => (
        <Box key={scope}>
          <Text
            color={i === cursor ? "black" : undefined}
            backgroundColor={i === cursor ? "cyan" : undefined}
          >
            {i === cursor ? "▶ " : "  "}
            {scope.padEnd(10)}
          </Text>
          <Text color="gray">  {SCOPE_DESCRIPTIONS[scope]}</Text>
        </Box>
      ))}
      <Text color="gray" dimColor>
        ↑↓/jk select  Enter: confirm  l/p/u: shortcut  Esc: cancel
      </Text>
    </Box>
  );
}
