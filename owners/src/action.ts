// GitHub Action entry.
//
// - pull_request / pull_request_target -> pr mode: changed files judged with the BASE branch's
//   CODEOWNERS; the PR's own CODEOWNERS linted separately when it edits one; one sticky comment.
// - schedule / workflow_dispatch / anything else -> audit mode: the default branch's CODEOWNERS
//   against the whole tree, every owner, and dormancy (default 180 days).
//
// Everything is read through the API at the right ref, never from a checkout: `.mainfast.yml`
// and CODEOWNERS from the base branch (PR) or the default branch (audit), the PR's CODEOWNERS
// and tree from its head commit. A PR cannot loosen its own check, and no checkout step is needed
// (which also makes `pull_request_target` safe: no PR code is ever fetched or run).
import { readFileSync } from 'node:fs';
import { OwnersApi } from './api.js';
import { auditOwners } from './audit.js';
import { PRODUCT, USER_AGENT } from './brand.js';
import { level, parseConfig, reaches, wholeNumber } from './config.js';
import { isTrustedPr, loadAudit, loadConfigFromRepo, loadPr } from './load.js';
import { publishComment } from './publish.js';
import { annotationText, toMarkdown } from './report.js';
import { annotate, appendSummary, getBooleanInput, getInput, readContext, setFailed, setOutput } from '@mainfast/shared/actions-io';
import { GitHub, GitHubError, resolveCommentAuthor, splitRepo } from '@mainfast/shared/github';
import { plainText } from '@mainfast/shared/markdown';
import { planGate } from '@mainfast/shared/plan';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const isAccessError = (e: unknown) => e instanceof GitHubError && [403, 404, 410].includes(e.status);

export async function run(): Promise<void> {
  const ctx = readContext();
  const { owner, repo } = splitRepo(ctx.repository);
  const gh = new GitHub({ token: getInput('token'), userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
  const orgToken = getInput('org-token');
  const org = orgToken ? new GitHub({ token: orgToken, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL }) : undefined;

  let mode = getInput('mode', 'auto');
  if (!['auto', 'pr', 'audit'].includes(mode)) throw new Error(`input mode: expected auto, pr or audit, got "${mode}"`);
  if (mode === 'auto') mode = ctx.eventName.startsWith('pull_request') ? 'pr' : 'audit';
  const pull = ctx.event.pull_request as
    | { number?: number; author_association?: string; base?: { ref?: string; sha?: string; repo?: { full_name?: string } }; head?: { sha?: string; repo?: { full_name?: string } } }
    | undefined;
  if (mode === 'pr' && !pull?.number) throw new Error('pr mode needs a pull_request or pull_request_target event');

  const defaultBranch: string = ctx.event.repository?.default_branch ?? (await gh.get<{ default_branch: string }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)).default_branch;
  // The base branch as it is now: what GitHub uses to request reviews, and a policy the PR cannot edit.
  const baseRef = mode === 'pr' ? (pull!.base?.ref ?? pull!.base?.sha ?? defaultBranch) : getInput('ref') || defaultBranch;
  const cfgPath = getInput('config');
  const { cfg, source } = cfgPath ? { cfg: parseConfig(readFileSync(cfgPath, 'utf8')), source: cfgPath } : await loadConfigFromRepo(gh, owner, repo, baseRef);
  const dormant = getInput('dormant-days');
  if (dormant) cfg.dormantDays = wholeNumber('input dormant-days', dormant, 0, 3650);
  const failOn = level('fail-on', getInput('fail-on') || cfg.failOn);
  console.log(`${PRODUCT}: ${mode} mode on ${owner}/${repo} ${mode === 'pr' ? `#${pull!.number} (base ${baseRef})` : baseRef}; config: ${source}`);

  const api = new OwnersApi(gh, owner, repo, { org, ownerType: ctx.event.repository?.owner?.type, maxSearches: cfg.maxSearches });
  const loaded =
    mode === 'pr'
      ? await loadPr(api, { number: pull!.number!, baseRef, headSha: pull!.head?.sha ?? `refs/pull/${pull!.number}/head`, trusted: isTrustedPr(pull) })
      : await loadAudit(api, baseRef);
  const report = await auditOwners({ repository: `${owner}/${repo}`, ...loaded, api, config: cfg });

  const md = toMarkdown(report, { runUrl: ctx.runUrl });
  appendSummary(md);
  console.log(md);
  for (const f of report.findings) {
    const file = f.line !== undefined ? (f.scope === 'proposed' ? report.proposed?.path : report.codeownersPath) : undefined;
    annotate(f.severity, annotationText(f), { file, line: file ? f.line : undefined, title: `${PRODUCT}: ${f.code}` });
  }
  setOutput('ok', String(report.ok));
  setOutput('unowned', report.unowned.join('\n'));
  setOutput('report', JSON.stringify(report));

  if (mode === 'pr' && getBooleanInput('comment', true)) {
    try {
      const author = await resolveCommentAuthor(gh, getInput('comment-author') || undefined);
      const res = await publishComment(gh, owner, repo, report, author);
      if (res !== 'none') console.log(`${PRODUCT}: PR comment ${res}`);
    } catch (e) {
      if (isAccessError(e))
        annotate('warning', plainText(`${PRODUCT}: could not comment on the PR (${(e as GitHubError).status}); needs pull-requests: write (fork PRs get a read-only token)`, 1000, true));
      else throw e;
    }
  }
  // Plan notice for large private repositories; never changes the result (see @mainfast/shared/plan).
  await planGate({ gh, owner, repo, event: ctx.event, productName: PRODUCT });
  if (reaches(report.findings, failOn)) setFailed(`${PRODUCT}: ${plural(report.findings.filter((f) => f.severity === 'error').length, "error")}, ${plural(report.findings.filter((f) => f.severity === 'warning').length, "warning")}`);
}

if (!process.env.VITEST) run().catch((e) => setFailed(plainText(e instanceof Error ? e.message : String(e), 4000)));
