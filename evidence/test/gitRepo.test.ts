// Real temporary git repositories: diff analysis and weakened-test detection across JS/TS/Python/Go,
// plus git-ai notes and the offline CLI.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { defaultPolicy, parsePolicy } from "../src/config.ts";
import { evaluate } from "../src/evaluate.ts";
import { localSnapshot } from "../src/local.ts";

let dir: string;

function g(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
}

function write(path: string, text: string): void {
  const abs = join(dir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function commit(msg: string, author = "Dev <dev@example.com>"): string {
  g("add", "-A");
  g("-c", "user.name=Dev", "-c", "user.email=dev@example.com", "commit", "-q", "--allow-empty", "-m", msg, `--author=${author}`);
  return g("rev-parse", "HEAD").trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "evidence-git-"));
  g("init", "-q", "-b", "main");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function analyze(opts: { body?: string; config?: string } = {}) {
  const { policy } = opts.config ? parsePolicy(opts.config) : { policy: defaultPolicy() };
  policy.applyTo = "all";
  const snap = localSnapshot(dir, { base: "main", head: "HEAD", body: opts.body });
  return evaluate(snap, policy);
}

const ids = (r: ReturnType<typeof analyze>) => r.flags.map((f) => f.id).sort();

const JS_TEST = `import { add } from "./add";
describe("add", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
    expect(add(-1, 1)).toBe(0);
  });
  it("handles zero", () => {
    expect(add(0, 0)).toBe(0);
  });
});
`;

const PY_TEST = `import pytest
from calc import add

def test_add():
    assert add(1, 2) == 3
    assert add(-1, 1) == 0

def test_zero():
    assert add(0, 0) == 0

class TestCalc:
    def test_method(self):
        self.assertEqual(add(2, 2), 4)
`;

const GO_TEST = `package calc

import "testing"

func TestAdd(t *testing.T) {
	if add(1, 2) != 3 {
		t.Fatalf("want 3")
	}
	if add(-1, 1) != 0 {
		t.Errorf("want 0")
	}
}

func TestZero(t *testing.T) {
	t.Run("zero", func(t *testing.T) {
		if add(0, 0) != 0 {
			t.Error("want 0")
		}
	})
}
`;

function seed(): void {
  write("src/add.ts", "export const add = (a: number, b: number) => a + b;\n");
  write("src/add.test.ts", JS_TEST);
  write("web/sum.spec.js", JS_TEST.replace('"./add"', '"../src/add"'));
  write("py/calc.py", "def add(a, b):\n    return a + b\n");
  write("py/tests/test_calc.py", PY_TEST);
  write("go/calc.go", "package calc\n\nfunc add(a, b int) int { return a + b }\n");
  write("go/calc_test.go", GO_TEST);
  write(".github/workflows/ci.yml", "on: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n");
  write("package-lock.json", '{ "lockfileVersion": 3 }\n');
  commit("seed");
  g("checkout", "-q", "-b", "claude/change");
}

describe("weakened tests in a real repo", () => {
  beforeEach(seed);

  it("clean change: a new test case is credited and nothing fires", () => {
    write("src/add.test.ts", JS_TEST.replace("});\n", '});\n  it("adds negatives", () => {\n    expect(add(-2, -3)).toBe(-5);\n  });\n'));
    commit("Add negative test\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    const r = analyze({ body: "Added tests for negatives." });
    expect(ids(r)).toEqual([]);
    expect(r.tamper.addedTestCases).toBe(1);
    expect(r.claims[0]!.verdict).toBe("backed");
    expect(r.provenance.signals.map((s) => s.source).sort()).toEqual(["branch", "trailer"]);
  });

  it("TS: .skip, xit and a dropped expect", () => {
    write(
      "src/add.test.ts",
      JS_TEST.replace('it("adds"', 'it.skip("adds"').replace("    expect(add(-1, 1)).toBe(0);\n", "").replace('it("handles zero"', 'xit("handles zero"'),
    );
    commit("tweak tests");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["skip_added", "assertions_dropped", "touched_tests"]));
    const skip = r.flags.find((f) => f.id === "skip_added")!;
    expect(skip.locations!.map((l) => l.line)).toEqual([3, 6]);
    expect(r.tamper.net.assertions).toBe(-1);
    expect(r.tamper.net.cases).toBe(0); // skipped cases still count as cases; the skip flag covers them
  });

  it("JS: describe.only focuses the file", () => {
    write("web/sum.spec.js", JS_TEST.replace('"./add"', '"../src/add"').replace('describe("add"', 'describe.only("add"'));
    commit("focus");
    expect(ids(analyze())).toContain("focus_added");
  });

  it("JS: replacing a real assertion with a tautology", () => {
    write("src/add.test.ts", JS_TEST.replace("expect(add(0, 0)).toBe(0);", "expect(true).toBe(true);"));
    commit("make it pass");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["trivial_assertion_added", "touched_tests"]));
  });

  it("Python: @pytest.mark.skip, removed assert, deleted test function", () => {
    write(
      "py/tests/test_calc.py",
      PY_TEST.replace("def test_add():", '@pytest.mark.skip(reason="flaky")\ndef test_add():')
        .replace("    assert add(-1, 1) == 0\n", "")
        .replace("def test_zero():\n    assert add(0, 0) == 0\n\n", ""),
    );
    commit("skip flaky");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["skip_added", "assertions_dropped", "tests_removed"]));
    expect(r.tamper.net).toEqual({ assertions: -2, cases: -1 });
  });

  it("Python: self.skipTest and assert True", () => {
    write("py/tests/test_calc.py", PY_TEST.replace("        self.assertEqual(add(2, 2), 4)", '        self.skipTest("later")\n        assert True'));
    commit("skip");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["skip_added", "trivial_assertion_added", "assertions_dropped"]));
  });

  it("Python: commented-out assert", () => {
    write("py/tests/test_calc.py", PY_TEST.replace("    assert add(1, 2) == 3", "    # assert add(1, 2) == 3"));
    commit("comment");
    expect(ids(analyze())).toEqual(expect.arrayContaining(["assertions_commented_out", "assertions_dropped"]));
  });

  it("Go: t.Skip and removed t.Errorf / t.Run", () => {
    write(
      "go/calc_test.go",
      GO_TEST.replace("func TestAdd(t *testing.T) {\n", 'func TestAdd(t *testing.T) {\n\tt.Skip("todo")\n')
        .replace('\tif add(-1, 1) != 0 {\n\t\tt.Errorf("want 0")\n\t}\n', "")
        .replace(/\tt\.Run\("zero"[\s\S]*?\}\)\n/, ""),
    );
    commit("go skip");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["skip_added", "assertions_dropped", "tests_removed"]));
    expect(r.tamper.net).toEqual({ assertions: -2, cases: -1 });
  });

  it("Go: deleting a _test.go file", () => {
    g("rm", "-q", "go/calc_test.go");
    commit("rm test");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["tests_deleted", "tests_removed", "assertions_dropped", "touched_tests"]));
    expect(r.tamper.net.cases).toBe(-3);
  });

  it("moving tests between files is not a drop", () => {
    const moved = '  it("handles zero", () => {\n    expect(add(0, 0)).toBe(0);\n  });\n';
    write("src/add.test.ts", JS_TEST.replace(moved, ""));
    write("src/zero.test.ts", `import { add } from "./add";\ndescribe("zero", () => {\n${moved}});\n`);
    commit("split tests");
    const r = analyze();
    expect(r.tamper.net).toEqual({ assertions: 0, cases: 0 });
    expect(ids(r)).toEqual(["touched_tests"]);
  });

  it("pure rename of a test file is visible but not a deletion", () => {
    g("mv", "src/add.test.ts", "src/add.unit.test.ts");
    commit("rename");
    const r = analyze();
    const f = r.tamper.testStats.find((s) => s.path === "src/add.unit.test.ts");
    expect(f?.status).toBe("renamed");
    expect(ids(r)).toEqual(["touched_tests"]);
  });

  it("workflow, lockfile and policy edits; policy read from base", () => {
    write(".mainfast.yml", "evidence:\n  flags:\n    touched_workflows: off\n");
    write(".github/workflows/ci.yml", "on: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test || true\n");
    write("package-lock.json", '{ "lockfileVersion": 3, "packages": {} }\n');
    commit("loosen");
    const r = analyze();
    expect(ids(r)).toEqual(expect.arrayContaining(["touched_workflows", "touched_lockfiles", "touched_policy"]));
  });

  it("secrets in added lines only, never in removed ones", () => {
    const key = ["AKIA", "Q4R7", "T2VX", "Z8N3", "B6MC"].join("");
    write("src/config.ts", `export const key = "${key}";\n`);
    commit("add key");
    const r = analyze();
    expect(r.secrets).toHaveLength(1);
    expect(r.secrets[0]).toMatchObject({ path: "src/config.ts", line: 1 });
  });
});

describe("git-ai notes", () => {
  it("reads refs/notes/ai (Git AI Standard v3) as provenance", () => {
    write("a.txt", "a\n");
    commit("base");
    g("checkout", "-q", "-b", "feature");
    write("src/main.rs", "fn main() {}\nfn a() {}\nfn b() {}\n");
    const sha = commit("plain message, no trailers");
    const note = [
      "src/main.rs",
      "  s_1a2b3c4d5e6f70::t_0a1b2c3d4e5f60 1-2",
      "  h_9f8e7d6c5b4a30 3",
      "---",
      JSON.stringify(
        {
          schema_version: "authorship/3.0.0",
          git_ai_version: "1.3.4",
          base_commit_sha: sha,
          prompts: {},
          sessions: { s_1a2b3c4d5e6f70: { agent_id: { tool: "claude", id: "conv-123", model: "claude-opus-5-5" } } },
          humans: { h_9f8e7d6c5b4a30: { author: "Dev" } },
        },
        null,
        2,
      ),
    ].join("\n");
    g("-c", "user.name=Dev", "-c", "user.email=dev@example.com", "notes", "--ref=ai", "add", "-m", note, sha);
    const r = analyze();
    expect(r.provenance.isAgent).toBe(true);
    expect(r.provenance.agents).toEqual(["Claude Code"]);
    expect(r.provenance.gitAi[0]).toMatchObject({ aiLines: 2, files: ["src/main.rs"], schemaVersion: "authorship/3.0.0" });
    expect(r.provenance.signals[0]!.detail).toContain("claude-opus-5-5");
  });
});

describe("CLI local", () => {
  it("prints a card and exits 1 when evidence fails", async () => {
    seed();
    write("src/add.test.ts", JS_TEST.replace('it("adds"', 'it.skip("adds"'));
    commit("skip\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    let out = "";
    const code = await main(["local", "--repo", dir, "--base", "main"], { out: (s) => (out += s), err: () => {} });
    expect(code).toBe(1);
    expect(out).toContain("Mainfast Evidence: FAIL");
    expect(out).toContain("Tests skipped");
    expect(out).toContain("not evaluated (offline)");
  });

  it("--json emits the full report and coverage from an lcov file", async () => {
    seed();
    write("src/add.ts", "export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\nexport const mul = (a: number, b: number) => a * b;\n");
    commit("add ops\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    write("coverage/lcov.info", "TN:\nSF:" + join(dir, "src/add.ts") + "\nDA:1,4\nDA:2,1\nDA:3,0\nend_of_record\n");
    let out = "";
    const code = await main(["local", "--repo", dir, "--base", "main", "--json", "--coverage", "coverage/lcov.info"], { out: (s) => (out += s), err: () => {} });
    const r = JSON.parse(out);
    expect(r.coverage).toMatchObject({ present: true, instrumented: 2, covered: 1, pct: 50 });
    expect(r.flags.map((f: { id: string }) => f.id)).toContain("coverage_below_threshold");
    expect(code).toBe(0); // coverage is a warning by default
  });
});
