// GitHub Action entry: a weekly schedule, workflow_dispatch, pushes to the audited branch that
// touch .github/workflows or .mainfast.yml, and branch_protection_rule (classic protection
// changed). Writes the job summary, outputs JSON, posts a check run on the audited branch's
// head and keeps one tracking issue open while something is wrong.
//
// Policy and workflow files are read through the API from the repository itself (config from
// the default branch, workflows from the audited branch), never from the checkout: a
// workflow_dispatch run on a feature branch audits the same thing as the scheduled run.
import { readFileSync } from 'node:fs';
import { CONFIG_FILE, CONFIG_FILE_ALT, PRODUCT, USER_AGENT } from './brand.js';
import { audit } from './audit.js';
import { collect } from './collect.js';
import { configFromDoc, level, parseConfig, reaches, type RollcallConfig } from './config.js';
import { conclusionOf, createCheckRun, syncTrackingIssue } from './publish.js';
import { annotationText, toMarkdown } from './report.js';
import { annotate, appendSummary, getBooleanInput, getInput, readContext, setFailed, setOutput } from '@mainfast/shared/actions-io';
import { resolveConfig } from '@mainfast/shared/config';
import { GitHub, GitHubError, resolveCommentAuthor, splitRepo } from '@mainfast/shared/github';
import { planGate } from '@mainfast/shared/plan';

/** `.mainfast.yml` (or `.mainfast.yaml`) from the default branch, with `extends:` applied. */
export async function loadConfigFromRepo(gh: GitHub, owner: string, repo: string, ref: string): Promise<{ cfg: RollcallConfig; source: string }> {
  let file = CONFIG_FILE;
  let text = await gh.getFileText(owner, repo, CONFIG_FILE, ref);
  if (text === undefined) {
    file = CONFIG_FILE_ALT;
    text = await gh.getFileText(owner, repo, CONFIG_FILE_ALT, ref);
  }
  if (text === undefined) return { cfg: parseConfig(undefined), source: `defaults (no ${CONFIG_FILE} on ${ref})` };
  const resolved = await resolveConfig(text, {
    repoFile: (o, r, path, at) => gh.getFileText(o, r, path, at),
    localFile: (path) => gh.getFileText(owner, repo, path, ref),
  });
  return { cfg: configFromDoc(resolved.doc), source: `${file} on ${ref}${resolved.extendedFrom ? ` (extends ${resolved.extendedFrom})` : ''}` };
}

function count(name: string, v: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`input ${name}: expected ${min}..${max}, got "${v}"`);
  return n;
}

const isAccessError = (e: unknown) => e instanceof GitHubError && [403, 404, 410].includes(e.status);

export async function run(): Promise<void> {
  const ctx = readContext();
  const { owner, repo } = splitRepo(getInput('repository', ctx.repository));
  const sameRepo = `${owner}/${repo}`.toLowerCase() === ctx.repository.toLowerCase();
  const gh = new GitHub({ token: getInput('token'), userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
  const defaultBranch: string =
    (sameRepo ? ctx.event.repository?.default_branch : undefined) ??
    (await gh.get<{ default_branch: string }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)).default_branch;

  const cfgPath = getInput('config');
  const { cfg, source } = cfgPath
    ? { cfg: parseConfig(readFileSync(cfgPath, 'utf8')), source: cfgPath }
    : await loadConfigFromRepo(gh, owner, repo, defaultBranch);
  const branch = getInput('branch') || cfg.branch || defaultBranch;
  console.log(`${PRODUCT}: auditing ${owner}/${repo} ${branch}; config: ${source}`);

  if (sameRepo && ctx.eventName === 'push' && ctx.event.ref && ctx.event.ref !== `refs/heads/${branch}`) {
    console.log(`${PRODUCT}: push to ${ctx.event.ref}, not ${branch}; nothing to audit.`);
    return;
  }
  const failOn = level('fail-on', getInput('fail-on') || cfg.failOn);
  const issueOn = level('issue-on', getInput('issue-on') || cfg.issueOn);
  const pulls = count('pulls', getInput('pulls', String(cfg.pulls)), 1, 100);
  const openPulls = count('open-pulls', getInput('open-pulls', String(cfg.openPulls)), 0, 100);

  const snap = await collect({ gh, owner, repo, branch, defaultBranch, pulls, openPulls });
  const report = audit(snap, { ignore: cfg.ignore, stoppedAfter: cfg.stoppedAfter });
  const md = toMarkdown(report, { runUrl: ctx.runUrl });
  appendSummary(md);
  console.log(md);
  for (const f of report.findings) annotate(f.severity, annotationText(f), undefined, `${PRODUCT}: ${f.code}`);
  setOutput('ok', String(report.ok));
  setOutput('conclusion', conclusionOf(report, failOn));
  setOutput('report', JSON.stringify(report));

  // The check run goes on the audited branch's head (GITHUB_SHA only when that is unknown).
  const sha = snap.headSha ?? (sameRepo ? process.env.GITHUB_SHA : undefined);
  if (getBooleanInput('check-run', true) && sha) {
    try {
      await createCheckRun(gh, owner, repo, sha, report, failOn, ctx.runUrl);
    } catch (e) {
      if (isAccessError(e)) annotate('warning', `${PRODUCT}: could not create the check run (${(e as GitHubError).status}; needs checks: write)`);
      else throw e;
    }
  }

  if (getBooleanInput('issue', true)) {
    try {
      const author = await resolveCommentAuthor(gh, getInput('comment-author') || undefined);
      const res = await syncTrackingIssue({ gh, owner, repo, report, issueOn, author });
      if (res.number) setOutput('issue', String(res.number));
      if (res.action !== 'none') console.log(`${PRODUCT}: tracking issue #${res.number} ${res.action}`);
    } catch (e) {
      if (isAccessError(e)) annotate('warning', `${PRODUCT}: could not read or write the tracking issue (${(e as GitHubError).status}; needs issues: write, and issues enabled)`);
      else throw e;
    }
  }

  // Plan notice for large private repositories; never changes the result (see @mainfast/shared/plan).
  await planGate({ gh, owner, repo, event: sameRepo ? ctx.event : {}, productName: PRODUCT });
  if (reaches(report.findings, failOn)) setFailed(`${PRODUCT}: required checks do not protect ${report.branch} as configured`);
}

if (!process.env.VITEST) run().catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
