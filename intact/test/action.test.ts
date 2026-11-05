import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOutputs } from "@mainfast/shared/actions-io";
import { mockFetch } from "@mainfast/shared/mockfetch";
import { resetPlanCache } from "@mainfast/shared/plan";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { runAction, targetFor } from "../src/action.ts";
import { Git } from "../src/git.ts";
import { cleanupAll, makeRepo, mergeInto, tenLines, type Repo } from "./helpers.ts";

afterAll(cleanupAll);

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function droppedFixRepo(): { repo: Repo; before: string; fix: string } {
  const repo = makeRepo();
  repo.write("config.txt", tenLines({ 5: "timeout = 10" }));
  repo.commit("base");
  repo.git("checkout", "-q", "-b", "feat");
  repo.write("config.txt", tenLines({ 5: "timeout = 10 # per tenant" }));
  const before = repo.commit("annotate");
  repo.git("checkout", "-q", "main");
  repo.write("config.txt", tenLines({ 5: "timeout = 30" }));
  const fix = repo.commit("Raise timeout to 30", "Ana Main");
  repo.git("checkout", "-q", "feat");
  mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"));
  return { repo, before, fix };
}

function actionEnv(repo: Repo, event: string, payload: unknown): { summary: string; output: string } {
  const tmp = mkdtempSync(join(tmpdir(), "mainfast-action-"));
  const eventPath = join(tmp, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  const summary = join(tmp, "summary.md");
  const output = join(tmp, "output.txt");
  writeFileSync(summary, "");
  writeFileSync(output, "");
  Object.assign(process.env, {
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: repo.dir,
    GITHUB_REPOSITORY: "acme/widgets",
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_OUTPUT: output,
    RUNNER_TEMP: tmp,
    GITHUB_API_URL: "https://api.github.test",
  });
  return { summary, output };
}

describe("targetFor", () => {
  it("derives ranges from pull_request and push payloads", () => {
    const { repo, before } = droppedFixRepo();
    const git = new Git(repo.dir);
    const head = repo.head();
    expect(targetFor("pull_request", { pull_request: { base: { sha: "b1", ref: "main" }, head: { sha: "h1" } } }, git))
      .toEqual({ range: "b1..h1", headSha: "h1" });
    expect(targetFor("push", { before, after: head }, git)).toEqual({ range: `${before}..${head}`, headSha: head });
    expect(targetFor("push", { before: "0".repeat(40), after: head }, git, "main")).toEqual({ range: `main..${head}`, headSha: head });
    expect(targetFor("push", { after: "0".repeat(40), deleted: true }, git).skip).toBe("branch deleted");
  });
});

describe("runAction", () => {
  it("falls back to job summary and annotations when no check run can be created", async () => {
    const { repo, before, fix } = droppedFixRepo();
    const { summary, output } = actionEnv(repo, "push", { before, after: repo.head(), repository: { default_branch: "main" } });
    process.env.INPUT_TOKEN = "";
    const logs: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { logs.push(String(s)); return true; });
    const code = await runAction();
    expect(code).toBe(1);
    const all = logs.join("");
    expect(all).toMatch(/::error file=config.txt,line=5,endLine=5,title=Mainfast Intact%3A dropped \(main side\)::/);
    expect(all).toContain(`Introduced by ${fix.slice(0, 7)} "Raise timeout to 30" (Ana Main)`);
    expect(readFileSync(summary, "utf8")).toContain("merge dropped or invented changes");
    expect(parseOutputs(readFileSync(output, "utf8")).status).toBe("fail");
  });

  it("posts a check run with annotations when the token allows it", async () => {
    const { repo, before } = droppedFixRepo();
    actionEnv(repo, "push", { before, after: repo.head(), repository: { default_branch: "main", private: false } });
    process.env.INPUT_TOKEN = "ghs_test";
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 7, html_url: "https://github.test/run/7" }), { status: 201 });
    });
    const logs: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { logs.push(String(s)); return true; });
    expect(await runAction()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.test/repos/acme/widgets/check-runs");
    const body = calls[0]!.body;
    expect(body.name).toBe("Mainfast Intact");
    expect(body.head_sha).toBe(repo.head());
    expect(body.conclusion).toBe("failure");
    expect(body.output.annotations).toHaveLength(1);
    expect(body.output.annotations[0]).toMatchObject({ path: "config.txt", start_line: 5, annotation_level: "failure" });
    expect(logs.join("")).not.toContain("::error");
  });

  it("passes a pull request whose merges are intact", async () => {
    const repo = makeRepo();
    repo.write("a.txt", "a\n");
    const base = repo.commit("base");
    repo.git("checkout", "-q", "-b", "feat");
    repo.write("b.txt", "b\n");
    repo.commit("feature");
    repo.git("checkout", "-q", "main");
    repo.write("a.txt", "a2\n");
    repo.commit("main moves");
    repo.git("checkout", "-q", "feat");
    mergeInto(repo, "main");
    const { output } = actionEnv(repo, "pull_request", { pull_request: { base: { sha: base, ref: "main" }, head: { sha: repo.head() } } });
    process.env.INPUT_TOKEN = "";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runAction()).toBe(0);
    expect(parseOutputs(readFileSync(output, "utf8")).status).toBe("pass");
  });
  it("adds the plan notice to the summary and check run of a large private repo, result unchanged", async () => {
    resetPlanCache();
    const { repo, before } = droppedFixRepo();
    const { summary } = actionEnv(repo, "push", { before, after: repo.head(), repository: { default_branch: "main", private: true } });
    process.env.INPUT_TOKEN = "ghs_test";
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    const fetch = mockFetch({
      "GET /repos/acme/widgets/pulls": { body: ["ana", "bo", "cy", "dee", "eli", "fay"].map((login) => ({ created_at: recent, user: { login, type: "User" } })) },
      "GET /repos/acme/widgets/activity": { body: [] },
      "POST /repos/acme/widgets/check-runs": { status: 201, body: { id: 9 } },
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runAction()).toBe(1); // same result as without the notice
    const post = fetch.calls.find((c) => c.method === "POST")!;
    expect(post.body.conclusion).toBe("failure");
    expect(post.body.output.summary).toContain("had 6 active contributors");
    expect(readFileSync(summary, "utf8")).toContain("$4 per active contributor per month");
  });
});
