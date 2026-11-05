import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, prNumberFromEvent } from "../src/action.ts";
import { compress, evaluateCoverage, lookup, parseCobertura, parseLcov } from "../src/analyze/coverage.ts";
import { extractClaims } from "../src/analyze/claims.ts";
import { detectProvenance, parseGitAiNote } from "../src/analyze/provenance.ts";
import { defaultPolicy, nameMatcher, parsePolicy } from "../src/config.ts";
import { COMMENT_MARKER } from "../src/constants.ts";
import { parseGitDiff, parseHunks } from "../src/diff/patch.ts";
import { RestClient } from "../src/github/api.ts";
import { mockFetch } from "../src/github/mockFetch.ts";
import { findSticky, publish } from "../src/github/publish.ts";
import { mdCode, mdInline, mdText, plainText, safeUrl } from "../src/markdown.ts";
import { globToRegExp, matchesAny } from "@mainfast/shared/glob";
import { checkRunPayload, renderCard } from "../src/render.ts";
import type { PrSnapshot } from "../src/types.ts";
import { checkRun, file, HEAD, R, routes, runVariant } from "./helpers.ts";

function snap(over: Partial<PrSnapshot["pr"]> = {}, commits: PrSnapshot["commits"] = []): PrSnapshot {
  return {
    repo: "o/r",
    pr: { number: 1, title: "", body: "", authorLogin: "someone", authorType: "User", headRef: "feature/x", headSha: "h", baseRef: "main", baseSha: "b", labels: [], ...over },
    commits,
    files: [],
  };
}
const c = (message: string, extra: Partial<PrSnapshot["commits"][number]> = {}) => ({ sha: "c0ffee0000", message, authorName: "x", authorEmail: "x@example.com", ...extra });

describe("provenance catalog", () => {
  const m = defaultPolicy().agents;
  const cases: Array<[string, PrSnapshot, string]> = [
    ["Claude Code trailer", snap({}, [c("fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>")]), "Claude Code"],
    ["Claude Code branch", snap({ headRef: "claude/issue-12-20261027" }), "Claude Code"],
    ["Claude GitHub app", snap({ authorLogin: "claude[bot]", authorType: "Bot" }), "Claude Code"],
    ["Copilot coding agent author", snap({ authorLogin: "Copilot", authorType: "Bot", headRef: "copilot/fix-123" }), "GitHub Copilot coding agent"],
    ["Copilot co-author trailer", snap({}, [c("x\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>")]), "GitHub Copilot coding agent"],
    ["Codex branch", snap({ headRef: "codex/add-retry" }), "OpenAI Codex"],
    ["Codex connector", snap({ authorLogin: "chatgpt-codex-connector[bot]" }), "OpenAI Codex"],
    ["Cursor agent email", snap({}, [c("x", { authorEmail: "cursoragent@cursor.com" })]), "Cursor agent"],
    ["Devin bot", snap({ authorLogin: "devin-ai-integration[bot]" }), "Devin"],
    ["Dawnpatch branch", snap({ headRef: "dawnpatch/fix-null-deref" }), "Dawnpatch"],
    ["Aider commit prefix", snap({}, [c("aider: refactor parser")]), "Aider"],
  ];
  for (const [name, s, agent] of cases)
    it(name, () => {
      const p = detectProvenance(s, m);
      expect(p.isAgent).toBe(true);
      expect(p.agents).toContain(agent);
    });

  it("human PR with no signals", () => {
    expect(detectProvenance(snap({}, [c("fix typo")]), m).isAgent).toBe(false);
  });

  it("policy authors, branch prefixes, labels and trailers", () => {
    const { policy } = parsePolicy(
      "evidence:\n  agents:\n    use_defaults: false\n    authors: [house-bot]\n    branch_prefixes: [ai/]\n    labels: [robot]\n    trailers: ['^Agent-Session: ']\n",
    );
    const a = policy.agents;
    expect(detectProvenance(snap({ authorLogin: "House-Bot" }), a).isAgent).toBe(true);
    expect(detectProvenance(snap({ headRef: "ai/thing" }), a).isAgent).toBe(true);
    expect(detectProvenance(snap({ labels: ["Robot"] }), a).isAgent).toBe(true);
    expect(detectProvenance(snap({}, [c("x\n\nAgent-Session: 42")]), a).isAgent).toBe(true);
    // use_defaults: false turns the catalog off
    expect(detectProvenance(snap({ headRef: "claude/x" }), a).isAgent).toBe(false);
  });

  it("lists human commits mixed into an agent PR", () => {
    const p = detectProvenance(snap({ headRef: "claude/x" }, [c("Co-Authored-By: Claude <noreply@anthropic.com>", { sha: "aaaaaaa1" }), c("manual fix", { sha: "bbbbbbb2" })]), m);
    expect(p.humanCommits).toEqual(["bbbbbbb2"]);
  });

  it("parses a legacy-prompt git-ai note with a quoted path", () => {
    const note = `"src/my file.ts"\n  d9978a8723e02b52 1-4,9-10,12\n---\n${JSON.stringify({
      schema_version: "authorship/3.0.0",
      base_commit_sha: "abc",
      prompts: { d9978a8723e02b52: { agent_id: { tool: "cursor", id: "x", model: "gpt-5" }, total_additions: 7, total_deletions: 0, accepted_lines: 7, overriden_lines: 0 } },
    })}`;
    expect(parseGitAiNote("abc", note)).toEqual({ commit: "abc", tools: [{ tool: "cursor", model: "gpt-5" }], aiLines: 7, files: ["src/my file.ts"], schemaVersion: "authorship/3.0.0" });
    expect(parseGitAiNote("abc", "not a note")).toBeUndefined();
  });
});

describe("claims", () => {
  it.each([
    ["Added unit tests for the parser", "tests_added"],
    ["This PR includes regression tests.", "tests_added"],
    ["Tests added.", "tests_added"],
    ["All tests pass", "tests_pass"],
    ["CI is green", "tests_pass"],
    ["Verified that all tests pass", "tests_pass"],
  ])("%s", (text, kind) => {
    expect(extractClaims(text).map((x) => x.kind)).toContain(kind);
  });
  it.each(["No tests added", "Did not add tests", "- [ ] tests pass", "```\ntests pass\n```", "without new tests"])("not a claim: %s", (text) => {
    expect(extractClaims(text)).toEqual([]);
  });
});

describe("coverage", () => {
  const lcov = "TN:\nSF:/home/runner/work/widgets/widgets/src/price.ts\nDA:1,3\nDA:2,0\nDA:3,5\nDA:4,0\nLF:4\nLH:2\nend_of_record\n";
  const cobertura = `<?xml version="1.0" ?>
<coverage version="7.6.1" line-rate="0.5" branch-rate="0" lines-covered="2" lines-valid="4" timestamp="1761552000000">
  <sources><source>/home/runner/work/widgets/widgets</source></sources>
  <packages><package name="src" line-rate="0.5"><classes>
    <class name="price.py" filename="src/price.py" complexity="0" line-rate="0.5">
      <methods><method name="f" signature=""><lines><line number="2" hits="99"/></lines></method></methods>
      <lines><line number="1" hits="1"/><line number="2" hits="0"/><line number="3" hits="2"/><line number="4" hits="0"/></lines>
    </class>
  </classes></package></packages>
</coverage>`;
  const changed = (path: string) => [file(path, [], ["a", "b", "c", "d", "e"])].map((f) => ({ path: f.filename, status: "modified" as const, additions: 5, deletions: 0, patch: f.patch }));

  it("lcov: changed-line coverage with absolute SF paths", () => {
    const e = evaluateCoverage(changed("src/price.ts"), parseLcov(lcov), defaultPolicy());
    expect(e).toMatchObject({ present: true, instrumented: 4, covered: 2, pct: 50 });
    expect(e.uncovered).toEqual([{ path: "src/price.ts", lines: [2, 4] }]);
    expect(e.findings[0]!.id).toBe("coverage_below_threshold");
  });

  it("cobertura: class lines only (method copies ignored), source root joined", () => {
    const rep = parseCobertura(cobertura);
    expect(lookup(rep, "src/price.py")!.lines.get(2)).toBe(0);
    const e = evaluateCoverage(changed("src/price.py"), rep, defaultPolicy());
    expect(e.pct).toBe(50);
  });

  it("files missing from the report are listed, not counted", () => {
    const e = evaluateCoverage(changed("src/other.ts"), parseLcov(lcov), defaultPolicy());
    expect(e.notInReport).toEqual(["src/other.ts"]);
    expect(e.pct).toBeUndefined();
  });

  it("compress line ranges", () => expect(compress([5, 1, 2, 3, 9])).toBe("1-3, 5, 9"));
});

describe("config", () => {
  it("defaults when the file or section is missing", () => {
    expect(parsePolicy(undefined).policy).toEqual(defaultPolicy());
    expect(parsePolicy("intact:\n  foo: 1\n").policy).toEqual(defaultPolicy());
  });
  it("reports bad YAML and bad values without throwing", () => {
    expect(parsePolicy("evidence: [").warnings[0]).toMatch(/YAML parse error/);
    const { warnings, policy } = parsePolicy("evidence:\n  apply_to: everyone\n  flags: { skip_added: maybe }\n  diff: { max_lines: -1 }\n");
    expect(warnings).toEqual(['evidence.apply_to: expected "agents" or "all"', "evidence.flags.skip_added: expected fail, warn or off", "evidence.diff.max_lines: expected a non-negative number"]);
    expect(policy.flags.skip_added).toBe("fail");
  });
  it("paths replace defaults per category; flags accept false as off", () => {
    const { policy } = parsePolicy("evidence:\n  paths:\n    tests: ['spec/**']\n  flags:\n    touched_lockfiles: false\n  coverage: { min_changed_lines: 150 }\n");
    expect(policy.paths.tests).toEqual(["spec/**"]);
    expect(policy.paths.workflows.length).toBeGreaterThan(0);
    expect(policy.flags.touched_lockfiles).toBe("off");
    expect(policy.coverage.minChangedLinesPct).toBe(100);
  });
  it("name matchers", () => {
    expect(nameMatcher("Test")("unit-tests (ubuntu)")).toBe(true);
    expect(nameMatcher("/^e2e$/")("e2e")).toBe(true);
    expect(nameMatcher("/^e2e$/")("e2e-slow")).toBe(false);
  });
});

describe("glob", () => {
  it.each([
    [".github/workflows/**", ".github/workflows/ci.yml", true],
    ["yarn.lock", "packages/a/yarn.lock", true],
    ["/CODEOWNERS", "docs/CODEOWNERS", false],
    ["**/*.{test,spec}.{js,ts}", "src/a/b.spec.ts", true],
    ["**/test/**", "test/x.ts", true],
    ["**/test_*.py", "pkg/test_calc.py", true],
    ["jest.config.*", "apps/web/jest.config.cjs", true],
  ])("%s ~ %s = %s", (g, p, want) => expect(globToRegExp(g).test(p)).toBe(want));
  it("matchesAny", () => expect(matchesAny("a/b.go", ["*.py", "*.go"])).toBe(true));
});

describe("diff parsing", () => {
  it("tracks line numbers across hunks", () => {
    const lines = parseHunks("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z\n\\ No newline at end of file");
    expect(lines).toEqual([
      { kind: "del", text: "b", line: 2 },
      { kind: "add", text: "B", line: 2 },
      { kind: "add", text: "y", line: 11 },
    ]);
  });
  it("parses git diff headers: add, delete, rename, binary, quoted paths", () => {
    const d = [
      "diff --git a/new.ts b/new.ts\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+x",
      "diff --git a/old.py b/old.py\ndeleted file mode 100644\n--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-y",
      "diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts",
      "diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ",
      'diff --git "a/my file.go" "b/my file.go"\nindex 1..2 100644\n--- "a/my file.go"\n+++ "b/my file.go"\n@@ -1 +1 @@\n-a\n+b',
    ].join("\n");
    const fs = parseGitDiff(d);
    expect(fs.map((f) => [f.path, f.status, f.previousPath, f.additions, f.deletions, f.patch === undefined])).toEqual([
      ["new.ts", "added", undefined, 1, 0, false],
      ["old.py", "removed", undefined, 0, 1, false],
      ["b.ts", "renamed", "a.ts", 0, 0, false],
      ["img.png", "modified", undefined, 0, 0, true],
      ["my file.go", "modified", undefined, 1, 1, false],
    ]);
  });
});

describe("REST client", () => {
  it("follows Link pagination and sends version headers", async () => {
    const page2 = `https://api.github.com${R}/pulls/42/files?per_page=100&page=2`;
    const { fetch, calls } = mockFetch(
      routes({
        extra: {
          [`GET ${R}/pulls/42/files`]: { body: [{ filename: "a.ts", status: "added", additions: 1, deletions: 0, changes: 1, patch: "@@ -0,0 +1 @@\n+a" }], link: `<${page2}>; rel="next", <${page2}>; rel="last"` },
          [`GET ${R}/pulls/42/files?page=2`]: [{ filename: "b.ts", status: "added", additions: 1, deletions: 0, changes: 1, patch: "@@ -0,0 +1 @@\n+b" }],
        },
      }),
    );
    let headers: Record<string, string> = {};
    const api = new RestClient("t0k", {
      fetch: (u, i) => {
        headers = i.headers;
        return fetch(u, i);
      },
    });
    const files = await api.listPullFiles("octo-org", "widgets", 42);
    expect(files.map((f) => f.filename)).toEqual(["a.ts", "b.ts"]);
    expect(calls.map((x) => x.path)).toEqual([`${R}/pulls/42/files?per_page=100`, `${R}/pulls/42/files?per_page=100&page=2`]);
    expect(headers).toMatchObject({ authorization: "Bearer t0k", "x-github-api-version": "2022-11-28", accept: "application/vnd.github+json" }); // header names are case-insensitive; the shared client sends lower case
  });
});

describe("render and publish", () => {
  it("card lists failing flags and shows the head sha", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[1].conclusion = "skipped") });
    const card = renderCard(report);
    expect(card.startsWith(COMMENT_MARKER)).toBe(true);
    expect(card).toContain("Mainfast Evidence: FAIL");
    expect(card).toContain(`head \`${HEAD.slice(0, 7)}\``);
    expect(card).toContain("Required check was skipped or neutral");
    const payload = checkRunPayload(report);
    expect(payload).toMatchObject({ name: "Mainfast Evidence", head_sha: HEAD, status: "completed", conclusion: "failure" });
  });

  it("pending report creates an in_progress check run without a conclusion", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[0] = checkRun("test", null)) });
    const p = checkRunPayload(report);
    expect(p.status).toBe("in_progress");
    expect(p).not.toHaveProperty("conclusion");
  });

  it("creates the sticky comment once, then updates it; updates the existing check run", async () => {
    const existingComment = { id: 77, body: `${COMMENT_MARKER}\nold`, html_url: "https://github.com/x#c77", user: { login: "github-actions[bot]", type: "Bot" } };
    const { report } = await runVariant();
    // first run: nothing exists
    let m = mockFetch(routes());
    let res = await publish(new RestClient("t", { fetch: m.fetch }), report);
    expect(res.commentAction).toBe("created");
    expect(m.calls.filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.path}`)).toEqual([`POST ${R}/check-runs`, `POST ${R}/issues/42/comments`]);
    // second run: our check run and comment exist
    m = mockFetch(routes({ comments: [existingComment], checkRuns: (runs) => runs.push(checkRun("Mainfast Evidence", "success", { id: 555 })) }));
    res = await publish(new RestClient("t", { fetch: m.fetch }), report);
    expect(res.commentAction).toBe("updated");
    const writes = m.calls.filter((x) => x.method !== "GET");
    expect(writes.map((x) => `${x.method} ${x.path}`)).toEqual([`PATCH ${R}/check-runs/555`, `PATCH ${R}/issues/comments/77`]);
    expect(writes[0]!.body).not.toHaveProperty("head_sha");
  });
});

describe("markdown escaping of untrusted text", () => {
  it("mdText HTML-encodes, neutralises comments and escapes Markdown metacharacters", () => {
    expect(mdText("<!-- x --> & <img src=x>")).toBe("&lt;\\!-- x --&gt; &amp; &lt;img src=x&gt;");
    expect(mdText("[a](b) *c* _d_ `e` !f #g |h| ~i~ \\j")).toBe("\\[a\\]\\(b\\) \\*c\\* \\_d\\_ \\`e\\` \\!f \\#g \\|h\\| \\~i\\~ \\\\j");
    expect(mdText("one\ntwo\r\n# three")).toBe("one two \\# three");
    expect(mdText("a\u202eb\u0000c")).toBe("abc");
    expect(mdText("x".repeat(600))).toHaveLength(500);
  });

  it("mdCode uses a fence longer than any backtick run inside", () => {
    expect(mdCode("a.ts")).toBe("`a.ts`");
    expect(mdCode("a ` b")).toBe("``a ` b``");
    expect(mdCode("``x``")).toBe("``` ``x`` ```");
    expect(mdCode("<!-- x -->\nline")).toBe("`<!-- x --> line`"); // literal inside a code span
  });

  it("mdInline keeps our code spans and escapes everything else, whatever the backticks", () => {
    expect(mdInline("`src/a.ts:3` it.skip(\"x\")")).toBe("`src/a.ts:3` it.skip\\(\"x\"\\)");
    // Stray backticks only move what is code: "<!--" ends up literal inside a code span, and the
    // leftover backtick is escaped, so the span cannot be closed early or left open.
    expect(mdInline("`a` ` <!-- [x](javascript:alert(1)) `` b")).toBe("`a` `  <!-- [x](javascript:alert(1))  `\\` b");
    expect(mdInline("<!-- `x")).toBe("&lt;\\!-- \\`x");
  });

  it("plainText and safeUrl", () => {
    expect(plainText("a\r\nb\u0007", 10)).toBe("a\nb");
    expect(plainText("a\nb", 10, true)).toBe("a b");
    expect(safeUrl("https://github.com/o/r/runs/1")).toBe("https://github.com/o/r/runs/1");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://x/a) [y](https://evil")).toBeUndefined();
  });

  it("untrusted text in the card cannot forge the marker, open a comment, add lines or links", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[1].conclusion = "skipped") });
    const evil = `x ${COMMENT_MARKER} <!-- hide\n# Heading\n| a | b |\n[click](https://evil.example) <img src=x onerror=alert(1)> -->`;
    report.checks.tests[0]!.name = evil;
    report.claims.push({ quote: evil, verdict: "unbacked" } as (typeof report.claims)[number]);
    report.provenance.signals.push({ agent: "custom", source: "branch", detail: evil } as (typeof report.provenance.signals)[number]);
    report.policyWarnings.push(evil);
    report.flags.push({
      id: "skip_added",
      severity: "fail",
      title: evil,
      detail: `\`src/${evil}.ts:1\` ${evil}\n\`${"`".repeat(3)}\` ${evil}`,
      locations: [{ path: "src/a.ts", line: 1, message: `${evil}\u0007` }],
    } as (typeof report.flags)[number]);
    const card = renderCard(report, { checkUrl: "https://evil) [x](https://evil.example" });
    expect(card.split(COMMENT_MARKER)).toHaveLength(2); // exactly one marker
    expect(card.startsWith(COMMENT_MARKER)).toBe(true);
    // The only "<!--" outside code spans is our marker; nothing can open or close a comment.
    const noCode = card.replace(/\\[\s\S]/g, "").replace(/(`+)[^\n]*?\1/g, ""); // drop escapes, then code spans
    expect(noCode.split("<!--")).toHaveLength(2);
    expect(noCode).not.toMatch(/<img|\]\(https:\/\/evil/);
    expect(card).not.toMatch(/^# Heading/m);
    expect(card).not.toContain("[check run](");
    // every table row still has exactly two cells
    for (const row of card.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"))) {
      expect(row.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|")).toHaveLength(4);
    }
    const ann = checkRunPayload(report).output.annotations!.find((a) => a.message.startsWith("x "))!;
    expect(ann.message).not.toContain("\u0007");
    expect(ann.title).not.toContain("\n");
  });
});

describe("sticky comment ownership", () => {
  const bot = (id: number, login: string, body = `${COMMENT_MARKER}\nold`) => ({ id, body, html_url: `https://github.com/x#c${id}`, user: { login, type: login.endsWith("[bot]") ? "Bot" : "User" } });

  it("ignores a marker pasted into someone else's comment", () => {
    const comments = [bot(1, "mallory"), bot(2, "someone", `quoting: ${COMMENT_MARKER}`), bot(3, "github-actions[bot]")];
    expect(findSticky(comments, "github-actions[bot]")?.id).toBe(3);
    expect(findSticky(comments.slice(0, 2), "github-actions[bot]")).toBeUndefined();
    expect(findSticky([bot(4, "github-actions[bot]", "no marker")], "github-actions[bot]")).toBeUndefined();
  });

  it("creates its own comment instead of editing a user's marker comment", async () => {
    const { report } = await runVariant();
    const m = mockFetch(routes({ comments: [bot(66, "mallory")] }));
    const res = await publish(new RestClient("t", { fetch: m.fetch }), report);
    expect(res.commentAction).toBe("created");
    expect(m.calls.filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.path}`)).toEqual([`POST ${R}/check-runs`, `POST ${R}/issues/42/comments`]);
  });

  it("uses GET /user when the token can read it, and the comment-author override", async () => {
    const { report } = await runVariant();
    let m = mockFetch(routes({ comments: [bot(70, "github-actions[bot]"), bot(71, "release-robot")], extra: { "GET /user": { login: "release-robot", type: "User" } } }));
    let res = await publish(new RestClient("t", { fetch: m.fetch }), report);
    expect(res.commentAction).toBe("updated");
    expect(m.calls.find((x) => x.method === "PATCH" && x.path.includes("/issues/comments/"))!.path).toBe(`${R}/issues/comments/71`);

    m = mockFetch(routes({ comments: [bot(70, "github-actions[bot]"), bot(72, "my-app[bot]")] }));
    res = await publish(new RestClient("t", { fetch: m.fetch }), report, { commentAuthor: "my-app[bot]" });
    expect(m.calls.find((x) => x.method === "PATCH" && x.path.includes("/issues/comments/"))!.path).toBe(`${R}/issues/comments/72`);
  });
});

describe("action", () => {
  function env(extra: Record<string, string> = {}) {
    const d = mkdtempSync(join(tmpdir(), "evidence-action-"));
    const eventPath = join(d, "event.json");
    writeFileSync(eventPath, JSON.stringify({ action: "synchronize", number: 42, pull_request: { number: 42, head: { sha: HEAD } } }));
    const out = join(d, "out.txt");
    writeFileSync(out, "");
    return {
      d,
      out,
      env: {
        GITHUB_REPOSITORY: "octo-org/widgets",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: join(d, "summary.md"),
        RUNNER_TEMP: d,
        INPUT_TOKEN: "t",
        "INPUT_LOCAL-DIFF": "false",
        ...extra,
      },
    };
  }

  it("evaluates, posts, and writes outputs", async () => {
    const e = env();
    const m = mockFetch(routes({ files: (fs) => fs.push(file(".github/workflows/ci.yml", [], ["# x"])) }));
    const { exitCode, report } = await run({ env: e.env, api: new RestClient("t", { fetch: m.fetch }) });
    expect(report!.conclusion).toBe("failure");
    expect(exitCode).toBe(0); // the check run carries the verdict; fail-job defaults to auto
    const out = readFileSync(e.out, "utf8");
    expect(out).toMatch(/conclusion<<ghadelim_\S+\nfailure\n/);
    expect(out).toMatch(/flags<<ghadelim_\S+\ntouched_workflows\n/);
    expect(out).toMatch(/is-agent<<ghadelim_\S+\ntrue\n/);
    expect(readFileSync(join(e.d, "summary.md"), "utf8")).toContain("CI workflow files changed");
  });

  it("fails the job when it cannot post (fork PR, read-only token)", async () => {
    const e = env();
    const m = mockFetch(
      routes({
        files: (fs) => fs.push(file(".github/workflows/ci.yml", [], ["# x"])),
        extra: { [`POST ${R}/check-runs`]: { status: 403, body: { message: "Resource not accessible by integration" } } },
      }),
    );
    const { exitCode } = await run({ env: e.env, api: new RestClient("t", { fetch: m.fetch }) });
    expect(exitCode).toBe(1);
  });

  it("waits for test checks to finish on the head sha", async () => {
    const e = env({ "INPUT_WAIT-FOR-CHECKS": "120", "INPUT_POLL-INTERVAL": "5" });
    const r = routes({ checkRuns: (runs) => (runs[0] = checkRun("test", null)) });
    const m = mockFetch(r);
    let t = 0;
    let polls = 0;
    const { report } = await run({
      env: e.env,
      api: new RestClient("t", { fetch: m.fetch }),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        polls++;
        // the test job finishes while we wait
        const key = `GET ${R}/commits/${HEAD}/check-runs`;
        (r[key] as { check_runs: unknown[] }).check_runs[0] = checkRun("test", "success");
      },
    });
    expect(polls).toBe(1);
    expect(report!.checks.testsState).toBe("passed");
    expect(report!.conclusion).toBe("success");
  });

  it("no PR in the event: exits 0 without calls", async () => {
    const e = env({ GITHUB_EVENT_NAME: "push" });
    writeFileSync(e.env.GITHUB_EVENT_PATH, JSON.stringify({ ref: "refs/heads/main" }));
    const { exitCode, report } = await run({ env: e.env, api: new RestClient("t", { fetch: mockFetch({}).fetch }) });
    expect(exitCode).toBe(0);
    expect(report).toBeUndefined();
  });

  it("PR number from workflow_run and check_suite events", () => {
    expect(prNumberFromEvent("workflow_run", { workflow_run: { pull_requests: [{ number: 9 }] } })).toBe(9);
    expect(prNumberFromEvent("check_suite", { check_suite: { pull_requests: [{ number: 8 }] } })).toBe(8);
    expect(prNumberFromEvent("workflow_run", { workflow_run: { pull_requests: [] } })).toBeUndefined();
  });
});

describe("examples", () => {
  const root = join(import.meta.dirname, "..");
  it("examples/mainfast.yml parses without warnings", () => {
    const { warnings, policy } = parsePolicy(readFileSync(join(root, "examples/mainfast.yml"), "utf8"));
    expect(warnings).toEqual([]);
    expect(policy.flags.touched_lockfiles).toBe("off");
  });
  it("CLI pr --fixture examples/fixture-pr.json fails with three flags", async () => {
    const { main } = await import("../src/cli.ts");
    let out = "";
    const code = await main(["pr", "--repo", "octo-org/widgets", "--pr", "42", "--fixture", join(root, "examples/fixture-pr.json"), "--json"], { out: (s) => (out += s), err: () => {} });
    expect(code).toBe(1);
    expect(JSON.parse(out).flags.map((f: { id: string }) => f.id)).toEqual(["required_check_skipped", "touched_workflows", "skip_added"]);
  });
});
