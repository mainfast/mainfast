// GitHub Action entry point. Needs only GITHUB_TOKEN; no third-party action toolkit.
//
// pull_request: checks merge commits in base.sha..head.sha.
// push:         checks merge commits in before..after (new branch: <main>..after).
// Config: `.mainfast.yml` as committed at the base (PR base commit, or the main branch for
// a push), so a pull request cannot loosen its own check; `extends:` is applied (Pro).
// Reports via a check run when the token may create one (checks: write), and
// always via the job summary; falls back to workflow-command annotations.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { annotate, appendSummary, escapeData, escapeProp, getInput, setOutput } from "@mainfast/shared/actions-io";
import { GitHubError, type GitHub } from "@mainfast/shared/github";
import { planGate } from "@mainfast/shared/plan";
import { BRAND } from "./brand.ts";
import { exitCodeFor, repoRoot, resolveMainRef, runCheck } from "./check.ts";
import { LEVELS, type Config, type Level } from "./config.ts";
import { apiClient, loadConfigAtRev, loadWorkingTreeConfig } from "./extends.ts";
import { Git } from "./git.ts";
import { formatHuman, formatMarkdown, lineRef } from "./report.ts";
import type { CheckReport, Finding } from "./types.ts";

const ZERO = /^0+$/;

const input = (name: string, fallback = ""): string => getInput(name, fallback);

function log(s: string): void {
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}

interface Target {
  range?: string;
  headSha: string;
  skip?: string;
}

interface EventPayload {
  pull_request?: { base: { sha: string; ref: string }; head: { sha: string } };
  before?: string;
  after?: string;
  ref?: string;
  deleted?: boolean;
  repository?: { default_branch?: string; private?: boolean };
}

export function targetFor(event: string, payload: EventPayload, git: Git, mainRef?: string): Target {
  if (event === "pull_request" || event === "pull_request_target" || event === "merge_group") {
    const pr = payload.pull_request;
    if (!pr) return { headSha: process.env.GITHUB_SHA ?? "HEAD", skip: "event has no pull_request payload" };
    return { range: `${pr.base.sha}..${pr.head.sha}`, headSha: pr.head.sha };
  }
  if (event === "push") {
    const after = payload.after ?? process.env.GITHUB_SHA ?? "HEAD";
    if (payload.deleted || ZERO.test(after)) return { headSha: after, skip: "branch deleted" };
    const before = payload.before;
    if (before && !ZERO.test(before) && git.resolve(before)) return { range: `${before}..${after}`, headSha: after };
    if (mainRef) return { range: `${mainRef}..${after}`, headSha: after };
    return { headSha: after, skip: "new branch and the main branch is not fetched; use actions/checkout with fetch-depth: 0" };
  }
  const sha = process.env.GITHUB_SHA ?? "HEAD";
  return { range: mainRef ? `${mainRef}..${sha}` : undefined, headSha: sha, skip: mainRef ? undefined : `unsupported event ${event}` };
}

function ensureHistory(git: Git, defaultBranch?: string): void {
  const shallow = git.run(["rev-parse", "--is-shallow-repository"], { okStatus: [0, 128] }).stdout.trim();
  if (shallow === "true") {
    log("repository is shallow; fetching full history (set fetch-depth: 0 on actions/checkout to skip this)");
    git.run(["fetch", "--unshallow", "--no-tags", "--quiet", "origin"], { okStatus: [0, 1, 128] });
  }
  if (defaultBranch && !git.resolve(`origin/${defaultBranch}`)) {
    git.run(["fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`], { okStatus: [0, 1, 128] });
  }
}

const ANNOTATION_LEVEL: Record<Level, "failure" | "warning" | "notice" | undefined> = {
  error: "failure",
  warning: "warning",
  notice: "notice",
  off: undefined,
};

function allFindings(r: CheckReport): Finding[] {
  return r.merges.flatMap((m) => m.findings.map((f) => ({ ...f, message: `${m.merge.short}: ${f.message}` })));
}

function annotationFor(f: Finding) {
  const start = f.mergeLines?.start ?? 1;
  const end = Math.max(start, f.mergeLines?.end ?? start);
  const who = f.commit ? (f.kind === "evil" ? "" : ` Introduced by ${f.commit.short} "${f.commit.subject}" (${f.commit.author}).`) : "";
  return {
    path: f.path,
    start_line: start,
    end_line: end,
    annotation_level: ANNOTATION_LEVEL[f.level]!,
    title: `${BRAND.productName}: ${f.kind}${f.side ? ` (${f.side} side)` : ""}`,
    message: `${f.message}.${who}`,
    raw_details: [...(f.added ?? []).map((l) => `+ ${l}`), ...(f.removed ?? []).map((l) => `- ${l}`)].join("\n").slice(0, 60000) || undefined,
  };
}

/** Returns true when the check run was created. */
async function postCheckRun(gh: GitHub, repo: string, headSha: string, report: CheckReport, failed: boolean, notice?: string): Promise<boolean> {
  const findings = allFindings(report).filter((f) => ANNOTATION_LEVEL[f.level]);
  const annotations = findings.map(annotationFor);
  const s = report.summary;
  const title = failed
    ? `${s.findings.error} error, ${s.findings.warning} warning in ${s.withFindings} merge commit(s)`
    : `${s.merges} merge commit(s) intact`;
  const summary = (formatMarkdown(report) + (notice ? `\n\n${notice}\n` : "")).slice(0, 65000);
  const first = annotations.slice(0, 50);
  let created: { id: number; html_url?: string };
  try {
    created = (
      await gh.request<{ id: number; html_url?: string }>("POST", `/repos/${repo}/check-runs`, {
        name: BRAND.checkName,
        head_sha: headSha,
        status: "completed",
        conclusion: failed ? "failure" : s.findings.notice > 0 ? "neutral" : "success",
        output: { title, summary, annotations: first },
      })
    ).data;
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e;
    log(`could not create a check run (${e.status}); falling back to job summary and annotations. Grant "checks: write" to use check runs.`);
    return false;
  }
  for (let i = 50; i < annotations.length; i += 50) {
    await gh.request("PATCH", `/repos/${repo}/check-runs/${created.id}`, {
      output: { title, summary, annotations: annotations.slice(i, i + 50) },
    });
  }
  if (created.html_url) log(`check run: ${created.html_url}`);
  return true;
}

function workflowAnnotations(report: CheckReport): void {
  const cmd: Record<Level, string | undefined> = { error: "error", warning: "warning", notice: "notice", off: undefined };
  for (const f of allFindings(report)) {
    const c = cmd[f.level];
    if (!c) continue;
    const a = annotationFor(f);
    annotate(c as "error" | "warning" | "notice", a.message, { file: a.path, line: a.start_line, endLine: a.end_line, title: a.title });
  }
}

export async function runAction(): Promise<number> {
  const workspace = input("working-directory", process.env.GITHUB_WORKSPACE ?? process.cwd());
  const token = input("token", process.env.GITHUB_TOKEN ?? "");
  const failOnRaw = input("fail-on", "warning") as Level;
  const failOn: Level = LEVELS.includes(failOnRaw) ? failOnRaw : "warning";
  const useCheckRun = input("check-run", "auto");
  const event = process.env.GITHUB_EVENT_NAME ?? "push";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const payload: EventPayload = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};

  const git = new Git(workspace);
  const defaultBranch = input("main-branch", payload.repository?.default_branch ?? "");
  ensureHistory(git, defaultBranch || undefined);
  const main = resolveMainRef(git, defaultBranch || undefined);
  const target = targetFor(event, payload, git, main?.ref);
  if (target.skip) {
    log(`${BRAND.productName}: nothing to check (${target.skip})`);
    setOutput("status", "skipped");
    return 0;
  }

  const gh = apiClient(token, process.env.GITHUB_API_URL);
  let report: CheckReport;
  try {
    const config = await actionConfig(git, workspace, event, payload, main?.sha, apiClient(input("config-token") || token, process.env.GITHUB_API_URL));
    if (config.extendedFrom) log(`config: ${config.source} extends ${config.extendedFrom}`);
    report = runCheck({
      cwd: workspace,
      range: target.range,
      mainBranch: defaultBranch || undefined,
      config,
    });
  } catch (e) {
    log(`::error title=${escapeProp(BRAND.productName)}::${escapeData((e as Error).message)}`);
    setOutput("status", "error");
    return 1;
  }

  log(formatHuman(report));
  const code = exitCodeFor(report, failOn);
  const failed = code !== 0;
  const reportPath = join(process.env.RUNNER_TEMP ?? workspace, `${BRAND.cliName}-${BRAND.productSlug}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  setOutput("report", reportPath);
  setOutput("status", code === 0 ? "pass" : code === 1 ? "fail" : "error");
  setOutput("findings", String(report.summary.findings.error + report.summary.findings.warning + report.summary.findings.notice));

  appendSummary(formatMarkdown(report));

  // Plan notice for large private repositories (job summary + check run); never changes the result.
  const [owner = "", name = ""] = repo.split("/");
  const plan = repo ? await planGate({ gh, owner, repo: name, event: payload, productName: BRAND.productName }) : undefined;

  let posted = false;
  if (useCheckRun !== "false" && token && repo && report.merges.length > 0) {
    try {
      posted = await postCheckRun(gh, repo, target.headSha, report, failed, plan?.notice);
    } catch (e) {
      log(`check run failed: ${(e as Error).message}`);
    }
  }
  if (!posted) workflowAnnotations(report);
  return code === 0 ? 0 : 1;
}

/** `.mainfast.yml` from the base of the change; an explicit `config` input is read from the checkout. */
async function actionConfig(git: Git, workspace: string, event: string, payload: EventPayload, mainSha: string | undefined, gh: GitHub): Promise<Config> {
  const root = repoRoot(workspace);
  const explicit = input("config");
  if (explicit) return loadWorkingTreeConfig(git, root, join(workspace, explicit), gh);
  const baseSha = payload.pull_request?.base.sha ?? (event === "push" ? mainSha : undefined);
  if (baseSha && git.resolve(baseSha)) return loadConfigAtRev(git, root, baseSha, gh);
  return loadWorkingTreeConfig(git, root, undefined, gh);
}

// Set by the esbuild bundle for dist/action.cjs only, so importing this module never runs it.
declare const __ACTION_ENTRY__: boolean | undefined;
if (typeof __ACTION_ENTRY__ !== "undefined" && __ACTION_ENTRY__) {
  runAction().then(
    (code) => { process.exitCode = code; },
    (e) => {
      log(`::error::${escapeData(String((e as Error)?.stack ?? e))}`);
      process.exitCode = 1;
    },
  );
}
