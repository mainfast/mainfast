// Release pass (28 Oct 2026): fork PRs on workflow_run, tests_skipped, non-agent success, agent
// catalog corrections, plain-text CLI output, one-line fixes.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/action.ts";
import { detectProvenance } from "../src/analyze/provenance.ts";
import { main } from "../src/cli.ts";
import { defaultPolicy, DEFAULT_FLAGS } from "../src/config.ts";
import { FLAG_FIXES } from "../src/fixes.ts";
import { RestClient } from "../src/github/api.ts";
import { mockFetch } from "../src/github/mockFetch.ts";
import { pullMatches, resolveWorkflowRunPr } from "../src/github/resolve.ts";
import { checkRunPayload, renderCard, renderText } from "../src/render.ts";
import { FLAG_IDS, type PrSnapshot } from "../src/types.ts";
import { checkRun, fx, HEAD, ids, R, REPO, routes, runVariant } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");

function snap(over: Partial<PrSnapshot["pr"]> = {}, commits: PrSnapshot["commits"] = []): PrSnapshot {
  return {
    repo: "o/r",
    pr: { number: 1, title: "", body: "", authorLogin: "someone", authorType: "User", headRef: "feature/x", headSha: "h", baseRef: "main", baseSha: "b", labels: [], ...over },
    commits,
    files: [],
  };
}
const c = (message: string, extra: Partial<PrSnapshot["commits"][number]> = {}) => ({ sha: "c0ffee0000", message, authorName: "x", authorEmail: "x@example.com", ...extra });
const agentsOf = (s: PrSnapshot) => detectProvenance(s, defaultPolicy().agents).agents;

describe("agent catalog (checked against public docs and PRs)", () => {
  it("Copilot coding agent: Agent-Logs-Url trailer and its noreply co-author", () => {
    expect(agentsOf(snap({}, [c("Fix\n\nAgent-Logs-Url: https://github.com/o/r/sessions/abc")]))).toEqual(["GitHub Copilot coding agent"]);
    expect(agentsOf(snap({}, [c("x", { authorEmail: "198982749+Copilot@users.noreply.github.com" })]))).toEqual(["GitHub Copilot coding agent"]);
  });
  it("Copilot in VS Code is told apart from the coding agent", () => {
    expect(agentsOf(snap({}, [c("x\n\nCo-authored-by: Copilot <copilot@github.com>")]))).toEqual(["GitHub Copilot in VS Code"]);
  });
  it("Cursor: co-author trailer and Made with Cursor", () => {
    expect(agentsOf(snap({}, [c("x\n\nCo-authored-by: Cursor <cursoragent@cursor.com>")]))).toEqual(["Cursor agent"]);
    expect(agentsOf(snap({ body: "Summary\n\nMade with [Cursor](https://cursor.com)" }))).toEqual(["Cursor agent"]);
  });
  it("Devin: devin/ branch and the Link to Devin run footer", () => {
    expect(agentsOf(snap({ headRef: "devin/1733590332-jwt-validator" }))).toEqual(["Devin"]);
    expect(agentsOf(snap({ body: "Link to Devin run: https://preview.devin.ai/sessions/51826709fcd3457abc4be25e587c790c" }))).toEqual(["Devin"]);
  });
  it("Claude: claude[bot] and the Claude Code footer; a human named claude is not an agent", () => {
    expect(agentsOf(snap({ authorLogin: "claude[bot]", authorType: "Bot" }))).toEqual(["Claude Code"]);
    expect(agentsOf(snap({ body: "🤖 Generated with [Claude Code](https://claude.com/claude-code)" }))).toEqual(["Claude Code"]);
    expect(detectProvenance(snap({ authorLogin: "claude" }), defaultPolicy().agents).isAgent).toBe(false);
  });
  it("loose wording is not a Codex signal; the task link is", () => {
    expect(detectProvenance(snap({ body: "Follow-up to the codex task we discussed" }), defaultPolicy().agents).isAgent).toBe(false);
    expect(agentsOf(snap({ body: "https://chatgpt.com/codex/tasks/task_e_123" }))).toEqual(["OpenAI Codex"]);
  });
});

describe("tests_skipped", () => {
  const neutralBody = (p: any) => (p.body = "Rounds prices half-up.");
  it("a skipped test job is its own warning, not tests_failed", async () => {
    const { report } = await runVariant({ pull: neutralBody, checkRuns: (runs) => runs.push(checkRun("e2e", "skipped")) });
    expect(report.checks.testsState).toBe("skipped");
    expect(ids(report)).toEqual(["tests_skipped"]);
    expect(report.flags[0]!.severity).toBe("warn");
    expect(report.flags[0]!.detail).toMatch(/e2e: skipped — \d+ other test checks? passed/);
    expect(report.conclusion).toBe("success");
  });
  it("a skipped REQUIRED test job also fires required_check_skipped (fail)", async () => {
    const { report } = await runVariant({ pull: neutralBody, checkRuns: (runs) => (runs.find((r) => r.name === "test").conclusion = "skipped") });
    expect(ids(report)).toEqual(["required_check_skipped", "tests_skipped"]);
    expect(report.conclusion).toBe("failure");
  });
  it("a 'tests pass' claim is unbacked when the tests were skipped", async () => {
    const { report } = await runVariant({
      pull: (p) => (p.body = "All tests pass."),
      checkRuns: (runs) => runs.push(checkRun("e2e", "skipped")),
    });
    expect(ids(report)).toContain("claim_tests_pass_unbacked");
    expect(report.claims.find((x) => x.kind === "tests_pass")!.why).toMatch(/skipped/);
  });
  it("can be made a failure by policy", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => runs.push(checkRun("e2e", "skipped")), config: "evidence:\n  flags: { tests_skipped: fail }\n" });
    expect(report.conclusion).toBe("failure");
  });
});

describe("permissions", () => {
  it("commit statuses unreadable (no statuses: read): a note on the card, not an error", async () => {
    const { report } = await runVariant({ extra: { [`GET ${R}/commits/${HEAD}/status`]: { status: 403, body: { message: "Resource not accessible by integration" } } } });
    expect(report.checks.notes.join(" ")).toMatch(/statuses: read/);
    expect(renderCard(report)).toMatch(/Not readable with this token/);
  });
});

describe("non-agent PRs (apply_to: agents)", () => {
  it("conclusion success, title 'Not an agent PR'", async () => {
    const { report } = await runVariant({
      pull: (p) => {
        p.head.ref = "fix/rounding";
        p.body = "Fix rounding.";
      },
      commits: (cs) => cs.forEach((x) => (x.commit.message = "plain")),
    });
    const p = checkRunPayload(report);
    expect(p).toMatchObject({ status: "completed", conclusion: "success", output: { title: "Not an agent PR" } });
    expect(renderCard(report)).toMatch(/Mainfast Evidence: PASS — Not an agent PR/);
  });
});

describe("fork PRs on workflow_run", () => {
  const FORK = "mallory/widgets";
  const forkPull = () => {
    const p = fx("pull.json");
    p.head.repo = { full_name: FORK };
    p.head.ref = "claude/fix-price-rounding";
    return p;
  };
  const wr = (extra: Record<string, unknown> = {}) => ({
    head_sha: HEAD,
    head_branch: "claude/fix-price-rounding",
    head_repository: { full_name: FORK, owner: { login: "mallory" } },
    pull_requests: [],
    ...extra,
  });

  it("finds the PR by head sha and checks it against the PR record", async () => {
    const m = mockFetch({ [`GET ${R}/commits/${HEAD}/pulls`]: [forkPull()] });
    const found = await resolveWorkflowRunPr(new RestClient("t", { fetch: m.fetch }), "octo-org", "widgets", wr());
    expect(found).toMatchObject({ number: 42, via: "commit-pulls", fork: true });
  });

  it("rejects candidates whose head sha differs or whose base is another repository", async () => {
    const other = forkPull();
    other.base.repo.full_name = "someone/else";
    const moved = forkPull();
    moved.head.sha = "f".repeat(40);
    const m = mockFetch({ [`GET ${R}/commits/${HEAD}/pulls`]: [other, moved], [`GET ${R}/pulls`]: [other, moved] });
    expect(await resolveWorkflowRunPr(new RestClient("t", { fetch: m.fetch }), "octo-org", "widgets", wr())).toBeUndefined();
    expect(pullMatches(forkPull(), REPO, HEAD)).toBe(true);
    expect(pullMatches({ ...forkPull(), state: "closed" }, REPO, HEAD)).toBe(false);
  });

  it("falls back to scanning open PRs when the commit lookup is refused", async () => {
    const m = mockFetch({ [`GET ${R}/commits/${HEAD}/pulls`]: { status: 403, body: { message: "no" } }, [`GET ${R}/pulls`]: [forkPull()] });
    const found = await resolveWorkflowRunPr(new RestClient("t", { fetch: m.fetch }), "octo-org", "widgets", wr({ head_repository: null }));
    expect(found).toMatchObject({ number: 42, via: "open-scan" });
  });

  it("an event-listed PR that moved on is left to the newer run", async () => {
    const p = fx("pull.json");
    p.head.sha = "e".repeat(40);
    const m = mockFetch({ [`GET ${R}/pulls/42`]: p });
    const found = await resolveWorkflowRunPr(new RestClient("t", { fetch: m.fetch }), "octo-org", "widgets", wr({ pull_requests: [{ number: 42 }], head_repository: { full_name: REPO } }));
    expect(found?.pull).toBeUndefined();
    expect(found?.note).toMatch(/moved on/);
  });

  function actionEnv(workflowRun: Record<string, unknown>) {
    const d = mkdtempSync(join(tmpdir(), "evidence-fork-"));
    const eventPath = join(d, "event.json");
    writeFileSync(eventPath, JSON.stringify({ action: "completed", workflow_run: workflowRun }));
    const out = join(d, "out.txt");
    writeFileSync(out, "");
    return {
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_NAME: "workflow_run",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: out,
      RUNNER_TEMP: d,
      GITHUB_WORKSPACE: d,
      INPUT_TOKEN: "t",
    };
  }

  it("the Action gives a fork PR a card, with the base branch's policy, never the fork's", async () => {
    const r = routes({
      pull: (p) => (p.head.repo = { full_name: FORK }),
      // base policy: workflow edits are only a warning; the fork's own .mainfast.yml would switch everything off
      config: "evidence:\n  flags: { touched_workflows: warn }\n",
      files: (fs) => fs.push({ filename: ".mainfast.yml", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ -1,0 +1,1 @@\n+evidence: { apply_to: agents, flags: { touched_policy: off } }" }),
      extra: { [`GET ${R}/commits/${HEAD}/pulls`]: [{ ...forkPull(), state: "open" }] },
    });
    const m = mockFetch(r);
    const { report, exitCode } = await run({ env: actionEnv(wr()), api: new RestClient("t", { fetch: m.fetch }) });
    expect(exitCode).toBe(0);
    expect(report!.pr.number).toBe(42);
    expect(ids(report!)).toContain("touched_policy"); // the fork cannot switch it off
    // policy is read at the BASE sha only
    const contents = m.calls.filter((x) => x.path.includes("/contents/"));
    expect(contents.length).toBeGreaterThan(0);
    for (const x of contents) expect(x.path).toContain(`ref=${fx("pull.json").base.sha}`);
    expect(m.calls.some((x) => x.method === "POST" && x.path === `${R}/check-runs`)).toBe(true);
  });

  it("no matching PR: a notice, no writes", async () => {
    const m = mockFetch({ [`GET ${R}/commits/${HEAD}/pulls`]: [], [`GET ${R}/pulls`]: [] });
    const { report, exitCode } = await run({ env: actionEnv(wr()), api: new RestClient("t", { fetch: m.fetch }) });
    expect(exitCode).toBe(0);
    expect(report).toBeUndefined();
    expect(m.calls.every((x) => x.method === "GET")).toBe(true);
  });
});

describe("fork PR coverage is ignored", () => {
  const FORK = "mallory/widgets";
  const LCOV = (hits: number) => `TN:\nSF:src/price.ts\nDA:2,${hits}\nDA:3,${hits}\nDA:4,${hits}\nend_of_record\n`;
  function setup(hits: number, fork: boolean | "deleted") {
    const d = mkdtempSync(join(tmpdir(), "evidence-cov-"));
    writeFileSync(join(d, "lcov.info"), LCOV(hits));
    const out = join(d, "out.txt");
    writeFileSync(out, "");
    const ev = join(d, "event.json");
    writeFileSync(ev, JSON.stringify({ pull_request: { number: 42 } }));
    const env = {
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: ev,
      GITHUB_OUTPUT: out,
      GITHUB_WORKSPACE: d,
      "INPUT_COVERAGE-FILES": "lcov.info",
      "INPUT_LOCAL-DIFF": "false",
      INPUT_TOKEN: "t",
    };
    const r = routes({
      pull: (p) => {
        if (fork === "deleted") p.head.repo = null;
        else if (fork) p.head.repo = { full_name: FORK };
      },
      config: "evidence:\n  flags: { coverage_missing: warn }\n",
    });
    return { env, api: new RestClient("t", { fetch: mockFetch(r).fetch }) };
  }
  const covIds = (r: { flags: Array<{ id: string }> }) => r.flags.map((f) => f.id).filter((i) => i.startsWith("coverage_"));

  it("fork PR with a 100% coverage artifact: note, no pass, no flag", async () => {
    const { report } = await run(setup(1, true));
    expect(report!.coverage).toMatchObject({ present: false, unavailable: expect.stringMatching(/not available on fork PRs/) });
    expect(report!.coverage.pct).toBeUndefined();
    expect(covIds(report!)).toEqual([]); // neither coverage_below_threshold nor coverage_missing
    expect(renderCard(report!)).toMatch(/Changed-line coverage \| not available on fork PRs \(artifact comes from the fork's own CI\)/);
  });
  it("fork PR with a 0% artifact: same, no fail either", async () => {
    const { report } = await run(setup(0, true));
    expect(covIds(report!)).toEqual([]);
    expect(report!.coverage.unavailable).toBeTruthy();
  });
  it("deleted fork (head.repo null) fails closed: treated as a fork", async () => {
    const { report } = await run(setup(1, "deleted"));
    expect(report!.coverage.unavailable).toBeTruthy();
    expect(covIds(report!)).toEqual([]);
  });
  it("same-repo PR is unchanged: the report is read and flagged", async () => {
    const low = (await run(setup(0, false))).report!;
    expect(low.coverage).toMatchObject({ present: true, pct: 0 });
    expect(low.coverage.unavailable).toBeUndefined();
    expect(covIds(low)).toEqual(["coverage_below_threshold"]);
    const high = (await run(setup(1, false))).report!;
    expect(high.coverage).toMatchObject({ present: true, pct: 100 });
    expect(covIds(high)).toEqual([]);
    expect(renderCard(high)).toMatch(/100% \(3\/3 changed lines/);
  });
});

describe("CLI --format", () => {
  const fixture = join(ROOT, "examples/fixture-pr.json");
  const runCli = async (args: string[], isTTY: boolean) => {
    let out = "";
    let err = "";
    const code = await main(["pr", "--repo", "octo-org/widgets", "--pr", "42", "--fixture", fixture, ...args], { out: (s) => (out += s), err: (s) => (err += s), isTTY });
    return { code, out, err };
  };
  it("plain text in a terminal: no Markdown escapes, no table pipes, no HTML", async () => {
    const { code, out } = await runCli([], true);
    expect(code).toBe(1);
    expect(out).toMatch(/^Mainfast Evidence: FAIL/);
    expect(out).toContain("FAIL touched_workflows");
    expect(out).toContain("fix: ");
    expect(out).not.toMatch(/\\[_*[\]()#|]/);
    expect(out).not.toContain("| ");
    expect(out).not.toContain("<details>");
  });
  it("Markdown when piped, and on request", async () => {
    expect((await runCli([], false)).out).toMatch(/^### Mainfast Evidence: FAIL/);
    expect((await runCli(["--format", "markdown"], true)).out).toMatch(/^### /);
    expect((await runCli(["--format", "text"], false)).out).toMatch(/^Mainfast Evidence: /);
  });
  it("rejects an unknown format", async () => {
    expect((await runCli(["--format", "html"], true)).code).toBe(2);
  });
  it("renderText flattens hostile values to one line without control characters", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => runs.push(checkRun("e2e\nFAKE LINE‮", "skipped")) });
    const txt = renderText(report);
    expect(txt).not.toContain("‮");
    expect(txt.split("\n").some((l) => l.startsWith("FAKE LINE"))).toBe(false);
  });
});

describe("one-line fixes", () => {
  it("every flag has a fix, shown on the card and by `flags`", async () => {
    expect(Object.keys(FLAG_FIXES).sort()).toEqual([...FLAG_IDS].sort());
    expect(Object.keys(DEFAULT_FLAGS).sort()).toEqual([...FLAG_IDS].sort());
    const { report } = await runVariant({ checkRuns: (runs) => runs.push(checkRun("e2e", "skipped")) });
    expect(renderCard(report)).toContain("  - Fix: Make the test job run on this commit");
    let out = "";
    await main(["flags"], { out: (s) => (out += s), err: () => {} });
    expect(out).toMatch(/^tests_skipped\s+warn\s+Make the test job run/m);
  });
  it("the README flag table lists every flag with its default", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const id of FLAG_IDS) {
      const row = readme.split("\n").find((l) => l.startsWith(`| \`${id}\` |`));
      expect(row, id).toBeDefined();
      expect(row!.split("|")[2]!.trim(), id).toBe(DEFAULT_FLAGS[id]);
    }
  });
});
