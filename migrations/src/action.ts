// GitHub Action entry. pull_request -> check this PR against current main;
// push to main -> re-check every open PR, comment/label the stale ones and set the
// blocking commit status (on by default) on every head.
import { readFileSync } from 'node:fs';
import { PRODUCT, USER_AGENT } from './brand.js';
import { parseConfig } from './config.js';
import { analyze, loadConfigFromRef } from './engine.js';
import { git, Tree } from './git.js';
import { publish } from './publish.js';
import { MAIN_REF, prRef, recheckMarkdown, recheckOpenPrs } from './recheck.js';
import { toMarkdown } from './report.js';
import { annotate, appendSummary, getBooleanInput, getInput, readContext, setFailed, setOutput } from '@mainfast/shared/actions-io';
import { GitHub, GitHubError, resolveCommentAuthor, splitRepo } from '@mainfast/shared/github';
import { planGate } from '@mainfast/shared/plan';

export async function run(): Promise<void> {
  const ctx = readContext();
  const { owner, repo } = splitRepo(ctx.repository);
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const token = getInput('token');
  const gh = new GitHub({ token, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
  const mainBranch = getInput('main-branch', ctx.event.repository?.default_branch ?? 'main');
  const configPath = getInput('config');
  const config = configPath ? parseConfig(readFileSync(configPath, 'utf8')) : undefined;
  const comment = getBooleanInput('comment', true);
  const commentAuthor = getInput('comment-author') || undefined;
  // On by default: the commit status is what blocks a merge once branch protection requires it.
  const status = getBooleanInput('status', true);
  const failOn = getInput('fail-on', 'error');
  let mode = getInput('mode', 'auto');
  if (mode === 'auto') mode = ctx.eventName.startsWith('pull_request') ? 'check' : ctx.eventName === 'push' ? 'recheck-open-prs' : 'check';

  if (mode === 'recheck-open-prs') {
    if (ctx.eventName === 'push' && ctx.event.ref && ctx.event.ref !== `refs/heads/${mainBranch}`) {
      console.log(`${PRODUCT}: push to ${ctx.event.ref}, not ${mainBranch}; nothing to re-check.`);
      return;
    }
    const entries = await recheckOpenPrs({
      repoDir: workspace,
      gh,
      owner,
      repo,
      mainBranch,
      comment,
      status,
      label: getInput('label') || undefined,
      maxPrs: Number(getInput('max-prs', '50')),
      config,
      targetUrl: ctx.runUrl,
      commentAuthor,
    });
    const md = recheckMarkdown(entries, mainBranch);
    appendSummary(md);
    console.log(md);
    setOutput('stale-prs', entries.filter((e) => e.stale).map((e) => e.number).join(','));
    setOutput('report', JSON.stringify(entries.map(({ report, ...rest }) => ({ ...rest, findings: report?.findings ?? [] }))));
    for (const e of entries) if (e.error) annotate('warning', `#${e.number}: ${e.error}`);
    // Plan notice for large private repositories; never changes the result (see @mainfast/shared/plan).
    await planGate({ gh, owner, repo, event: ctx.event, productName: PRODUCT });
    return;
  }

  if (mode !== 'check') throw new Error(`unknown mode "${mode}" (auto, check, recheck-open-prs)`);
  const pr = ctx.event.pull_request;
  if (!pr) throw new Error('check mode needs a pull_request event');
  const base = pr.base?.ref ?? mainBranch;
  git(workspace, ['fetch', '--no-tags', '--quiet', 'origin', `+refs/heads/${base}:${MAIN_REF}`, `+refs/pull/${pr.number}/head:${prRef(pr.number)}`]);
  // Policy comes from the base branch as it is now, never from the PR head (or an explicit `config:` file).
  const policy = config ?? loadConfigFromRef(Tree.atRef(workspace, MAIN_REF));
  const report = analyze({ repo: workspace, mainRef: MAIN_REF, headRef: prRef(pr.number), config: policy });
  report.main.ref = base;
  report.head.ref = pr.head?.ref ?? `#${pr.number}`;
  const md = toMarkdown(report);
  appendSummary(md);
  console.log(md);
  for (const f of report.findings) annotate(f.severity, `${f.message}${f.hint ? ` Fix: ${f.hint}` : ''}`, f.files[0], `${PRODUCT}: ${f.framework} ${f.code}`);
  setOutput('ok', String(report.ok));
  setOutput('report', JSON.stringify(report));

  if (comment || status) {
    try {
      await publish(report, {
        gh,
        owner,
        repo,
        pr: pr.number,
        currentLabels: (pr.labels ?? []).map((l: { name: string }) => l.name),
        label: getInput('label') || policy.label,
        comment,
        status,
        targetUrl: ctx.runUrl,
        commentAuthor: comment ? await resolveCommentAuthor(gh, commentAuthor) : undefined,
      });
    } catch (e) {
      // pull_request from a fork gets a read-only token; the job summary and annotations still carry the result
      if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) annotate('warning', `could not comment, label or set the commit status on the PR (${e.status}); token is read-only (fork PR) or lacks pull-requests/issues/statuses write?`);
      else throw e;
    }
  }
  // Plan notice for large private repositories; never changes the result (see @mainfast/shared/plan).
  await planGate({ gh, owner, repo, event: ctx.event, productName: PRODUCT });
  const hasWarnings = report.findings.length > 0;
  if (failOn === 'error' ? !report.ok : failOn === 'warning' ? hasWarnings : false)
    setFailed(`${PRODUCT}: merging this PR would break a migration ledger`);
}

if (!process.env.VITEST) {
  run().catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
}
