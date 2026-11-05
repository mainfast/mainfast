import { describe, expect, it } from "vitest";
import { judgeHunk, markerRegions } from "../src/analyze.ts";
import { ConfigError, globToRegExp, isIgnored, levelFor, parseConfig } from "../src/config.ts";
import { fullSide, parseDiff } from "../src/diff.ts";
import { parseGitVersion } from "../src/git.ts";
import { parseArgs } from "../src/cli.ts";

describe("parseDiff", () => {
  it("parses blocks, renames, new and deleted files", () => {
    const text = [
      "diff --git a/x.txt b/x.txt",
      "index 1..2 100644",
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -2 +2,2 @@ ctx",
      "-old",
      "+new",
      "+more",
      "@@ -5,0 +7 @@",
      "+inserted",
      "diff --git a/old name.txt b/new name.txt",
      "similarity index 100%",
      "rename from old name.txt",
      "rename to new name.txt",
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const files = parseDiff(text);
    expect(files.map((f) => [f.status, f.oldPath, f.newPath, f.binary])).toEqual([
      ["M", "x.txt", "x.txt", false],
      ["R", "old name.txt", "new name.txt", false],
      ["D", "gone.txt", null, false],
      ["M", "img.png", "img.png", true],
    ]);
    expect(files[0]!.blocks).toEqual([
      { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 3, removed: ["old"], added: ["new", "more"] },
      { oldFrom: 5, oldTo: 5, newFrom: 6, newTo: 7, removed: [], added: ["inserted"] },
    ]);
  });

  it("reconstructs the old side from a full-context diff, including remerge headers", () => {
    const text = [
      "diff --git a/f b/f",
      "remerge CONFLICT (content): Merge conflict in f",
      "--- a/f",
      "+++ b/f",
      "@@ -1,5 +1,1 @@",
      "-<<<<<<< ours",
      " keep",
      "-=======",
      "-theirs",
      "->>>>>>> theirs",
    ].join("\n");
    const [f] = parseDiff(text);
    expect(f!.conflictMessages).toEqual(["CONFLICT (content): Merge conflict in f"]);
    const old = fullSide(f!.oldSparse)!;
    expect(old).toHaveLength(5);
    expect(markerRegions(old)).toEqual([{ from: 0, to: 5 }]);
  });
});

describe("judgeHunk", () => {
  const h = { oldFrom: 4, oldTo: 5, newFrom: 4, newTo: 5, removed: ["timeout = 10"], added: ["timeout = 30"] };
  const ps = ["a", "b", "c", "d", "timeout = 30", "f"];
  it("keeps a hunk the merge did not touch", () => {
    expect(judgeHunk(h, [], ps, ps)).toBeUndefined();
  });
  it("accepts a reshaped line that still carries the delta", () => {
    const m = [...ps];
    m[4] = "timeout = 30  # per tenant";
    const b = { oldFrom: 4, oldTo: 5, newFrom: 4, newTo: 5, removed: ["timeout = 30"], added: [m[4]] };
    expect(judgeHunk(h, [b], ps, m)).toBeUndefined();
  });
  it("flags a one-character fix that was reverted", () => {
    const m = [...ps];
    m[4] = "timeout = 10";
    const b = { oldFrom: 4, oldTo: 5, newFrom: 4, newTo: 5, removed: ["timeout = 30"], added: ["timeout = 10"] };
    expect(judgeHunk(h, [b], ps, m)?.kind).toBe("dropped");
  });
});

describe("config", () => {
  it("parses version 1", () => {
    const cfg = parseConfig("version: 1\nintact:\n  main_branch: trunk\n  ignore: [dist/, '*.lock']\n  severity:\n    docs/**: notice\n    '**': error\n");
    expect(cfg.mainBranch).toBe("trunk");
    expect(isIgnored(cfg, "dist/app.js")).toBe(true);
    expect(isIgnored(cfg, "deep/yarn.lock")).toBe(true);
    expect(isIgnored(cfg, "src/app.ts")).toBe(false);
    expect(levelFor(cfg, "docs/a/b.md", "warning")).toBe("notice");
    expect(levelFor(cfg, "src/x.ts", "warning")).toBe("error");
  });
  it("checks lockfiles by default", () => {
    for (const cfg of [parseConfig(""), parseConfig("intact:\n  use_default_ignores: false\n")]) {
      expect(isIgnored(cfg, "web/package-lock.json")).toBe(false);
      expect(isIgnored(cfg, "go.sum")).toBe(false);
    }
  });
  it("adds default lockfile ignores on request", () => {
    const cfg = parseConfig("version: 1\nintact:\n  use_default_ignores: true\n");
    expect(isIgnored(cfg, "web/package-lock.json")).toBe(true);
    expect(isIgnored(cfg, "go.sum")).toBe(true);
  });
  it("rejects bad input", () => {
    expect(() => parseConfig("version: 2")).toThrow(ConfigError);
    expect(() => parseConfig("ignores: []")).toThrow(/unknown top-level key "ignores"/);
    expect(() => parseConfig("ignore: []")).toThrow(/unknown top-level key "ignore"/); // the pre-suite layout
    expect(() => parseConfig("intact:\n  ignores: []")).toThrow(/unknown key "ignores"/);
    expect(() => parseConfig("intact:\n  severity:\n    a: loud")).toThrow(/must be one of/);
    expect(() => parseConfig("intact:\n  ignore: [1]")).toThrow(/list of path globs/);
    expect(() => parseConfig("intact: [1]")).toThrow(/expected a mapping/);
  });
  it("matches globs like gitignore", () => {
    expect(globToRegExp("*.md").test("a/b/c.md")).toBe(true);
    expect(globToRegExp("/top.txt").test("sub/top.txt")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("src/**/*.ts").test("src/a/b.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/b.ts")).toBe(true);
    expect(globToRegExp("*.{yml,yaml}").test("ci.yaml")).toBe(true);
  });
});

describe("shared .mainfast.yml", () => {
  it("ignores the other products' sections without a warning", () => {
    const cfg = parseConfig("version: 1\nmigrations:\n  frameworks: auto\nrollcall:\n  pulls: 20\nowners:\n  dormantDays: 90\nevidence:\n  apply_to: agents\nintact:\n  main_branch: trunk\n");
    expect(cfg.mainBranch).toBe("trunk");
  });
  it("needs resolveIntactConfig for extends", () => {
    expect(() => parseConfig("extends: acme/.github\n")).toThrow(/resolveIntactConfig/);
  });
});

describe("misc", () => {
  it("parses git versions", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual([2, 50, 1]);
    expect(parseGitVersion("git version 2.35.0.windows.1")).toEqual([2, 35, 0]);
  });
  it("parses cli arguments", () => {
    expect(parseArgs(["check", "main..feat", "--json"])).toMatchObject({ command: "check", range: "main..feat", json: true });
    expect(parseArgs(["check", "abc123", "--fail-on=error"])).toMatchObject({ commit: "abc123", failOn: "error" });
    expect(() => parseArgs(["check", "x", "--range", "a..b"])).toThrow(/not both/);
  });
});
