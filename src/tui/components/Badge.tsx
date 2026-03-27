import React from "react";
import { Text } from "ink";
import type { PermissionMode, WarningSeverity } from "../../core/types.js";

const MODE_COLORS: Record<PermissionMode, string> = {
  default: "gray",
  acceptEdits: "blue",
  plan: "cyan",
  auto: "yellow",
  dontAsk: "magenta",
  bypassPermissions: "red",
};

export function ModeBadge({ mode }: { mode: PermissionMode }) {
  const color = MODE_COLORS[mode] ?? "white";
  const isBold = mode === "bypassPermissions";
  return (
    <Text color={color} bold={isBold}>
      [{mode}]
    </Text>
  );
}

const SEVERITY_COLORS: Record<WarningSeverity, string> = {
  critical: "red",
  high: "red",
  medium: "yellow",
  low: "gray",
};

export function SeverityBadge({ severity }: { severity: WarningSeverity }) {
  return (
    <Text color={SEVERITY_COLORS[severity]} bold={severity === "critical"}>
      [{severity.toUpperCase()}]
    </Text>
  );
}
