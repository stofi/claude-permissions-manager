import { describe, it, expect, vi, afterEach } from "vitest";
import { expandHome, collapseHome } from "../src/utils/paths.js";
import { homedir } from "os";

const HOME = homedir();

describe("collapseHome", () => {
  it("collapses home directory prefix to ~", () => {
    expect(collapseHome(HOME + "/foo/bar")).toBe("~/foo/bar");
  });

  it("returns ~ for exact home directory", () => {
    expect(collapseHome(HOME)).toBe("~");
  });

  it("does NOT collapse a path that only starts with home as a prefix of the dirname", () => {
    // e.g. /home/bob should NOT match /home/bobby/foo
    const fakePath = HOME + "extra/foo";
    expect(collapseHome(fakePath)).toBe(fakePath);
  });

  it("leaves unrelated paths unchanged", () => {
    expect(collapseHome("/tmp/foo")).toBe("/tmp/foo");
    expect(collapseHome("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("expandHome", () => {
  it("expands ~/ prefix to home directory", () => {
    expect(expandHome("~/foo/bar")).toBe(HOME + "/foo/bar");
  });

  it("leaves non-home paths unchanged", () => {
    expect(expandHome("/tmp/foo")).toBe("/tmp/foo");
    expect(expandHome("relative/path")).toBe("relative/path");
  });

  it("does not expand bare ~ without slash", () => {
    // expandHome only handles ~/ prefix
    expect(expandHome("~")).toBe("~");
  });
});

// ────────────────────────────────────────────────────────────
// managedSettingsPath — OS-specific branches
// ────────────────────────────────────────────────────────────

describe("managedSettingsPath", () => {
  afterEach(() => {
    vi.doUnmock("os");
    vi.resetModules();
  });

  it("returns linux path on non-darwin non-win32 platform (paths.ts:43)", async () => {
    // paths.ts:43: else → "/etc/claude-code/managed-settings.json"
    // The current test machine is Linux so this branch is exercised by all other tests,
    // but we make it explicit here.
    vi.doMock("os", () => ({ homedir: () => "/home/user", platform: () => "linux" }));
    vi.resetModules();
    const { managedSettingsPath } = await import("../src/utils/paths.js");
    expect(managedSettingsPath()).toBe("/etc/claude-code/managed-settings.json");
  });

  it("returns macOS path when platform is darwin (paths.ts:37)", async () => {
    // paths.ts:36-38: os === "darwin" → "/Library/Application Support/ClaudeCode/..."
    vi.doMock("os", () => ({ homedir: () => "/Users/test", platform: () => "darwin" }));
    vi.resetModules();
    const { managedSettingsPath } = await import("../src/utils/paths.js");
    expect(managedSettingsPath()).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
  });

  it("returns windows path when platform is win32 (paths.ts:40)", async () => {
    // paths.ts:39-41: os === "win32" → "C:\\Program Files\\ClaudeCode\\..."
    vi.doMock("os", () => ({ homedir: () => "C:\\Users\\test", platform: () => "win32" }));
    vi.resetModules();
    const { managedSettingsPath } = await import("../src/utils/paths.js");
    expect(managedSettingsPath()).toBe("C:\\Program Files\\ClaudeCode\\managed-settings.json");
  });
});
