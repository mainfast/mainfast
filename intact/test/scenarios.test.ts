import { afterAll, describe, expect, it } from "vitest";
import { analyzeMerge } from "../src/analyze.ts";
import { envName } from "../src/brand.ts";
import type { Strategy } from "../src/automerge.ts";
import { runCheck } from "../src/check.ts";
import { defaultConfig, parseConfig } from "../src/config.ts";
import { Git } from "../src/git.ts";
import type { CheckReport, MergeReport } from "../src/types.ts";
import { cleanupAll, cli, lines, makeRepo, mergeInto, tenLines, type Repo } from "./helpers.ts";

afterAll(cleanupAll);

const STRATEGIES: Strategy[] = ["remerge-diff", "merge-tree", "worktree"];

function check(repo: Repo, rev = "HEAD", strategy?: Strategy, config = defaultConfig()): MergeReport {
  const git = new Git(repo.dir);
  return analyzeMerge(git, rev, { config, mainSha: git.resolve("main"), strategy });
}

/** base on main, then a feature branch `feat` checked out. */
function baseRepo(files: Record<string, string>): Repo {
  const repo = makeRepo();
  for (const [p, c] of Object.entries(files)) repo.write(p, c);
  repo.commit("base");
  repo.git("checkout", "-q", "-b", "feat");
  return repo;
}

function onMain(repo: Repo, fn: () => void): void {
  repo.git("checkout", "-q", "main");
  fn();
  repo.git("checkout", "-q", "feat");
}

describe("clean merge", () => {
  it("is identical to the automatic merge and exits 0", async () => {
    const repo = baseRepo({ "config.txt": tenLines(), "other.txt": "a\n" });
    repo.write("other.txt", "a\nfeature\n");
    repo.commit("feature work");
    onMain(repo, () => {
      repo.write("config.txt", tenLines({ 2: "line 2 fixed on main" }));
      repo.commit("fix line 2");
    });
    mergeInto(repo, "main");
    for (const s of STRATEGIES) {
      const r = check(repo, "HEAD", s);
      expect(r.status, s).toBe("clean");
      expect(r.findings).toEqual([]);
    }
    const res = await cli(repo.dir, "check");
    expect(res.code).toBe(0);
    expect(res.out).toContain("1 merge commit in main..HEAD");
    expect(res.out).toContain("clean");
  });
});

/** Shared setup: main raises the timeout, the branch annotates the same line. */
function timeoutConflict(): { repo: Repo; fix: string } {
  const repo = baseRepo({ "config.txt": tenLines({ 5: "timeout = 10" }), "other.txt": "a\n" });
  repo.write("config.txt", tenLines({ 5: "timeout = 10 # per tenant" }));
  repo.commit("annotate timeout");
  let fix = "";
  onMain(repo, () => {
    repo.write("config.txt", tenLines({ 5: "timeout = 30" }));
    fix = repo.commit("Raise timeout to 30", "Ana Main");
  });
  return { repo, fix };
}

describe("conflict resolved correctly", () => {
  it("combines both sides and reports no findings", async () => {
    const { repo } = timeoutConflict();
    mergeInto(repo, "main", () => repo.write("config.txt", tenLines({ 5: "timeout = 30 # per tenant" })));
    for (const s of STRATEGIES) {
      const r = check(repo, "HEAD", s);
      expect(r.status, s).toBe("conflict-resolution");
      expect(r.conflictedFiles).toEqual(["config.txt"]);
      expect(r.findings, s).toEqual([]);
    }
    expect((await cli(repo.dir, "check")).code).toBe(0);
  });
});

describe("conflict resolved by taking ours", () => {
  it("flags main's dropped fix and names the main commit", async () => {
    const { repo, fix } = timeoutConflict();
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"));
    for (const s of STRATEGIES) {
      const r = check(repo, "HEAD", s);
      expect(r.status, s).toBe("findings");
      expect(r.findings, s).toHaveLength(1);
      const f = r.findings[0]!;
      expect(f.kind).toBe("dropped");
      expect(f.side).toBe("main");
      expect(f.level).toBe("error");
      expect(f.path).toBe("config.txt");
      expect(f.conflicted).toBe(true);
      expect(f.mergeLines).toEqual({ start: 5, end: 5 });
      expect(f.added).toEqual(["timeout = 30"]);
      expect(f.actual).toEqual(["timeout = 10 # per tenant"]);
      expect(f.commit?.sha).toBe(fix);
      expect(f.commit?.subject).toBe("Raise timeout to 30");
      expect(f.commit?.author).toBe("Ana Main");
    }
    const res = await cli(repo.dir, "check");
    expect(res.code).toBe(1);
    expect(res.out).toContain("dropped (main)  config.txt:5");
    expect(res.out).toContain(`introduced by ${fix.slice(0, 7)} "Raise timeout to 30" (Ana Main <ana.main@example.com>)`);

    const json = await cli(repo.dir, "check", "--json");
    expect(json.code).toBe(1);
    const report = JSON.parse(json.out) as CheckReport;
    expect(report.summary.findings.error).toBe(1);
    expect(report.merges[0]!.findings[0]!.commit!.short).toBe(fix.slice(0, 7));
  });

  it("also flags a non-conflicting main hunk lost by taking the whole file", async () => {
    const { repo } = timeoutConflict();
    onMain(repo, () => {
      repo.write("config.txt", tenLines({ 2: "retries = 5", 5: "timeout = 30" }));
      repo.commit("Retry five times");
    });
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"));
    const r = check(repo);
    const subjects = r.findings.map((f) => [f.mergeLines?.start, f.commit?.subject]);
    expect(subjects).toEqual([
      [2, "Retry five times"],
      [5, "Raise timeout to 30"],
    ]);
  });

  it("flags a line main deleted that the resolution kept (pure deletion)", async () => {
    const base = lines("class Service:", "  def __init__(self):", "    self.analyzer = AnalyzerEngine()", "    self.scorers = {}", "  def run(self): pass");
    const repo = baseRepo({ "service.py": base });
    repo.write("service.py", lines("class Service:", "  def __init__(self):", "    self.analyzer = AnalyzerEngine()", "    self.scorers = {tenant: {} for tenant in TENANTS}", "  def run(self): pass"));
    repo.commit("per-tenant scorers");
    let drop = "";
    onMain(repo, () => {
      repo.write("service.py", lines("class Service:", "  def __init__(self):", "    self.scorers = dict()", "  def run(self): pass"));
      drop = repo.commit("Drop identifier extraction");
    });
    // Wrong resolution: keep the branch side, which still has the analyzer line.
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "service.py"));
    const r = check(repo);
    const dropped = r.findings.filter((f) => f.kind === "dropped" && f.side === "main");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.removed).toContain("    self.analyzer = AnalyzerEngine()");
    expect(dropped[0]!.commit?.sha).toBe(drop);
  });
});

describe("evil merge", () => {
  it("flags an unrelated change made inside a clean merge", async () => {
    const repo = baseRepo({ "config.txt": tenLines(), "other.txt": "a\n", "app.txt": "run()\n" });
    repo.write("other.txt", "a\nfeature\n");
    repo.commit("feature work");
    onMain(repo, () => {
      repo.write("config.txt", tenLines({ 2: "line 2 fixed on main" }));
      repo.commit("fix line 2");
    });
    repo.git("merge", "--no-ff", "--no-commit", "main");
    repo.write("app.txt", "run()\nDEBUG = True\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "Merge main");
    for (const s of STRATEGIES) {
      const r = check(repo, "HEAD", s);
      expect(r.status, s).toBe("findings");
      expect(r.findings).toHaveLength(1);
      const f = r.findings[0]!;
      expect(f.kind).toBe("evil");
      expect(f.path).toBe("app.txt");
      expect(f.added).toEqual(["DEBUG = True"]);
      expect(f.mergeLines).toEqual({ start: 2, end: 2 });
      expect(f.conflicted).toBe(false);
    }
    expect((await cli(repo.dir, "check")).code).toBe(1);
  });

  it("flags edits outside the conflict region of a conflicted file", async () => {
    const { repo } = timeoutConflict();
    mergeInto(repo, "main", () =>
      repo.write("config.txt", tenLines({ 5: "timeout = 30 # per tenant", 9: "secret_backdoor = enabled" })),
    );
    const r = check(repo);
    expect(r.findings.map((f) => [f.kind, f.mergeLines?.start])).toEqual([["evil", 9]]);
  });
});

describe("branch legitimately changes the line after the merge", () => {
  it("does not flag the later commit, only what the merge did", async () => {
    const repo = baseRepo({ "config.txt": tenLines({ 5: "timeout = 10" }), "other.txt": "a\n" });
    repo.write("other.txt", "a\nfeature\n");
    repo.commit("feature work");
    onMain(repo, () => {
      repo.write("config.txt", tenLines({ 5: "timeout = 30" }));
      repo.commit("Raise timeout to 30");
    });
    mergeInto(repo, "main");
    repo.write("config.txt", tenLines({ 5: "timeout = 10" }));
    repo.commit("Tenant needs the short timeout back");
    const res = await cli(repo.dir, "check", "--json");
    const report = JSON.parse(res.out) as CheckReport;
    expect(report.merges).toHaveLength(1);
    expect(report.merges[0]!.status).toBe("clean");
    expect(res.code).toBe(0);
  });
});

describe("renamed file on main", () => {
  function renameRepo(): Repo {
    const repo = baseRepo({ "src/a.txt": tenLines() });
    return repo;
  }

  it("follows the rename on a clean merge", async () => {
    const repo = renameRepo();
    repo.write("src/a.txt", tenLines({ 8: "branch edit on line 8" }));
    repo.commit("branch edit");
    onMain(repo, () => {
      repo.git("mv", "src/a.txt", "src/b.txt");
      repo.write("src/b.txt", tenLines({ 2: "main edit on line 2" }));
      repo.commit("Rename a to b and fix line 2");
    });
    mergeInto(repo, "main");
    for (const s of STRATEGIES) {
      const r = check(repo, "HEAD", s);
      expect(r.status, s).toBe("clean");
    }
    expect((await cli(repo.dir, "check")).code).toBe(0);
  });

  it("flags main's change dropped in the renamed file", async () => {
    const repo = renameRepo();
    repo.write("src/a.txt", tenLines({ 2: "branch version of line 2" }));
    repo.commit("branch edit");
    let fix = "";
    onMain(repo, () => {
      repo.git("mv", "src/a.txt", "src/b.txt");
      repo.commit("Rename a to b");
      repo.write("src/b.txt", tenLines({ 2: "main fix on line 2" }));
      fix = repo.commit("Fix line 2", "Ana Main");
    });
    mergeInto(repo, "main", () => repo.write("src/b.txt", tenLines({ 2: "branch version of line 2" })));
    const r = check(repo);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.path).toBe("src/b.txt");
    expect(r.findings[0]!.side).toBe("main");
    expect(r.findings[0]!.commit?.sha).toBe(fix);
  });
});

describe("ignored lockfile", () => {
  function lockRepo(): Repo {
    const repo = baseRepo({ "package-lock.json": lines("{", '  "lodash": "4.17.20"', "}"), "index.js": "x\n" });
    repo.write("package-lock.json", lines("{", '  "lodash": "4.17.19"', "}"));
    repo.commit("pin lodash");
    onMain(repo, () => {
      repo.write("package-lock.json", lines("{", '  "lodash": "4.17.21"', "}"));
      repo.commit("bump lodash");
    });
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "package-lock.json"));
    return repo;
  }

  it("is flagged without config", async () => {
    const repo = lockRepo();
    const r = check(repo);
    expect(r.findings.map((f) => f.path)).toEqual(["package-lock.json"]);
  });

  it("is skipped when .mainfast.yml ignores it", async () => {
    const repo = lockRepo();
    repo.write(".mainfast.yml", "version: 1\nintact:\n  ignore:\n    - package-lock.json\n");
    const res = await cli(repo.dir, "check", "--json");
    const report = JSON.parse(res.out) as CheckReport;
    expect(report.merges[0]!.status).toBe("clean");
    expect(report.merges[0]!.notes.join(" ")).toContain("ignored by config");
    expect(res.code).toBe(0);
  });

  it("can be downgraded with severity instead of ignored", async () => {
    const repo = lockRepo();
    const cfg = parseConfig("version: 1\nintact:\n  severity:\n    '*.json': notice\n");
    const r = check(repo, "HEAD", undefined, cfg);
    expect(r.findings.map((f) => f.level)).toEqual(["notice"]);
    repo.write(".mainfast.yml", "version: 1\nintact:\n  severity:\n    '*.json': notice\n");
    expect((await cli(repo.dir, "check")).code).toBe(0);
    expect((await cli(repo.dir, "check", "--fail-on", "notice")).code).toBe(1);
  });
});

describe("octopus merge", () => {
  it("is reported as unsupported without failing", async () => {
    const repo = makeRepo();
    repo.write("a.txt", "a\n");
    repo.commit("base");
    for (const b of ["b1", "b2"]) {
      repo.git("checkout", "-q", "-b", b, "main");
      repo.write(`${b}.txt`, `${b}\n`);
      repo.commit(`add ${b}`);
    }
    repo.git("checkout", "-q", "-b", "feat", "main");
    repo.git("merge", "-q", "--no-ff", "--no-edit", "b1", "b2");
    expect(new Git(repo.dir).parents(repo.head())).toHaveLength(3);
    const r = check(repo);
    expect(r.status).toBe("unsupported");
    expect(r.notes[0]).toContain("octopus merge with 3 parents");
    const res = await cli(repo.dir, "check", "HEAD");
    expect(res.code).toBe(0);
    expect(res.out).toContain("unsupported");
    const range = await cli(repo.dir, "check", "--range", "main..feat", "--json");
    expect(JSON.parse(range.out).summary.unsupported).toBe(1);
  });
});

describe("pull request merged into main", () => {
  it("labels the first parent as main and the dropped branch change as a notice", async () => {
    const { repo } = timeoutConflict();
    repo.git("checkout", "-q", "main");
    mergeInto(repo, "feat", () => repo.git("checkout", "--ours", "config.txt"), "Merge pull request #1");
    const r = check(repo);
    expect(r.mainParent).toBe(0);
    expect(r.findings.map((f) => [f.kind, f.side, f.level])).toEqual([["dropped", "branch", "notice"]]);
    expect((await cli(repo.dir, "check", "HEAD")).code).toBe(0);
  });
});

describe("back-merge that later reached main through a pull request", () => {
  it("still treats the parent on main's own line as main", () => {
    const { repo } = timeoutConflict();
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"), "Merge branch 'main' into feat");
    const backMerge = repo.head();
    repo.git("checkout", "-q", "main");
    repo.git("merge", "-q", "--no-ff", "--no-edit", "feat");
    const r = check(repo, backMerge);
    expect(r.mainParent).toBe(1);
    expect(r.findings.map((f) => [f.kind, f.side, f.level])).toEqual([["dropped", "main", "error"]]);
  });
});

describe("dropped changes that stay visible as warnings", () => {
  /** Main changes `file`; the merge keeps the branch's version of it. */
  function dropOnMerge(file: string, base: string, ours: string, theirs: string, attrs?: string): MergeReport {
    const repo = baseRepo({ [file]: tenLines({ 5: base }), ...(attrs ? { ".gitattributes": attrs } : {}) });
    repo.write(file, tenLines({ 5: ours }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write(file, tenLines({ 5: theirs }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", file));
    return check(repo);
  }
  const levels = (r: MergeReport) => r.findings.map((f) => [f.level, f.softened]);

  it("lowers a change that is only a version bump", () => {
    const r = dropOnMerge("deps.props", "<Dep>1.2.3</Dep>", "<Dep>1.2.4</Dep>", "<Dep>1.3.0-rc.1</Dep>");
    expect(levels(r)).toEqual([["warning", "version-only"]]);
    expect(r.findings[0]!.message).toContain("version numbers");
  });

  it("keeps a changed setting as an error", () => {
    const r = dropOnMerge("deps.props", "timeout = 10", "timeout = 20", "timeout = 30");
    expect(levels(r)).toEqual([["error", undefined]]);
  });

  it("keeps a changed IP address as an error", () => {
    const r = dropOnMerge("hosts.txt", "host 10.0.0.1", "host 10.0.0.2", "host 10.0.0.3");
    expect(levels(r)).toEqual([["error", undefined]]);
  });

  it("keeps a lockfile version bump as an error", () => {
    const r = dropOnMerge("yarn.lock", 'version "1.2.3"', 'version "1.2.4"', 'version "1.3.0"');
    expect(levels(r)).toEqual([["error", undefined]]);
  });

  it("lowers generated files by path, attribute and header", () => {
    expect(levels(dropOnMerge("tests/baselines/a.txt", "base", "ours", "theirs"))).toEqual([["warning", "generated"]]);
    expect(levels(dropOnMerge("api.txt", "base", "ours", "theirs", "api.txt linguist-generated\n"))).toEqual([["warning", "generated"]]);
    const repo = baseRepo({ "gen.py": "# @generated by tool\n" + tenLines({ 5: "base" }) });
    repo.write("gen.py", "# @generated by tool\n" + tenLines({ 5: "ours" }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write("gen.py", "# @generated by tool\n" + tenLines({ 5: "theirs" }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "gen.py"));
    expect(levels(check(repo))).toEqual([["warning", "generated"]]);
  });

  it("keeps a change as an error but notes when the merge carries its lines in another file", () => {
    const moved = "const limit = computeTenantLimit(tenant);";
    const repo = baseRepo({ "a.ts": tenLines({ 5: "const limit = 10;" }), "b.ts": "start\n" });
    repo.write("a.ts", tenLines({ 5: "const limit = 20;" }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write("a.ts", tenLines({ 5: moved }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => {
      repo.git("checkout", "--ours", "a.ts");
      repo.write("b.ts", `start\n  ${moved}\n`);
    });
    const f = check(repo).findings.find((x) => x.path === "a.ts");
    expect(f?.level).toBe("error");
    expect(f?.message).toContain("may have been moved");
  });

  it("keeps a version bump as an error when another line changed with it", () => {
    const r = dropOnMerge("deps.props", "<Dep>1.2.3</Dep>", "<Dep>1.2.4</Dep>", "<Dep>1.3.0</Dep>\nextra();");
    expect(levels(r)).toEqual([["error", undefined]]);
  });

  it("keeps a version bump in a workflow or image pin as an error", () => {
    expect(levels(dropOnMerge(".github/workflows/ci.yml", "uses: a/b@1.2.3", "uses: a/b@1.2.4", "uses: a/b@1.3.0"))).toEqual([["error", undefined]]);
    expect(levels(dropOnMerge("Dockerfile", "FROM x:1.2.3", "FROM x:1.2.4", "FROM x:1.3.0"))).toEqual([["error", undefined]]);
  });

  it("keeps a renamed lockfile as an error", () => {
    const repo = baseRepo({ "yarn.lock": tenLines({ 5: 'version "1.2.3"' }) });
    repo.write("yarn.lock", tenLines({ 5: 'version "1.2.4"' }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write("yarn.lock", tenLines({ 5: 'version "1.3.0"' }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => {
      repo.git("checkout", "--ours", "yarn.lock");
      repo.git("add", "yarn.lock");
      repo.git("mv", "yarn.lock", "deps.txt");
    });
    const f = check(repo).findings.find((x) => x.kind === "dropped");
    expect([f?.level, f?.softened]).toEqual(["error", undefined]);
  });

  it("does not treat a change as moved when only some of its lines survive", () => {
    const repo = baseRepo({ "a.ts": tenLines({ 5: "const limit = 10;" }), "b.ts": "start\n" });
    repo.write("a.ts", tenLines({ 5: "const limit = 20;" }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write("a.ts", tenLines({ 5: "const limit = computeTenantLimit(tenant);\nauditLimit(limit, tenant, 'merge');" }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => {
      repo.git("checkout", "--ours", "a.ts");
      repo.write("b.ts", "start\nconst limit = computeTenantLimit(tenant);\n");
    });
    expect(check(repo).findings.find((f) => f.path === "a.ts")?.level).toBe("error");
  });

  it("lets a severity entry put it back to error", () => {
    const repo = baseRepo({ "deps.props": tenLines({ 5: "<Dep>1.2.3</Dep>" }) });
    repo.write("deps.props", tenLines({ 5: "<Dep>1.2.4</Dep>" }));
    repo.commit("branch change");
    onMain(repo, () => {
      repo.write("deps.props", tenLines({ 5: "<Dep>1.3.0</Dep>" }));
      repo.commit("main change");
    });
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "deps.props"));
    const config = parseConfig('version: 1\nintact:\n  severity:\n    "deps.props": error\n');
    expect(check(repo, "HEAD", undefined, config).findings[0]!.level).toBe("error");
  });
});

describe("fallback without remerge-diff", () => {
  it("is used automatically for old git and gives the same findings", async () => {
    const { pickStrategy } = await import("../src/automerge.ts");
    const fakeOld = { versionAtLeast: (ma: number, mi: number) => 2 > ma || (ma === 2 && 35 >= mi) } as unknown as Git;
    expect(pickStrategy(fakeOld)).toBe("worktree");
    const real = new Git(".");
    expect(pickStrategy(real)).toBe("remerge-diff");
    process.env[envName("FORCE_STRATEGY")] = "merge-tree";
    try {
      expect(pickStrategy(real)).toBe("merge-tree");
      const { repo, fix } = timeoutConflict();
      mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"));
      const report = runCheck({ cwd: repo.dir });
      expect(report.merges[0]!.strategy).toBe("merge-tree");
      expect(report.merges[0]!.findings.map((f) => f.commit?.sha)).toEqual([fix]);
    } finally {
      delete process.env[envName("FORCE_STRATEGY")];
    }
  });
});

describe("cli", () => {
  it("exits 2 on errors and bad usage", async () => {
    const repo = baseRepo({ "a.txt": "a\n" });
    expect((await cli(repo.dir, "check", "nope-not-a-rev")).code).toBe(2);
    expect((await cli(repo.dir, "check", "--bogus")).code).toBe(2);
    expect((await cli(repo.dir, "frobnicate")).code).toBe(2);
    repo.write(".mainfast.yml", "version: 2\n");
    expect((await cli(repo.dir, "check")).err).toContain("unsupported version 2");
  });

  it("reports a non-merge commit as nothing to check", async () => {
    const repo = baseRepo({ "a.txt": "a\n" });
    const res = await cli(repo.dir, "check", "HEAD");
    expect(res.code).toBe(0);
    expect(res.out).toContain("not a merge commit");
  });
});
