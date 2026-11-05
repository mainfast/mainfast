// GitHub Action entry point. No @actions/* dependency: inputs come from INPUT_* env vars and
// outputs go to $GITHUB_OUTPUT, which is all the runner contract requires.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { escapeData, getInput, setOutput as writeOutput } from "@mainfast/shared/actions-io";
import { planGate } from "@mainfast/shared/plan";
import { join } from "node:path";
import { evaluateChecks } from "./analyze/checks.ts";
import { FORK_COVERAGE_NOTE } from "./analyze/coverage.ts";
import { parsePolicy } from "./config.ts";
import { evaluate, type EvidenceReport } from "./evaluate.ts";
import { GitHubError, RestClient, type GitHubApi, type RawPull } from "./github/api.ts";
import { collectSnapshot, fetchChecks, fetchPolicyText } from "./github/collect.ts";
import { publish } from "./github/publish.ts";
import { resolveWorkflowRunPr, type WorkflowRunPayload } from "./github/resolve.ts";
import { enrichFromLocal, loadCoverage } from "./local.ts";
import { PRODUCT_NAME } from "./constants.ts";
import { renderCard } from "./render.ts";

export interface ActionEnv {
  [k: string]: string | undefined;
}

export function input(env: ActionEnv, name: string, fallback = ""): string {
  return getInput(name, fallback, env);
}

function log(kind: "notice" | "warning" | "error" | "info", msg: string): void {
  if (kind === "info") console.log(msg);
  else console.log(`::${kind}::${escapeData(msg)}`);
}

function setOutput(env: ActionEnv, name: string, value: string): void {
  writeOutput(name, value, env);
}

/** Pick the PR number from the triggering event. */
export function prNumberFromEvent(eventName: string, event: Record<string, unknown>): number | undefined {
  const e = event as {
    pull_request?: { number?: number };
    workflow_run?: { pull_requests?: Array<{ number: number }> };
    check_suite?: { pull_requests?: Array<{ number: number }> };
    check_run?: { pull_requests?: Array<{ number: number }> };
    issue?: { number?: number; pull_request?: unknown };
    number?: number;
  };
  if (e.pull_request?.number) return e.pull_request.number;
  if (eventName === "workflow_run") return e.workflow_run?.pull_requests?.[0]?.number;
  if (eventName === "check_suite") return e.check_suite?.pull_requests?.[0]?.number;
  if (eventName === "check_run") return e.check_run?.pull_requests?.[0]?.number;
  if (e.issue?.pull_request && e.issue.number) return e.issue.number;
  return undefined;
}

export interface RunDeps {
  env: ActionEnv;
  api?: GitHubApi;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function run(deps: RunDeps): Promise<{ report?: EvidenceReport; exitCode: number }> {
  const { env } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const repoFull = input(env, "repository", env.GITHUB_REPOSITORY ?? "");
  const token = input(env, "token", env.GITHUB_TOKEN ?? "");
  const api = deps.api ?? new RestClient(token, { baseUrl: env.GITHUB_API_URL });
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  let event: Record<string, unknown> = {};
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    log("warning", "Could not read the event payload");
  }
  const [owner, repo] = repoFull.split("/") as [string, string];
  let prNumber = Number(input(env, "pr-number")) || undefined;
  let pull: RawPull | undefined;
  if (!prNumber && eventName === "workflow_run" && repoFull) {
    // Fork PRs are not in workflow_run.pull_requests: find the PR by head sha and check it against
    // GitHub's PR record. Only the base repository's policy and the API are read; nothing from the
    // fork is checked out or run by this Action.
    const found = await resolveWorkflowRunPr(api, owner, repo, (event.workflow_run ?? {}) as WorkflowRunPayload);
    if (found?.note) {
      log("notice", found.note);
      return { exitCode: 0 };
    }
    if (found) {
      prNumber = found.number;
      pull = found.pull;
      log("info", `workflow_run: PR #${found.number}${found.fork ? " (from a fork)" : ""}, found via ${found.via}.`);
    }
  } else if (!prNumber) prNumber = prNumberFromEvent(eventName, event);
  if (!repoFull || !prNumber) {
    log("notice", `No pull request for event "${eventName}"; nothing to evaluate.`);
    return { exitCode: 0 };
  }
  pull ??= await api.getPull(owner, repo, prNumber);

  // Policy comes from the base commit: a PR must not be able to loosen its own gate.
  const loaded = parsePolicy(await fetchPolicyText(api, owner, repo, pull.base.sha));
  const policy = loaded.policy;
  const workspace = input(env, "working-directory", env.GITHUB_WORKSPACE ?? process.cwd());

  let snap = await collectSnapshot(api, repoFull, prNumber, policy, { pull });

  // Optionally wait for test checks on this head to appear and finish.
  const waitS = Number(input(env, "wait-for-checks", "0")) || 0;
  const pollS = Math.max(5, Number(input(env, "poll-interval", "20")) || 20);
  const deadline = now() + waitS * 1000;
  while (waitS > 0) {
    const ce = evaluateChecks(snap, policy);
    if (ce.testsState !== "none" && !ce.pending) break;
    if (now() >= deadline) break;
    log("info", `Waiting for checks on ${snap.pr.headSha.slice(0, 7)} (tests: ${ce.testsState})…`);
    await sleep(pollS * 1000);
    snap = { ...snap, headChecks: await fetchChecks(api, owner, repo, snap.pr.headSha) };
  }

  // A fork PR's coverage report comes from the fork's own CI artifact and can claim anything:
  // it is never read. The card says so instead of showing a figure or a coverage flag.
  // Fail closed: a missing head repo (deleted fork) counts as a fork, not as this repo.
  const fromFork = !pull.head.repo?.full_name || pull.head.repo.full_name.toLowerCase() !== repoFull.toLowerCase();
  const coverageFiles = fromFork ? [] : [...policy.coverage.files, ...input(env, "coverage-files").split(/[\n,]/).map((s) => s.trim()).filter(Boolean)];
  if (fromFork) {
    snap = { ...snap, coverage: undefined, coverageUnavailable: FORK_COVERAGE_NOTE };
    log("info", `Fork PR: coverage ${FORK_COVERAGE_NOTE}; ignored.`);
  } else if (coverageFiles.length) {
    const { report, missing } = loadCoverage(coverageFiles, workspace);
    if (missing.length) log("warning", `Coverage file(s) not found: ${missing.join(", ")}`);
    snap = { ...snap, coverage: report };
  }
  // A fork PR's diff comes from the API only: no local diff, no git-ai notes from the checkout.
  // (Reading git objects runs no fork code, but a fork PR needs nothing from the workspace.)
  const localDiff = input(env, "local-diff", "auto");
  if (fromFork && localDiff !== "false") log("info", "Fork PR: diff from the API; the local checkout is not used for the diff or git-ai notes.");
  if (localDiff !== "false" && !fromFork) {
    const enriched = enrichFromLocal(snap, workspace);
    if (enriched.used) log("info", "Using the local checkout for the diff and git-ai notes.");
    snap = enriched.snap;
  }

  const report = evaluate(snap, policy, loaded.warnings);
  for (const w of loaded.warnings) log("warning", w);
  for (const f of report.flags) log(f.severity === "fail" ? "error" : "warning", `${f.title}: ${f.detail.split("\n")[0]}`);

  const comment = input(env, "comment", "always") as "always" | "on-flags" | "never";
  let published = false;
  if (input(env, "dry-run", "false") !== "true") {
    try {
      const res = await publish(api, report, { comment, commentAuthor: input(env, "comment-author") || undefined });
      published = true;
      setOutput(env, "check-run-url", res.checkRunUrl ?? "");
      setOutput(env, "comment-url", res.commentUrl ?? "");
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
        log(
          "warning",
          `Could not post the check run or comment (${err.message}). Needs checks: write and pull-requests: write; fork PRs on pull_request get a read-only token (run Evidence on workflow_run for them; see the README).`,
        );
      } else throw err;
    }
  }

  setOutput(env, "conclusion", report.conclusion);
  setOutput(env, "is-agent", String(report.provenance.isAgent));
  setOutput(env, "agents", report.provenance.agents.join(", "));
  setOutput(env, "flags", report.flags.map((f) => f.id).join(","));
  if (env.RUNNER_TEMP) {
    const p = join(env.RUNNER_TEMP, "mainfast-evidence.json");
    writeFileSync(p, JSON.stringify(report, (_k, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
    setOutput(env, "report-path", p);
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderCard(report, { marker: false })}\n`);

  // Plan notice for large private repositories; never changes the result (see @mainfast/shared/plan).
  if (api instanceof RestClient) await planGate({ gh: api.gh, owner, repo, event: event as { repository?: { private?: boolean } }, productName: PRODUCT_NAME, env });

  const failJob = input(env, "fail-job", "auto");
  const shouldFail = report.conclusion === "failure" && (failJob === "true" || (failJob === "auto" && !published));
  return { report, exitCode: shouldFail ? 1 : 0 };
}

// Run when executed as the bundled action (not when imported by tests).
const isMain = typeof require !== "undefined" && require.main === module;
if (isMain) {
  run({ env: process.env }).then(
    ({ exitCode }) => process.exit(exitCode),
    (err: unknown) => {
      log("error", err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    },
  );
}
