/**
 * Tests for promptConfirm (audit.ts lines 32-40).
 * Uses vi.mock("readline") — hoisted before imports — so audit.ts picks up the mock
 * when its createInterface call runs through the real promptConfirm code path.
 * These tests intentionally do NOT pass _confirmFn so the real promptConfirm is exercised.
 */
import { vi, describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ── Mock readline before any module imports ───────────────────────────────────
// vi.mock is hoisted, so audit.ts will see this mock when it calls createInterface.

let mockAnswer = "y";

vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_q: string, cb: (a: string) => void) => { cb(mockAnswer); }),
    close: vi.fn(),
  })),
}));

// ── Import the module under test AFTER the mock is set up ─────────────────────
import { auditCommand } from "../src/commands/audit.js";

describe("promptConfirm — readline mock", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  async function makeFixableProject() {
    root = mkdtempSync(join(tmpdir(), "cpm-confirm-"));
    const claudeDir = join(root, "proj", ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash"] },
    }));
    return root;
  }

  it("promptConfirm returns true and applies fix when user answers 'y'", async () => {
    mockAnswer = "y";
    await makeFixableProject();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    // fix:true, yes:false, no _confirmFn → real promptConfirm called
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Applied \d+ fix/i);
  });

  it("promptConfirm returns true when user presses Enter (empty answer)", async () => {
    mockAnswer = "";
    await makeFixableProject();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Applied \d+ fix/i);
  });

  it("promptConfirm returns true when user answers 'yes'", async () => {
    mockAnswer = "yes";
    await makeFixableProject();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Applied \d+ fix/i);
  });

  it("promptConfirm returns false and aborts when user answers 'n'", async () => {
    mockAnswer = "n";
    await makeFixableProject();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Aborted/i);
  });

  it("promptConfirm returns false when user answers 'N'", async () => {
    mockAnswer = "N";
    await makeFixableProject();
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { calls.push(args.join("")); });
    await auditCommand({ root, maxDepth: 2, includeGlobal: false, fix: true, yes: false });
    const output = calls.join("\n");
    expect(output).toMatch(/Aborted/i);
  });
});
