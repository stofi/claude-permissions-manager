import { describe, it, expect } from "vitest";
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
