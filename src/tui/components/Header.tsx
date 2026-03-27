import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  title: string;
  subtitle?: string;
  version?: string;
}

export function Header({ title, subtitle, version = "0.1.0" }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          {title}
        </Text>
        {version && (
          <Text color="gray">
            {"  "}v{version}
          </Text>
        )}
      </Box>
      {subtitle && <Text color="gray">{subtitle}</Text>}
      <Text color="gray">{"─".repeat(60)}</Text>
    </Box>
  );
}
