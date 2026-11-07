// A blobless partial clone must give the same answer as a full clone, and a blob it cannot fetch
// must surface as an error: never as "this file does not exist", and never as a clean merge.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/check.ts";
import { defaultConfig } from "../src/config.ts";
import { Git } from "../src/git.ts";
import { makeRepo, type Repo } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** main changes line two; the merge into the branch keeps the branch's line, dropping main's change. */
function droppedMerge(): { repo: Repo; base: string; head: string } {
  const repo = makeRepo();
  repo.git("init", "-q", "-b", "main");
  repo.git("config", "uploadpack.allowFilter", "true");
  repo.write("app.txt", "one\ntwo\nthree\n");
  repo.write("other.txt", "untouched\n");
  repo.commit("first");
  const base = repo.head();
  repo.git("checkout", "-q", "-b", "feature");
  repo.write("branch.txt", "feature\n");
  repo.commit("feature work");
  repo.git("checkout", "-q", "main");
  repo.write("app.txt", "one\ntwo CHANGED ON MAIN\nthree\n");
  repo.commit("main change");
  repo.git("checkout", "-q", "feature");
  repo.git("merge", "-q", "--no-commit", "--no-ff", "main");
  repo.git("checkout", "HEAD", "--", "app.txt");
  repo.commit("merge main into feature");
  return { repo, base, head: repo.head() };
}

function partialClone(repo: Repo): string {
  const dir = mkdtempSync(join(tmpdir(), "mainfast-partial-"));
  dirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `file://${repo.dir}`);
  git(dir, "config", "remote.origin.promisor", "true");
  git(dir, "config", "remote.origin.partialclonefilter", "blob:none");
  git(dir, "fetch", "-q", "--filter=blob:none", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/feature:refs/mainfast/head");
  return dir;
}

const shape = (r: ReturnType<typeof runCheck>) => r.merges.map((m) => ({ status: m.status, findings: m.findings.map((f) => [f.kind, f.level, f.side, f.path]) }));

describe("partial clone", () => {
  it("finds what a full clone finds, fetching blobs on demand", () => {
    const { repo, base, head } = droppedMerge();
    const range = `${base}..${head}`;
    const full = runCheck({ cwd: repo.dir, range, mainBranch: "main", config: defaultConfig() });
    expect(full.summary.withFindings).toBe(1);
    const dir = partialClone(repo);
    const partial = runCheck({ cwd: dir, range, mainBranch: "origin/main", config: defaultConfig() });
    expect(shape(partial)).toEqual(shape(full));
  });

  it("reports an error, not a clean merge, when the blobs cannot be fetched", () => {
    const { repo, base, head } = droppedMerge();
    const dir = partialClone(repo);
    git(dir, "remote", "set-url", "origin", `file://${repo.dir}/gone`);
    const r = runCheck({ cwd: dir, range: `${base}..${head}`, mainBranch: "origin/main", config: defaultConfig() });
    expect(r.summary.errors).toBe(1);
    expect(r.summary.clean).toBe(0);
    expect(r.merges[0]!.status).toBe("error");
  });

  it("show: a blob it cannot fetch throws, a path that is not there is undefined", () => {
    const { repo, head } = droppedMerge();
    const dir = partialClone(repo);
    git(dir, "remote", "set-url", "origin", `file://${repo.dir}/gone`);
    const g = new Git(dir);
    expect(g.show(head, "no-such-file.txt")).toBeUndefined();
    expect(() => g.show(head, "other.txt")).toThrow();
  });

  it("show: reads a blob in a full clone, and a directory is not a file", () => {
    const repo = makeRepo();
    repo.git("init", "-q", "-b", "main");
    repo.write("dir/a b.txt", "hello\n");
    repo.commit("first");
    const g = new Git(repo.dir);
    expect(g.show("HEAD", "dir/a b.txt")).toBe("hello\n");
    expect(g.show("HEAD", "dir")).toBeUndefined();
    expect(g.show("no-such-rev", "dir/a b.txt")).toBeUndefined();
  });
});
