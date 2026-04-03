import type { PermissionMode, SettingsData } from "./schemas.js";

export type { PermissionMode };

export type SettingsScope = "managed" | "user" | "project" | "local";

/** Scopes that can be written to (excludes "managed" which is system-controlled) */
export const WRITABLE_SCOPES: SettingsScope[] = ["local", "project", "user"];

export interface PermissionRule {
  tool: string;
  specifier?: string;
  raw: string;
}

export interface SettingsFile {
  path: string;
  scope: SettingsScope;
  exists: boolean;
  readable: boolean;
  parsed: boolean;
  parseError?: string;
  data?: SettingsData;
}

export interface McpServer {
  name: string;
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  envVarNames?: string[];   // Names only, not values
  headerNames?: string[];
  scope: SettingsScope;
  approvalState?: "approved" | "denied" | "pending";
}

export interface McpFile {
  path: string;
  exists: boolean;
  parsed: boolean;
  parseError?: string;
  servers: McpServer[];
}

export interface ClaudeMdFile {
  path: string;
  exists: boolean;
  lineCount?: number;
  scope: SettingsScope;
}

export type WarningSeverity = "critical" | "high" | "medium" | "low";
export const SEVERITY_ORDER: WarningSeverity[] = ["critical", "high", "medium", "low"];

/** Structured, executable fix operation — used by `cpm audit --fix` */
export type FixOp =
  | { kind: "mode"; mode: "default"; scope: SettingsScope }
  | { kind: "reset"; rule: string; scope: SettingsScope }
  | { kind: "bypass-lock"; enabled: true; scope: SettingsScope };

export interface Warning {
  severity: WarningSeverity;
  message: string;
  rule?: string;
  /** Suggested fix command (without --project <path>); append --project to get a runnable fix. */
  fixCmd?: string;
  /** Structured version of fixCmd for programmatic execution by `cpm audit --fix`. */
  fixOp?: FixOp;
}

export interface EffectivePermissions {
  defaultMode: PermissionMode;
  allow: Array<PermissionRule & { scope: SettingsScope }>;
  deny: Array<PermissionRule & { scope: SettingsScope }>;
  ask: Array<PermissionRule & { scope: SettingsScope }>;
  isBypassDisabled: boolean;
  mcpServers: McpServer[];
  envVarNames: string[];
  additionalDirs: string[];
  warnings: Warning[];
}

export interface ClaudeProject {
  rootPath: string;
  claudeDir: string;
  settingsFiles: SettingsFile[];
  mcpFile?: McpFile;
  claudeMdFiles: ClaudeMdFile[];
  effectivePermissions: EffectivePermissions;
}

export interface GlobalSettings {
  managed?: SettingsFile;
  user?: SettingsFile;
  userMcpServers: McpServer[];
}

export interface ScanResult {
  global: GlobalSettings;
  projects: ClaudeProject[];
  scanRoot: string;
  scannedAt: Date;
  errors: Array<{ path: string; error: string }>;
}
