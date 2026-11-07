import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { loadCoverage } from "../src/local.ts";

const LCOV = "SF:src/a.ts\nDA:1,1\nend_of_record\n";
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "evidence-coverage-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const repo = tmp();
  const outside = tmp();
  writeFileSync(join(outside, "lcov.info"), LCOV);
  mkdirSync(join(repo, "coverage"));
  writeFileSync(join(repo, "coverage/lcov.info"), LCOV);
  symlinkSync(join(outside, "lcov.info"), join(repo, "link.info"));
  symlinkSync(outside, join(repo, "linkdir"));
  return { repo, outside };
}

describe("loadCoverage", () => {
  it("reads a policy path inside the repository, as before", () => {
    const { repo } = setup();
    const r = loadCoverage(["coverage/lcov.info", "coverage/none.info"], repo);
    expect(r.report).toBeDefined();
    expect(r.missing).toEqual(["coverage/none.info"]);
    expect(r.refused).toEqual([]);
  });

  it("does not read a policy path that leaves the repository", () => {
    const { repo, outside } = setup();
    const paths = ["link.info", "linkdir/lcov.info", "../" + outside.split("/").pop() + "/lcov.info", join(outside, "lcov.info")];
    const r = loadCoverage(paths, repo);
    expect(r.report).toBeUndefined();
    expect(r.refused.map((x) => x.path)).toEqual(paths);
  });

  it("reads explicit paths as given", () => {
    const { repo, outside } = setup();
    expect(loadCoverage([], repo, [join(outside, "lcov.info")]).report).toBeDefined();
  });

  it("does not apply the small cap to a large coverage report", () => {
    const repo = tmp();
    writeFileSync(join(repo, "big.info"), LCOV.repeat(200_000));
    const r = loadCoverage(["big.info"], repo);
    expect(r.refused).toEqual([]);
    expect(r.report).toBeDefined();
  });
});

describe("evidence local", () => {
  it("warns and carries on when the base commit's policy points through a symlink", async () => {
    const { repo, outside } = setup();
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, ".gitignore"), "link.info\nlinkdir\ncoverage\n");
    writeFileSync(join(repo, ".mainfast.yml"), "version: 1\nevidence:\n  coverage:\n    files: [link.info]\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feature");
    let out = "";
    let err = "";
    const code = await main(["local", "--base", "main", "--repo", repo, "--json"], { out: (s: string) => void (out += s), err: (s: string) => void (err += s) } as never);
    expect(code).not.toBe(2);
    expect(err).toMatch(/coverage file not read: refusing to follow a symlink: link\.info/);
    expect(out + err).not.toContain(outside);
  });
});
