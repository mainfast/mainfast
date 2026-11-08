// Reports the audit as a completed check run (checks: write) and keeps ONE tracking issue
// (issues: write) open while the audit finds something at the `issueOn` level, closing it once
// the audit is clean. The issue is found again by its marker AND its author: only an issue that
// starts with the marker and was opened by the token's own identity is ever edited or closed,
// so a marker pasted into someone else's issue is ignored.
import { findSticky, type GitHub } from '@mainfast/shared/github';
import { mdCode, plainText, safeUrl } from '@mainfast/shared/markdown';
import { CHECK_NAME, ISSUE_MARKER, PRODUCT } from './brand.js';
import { reaches, type Level } from './config.js';
import { codeBlock, title, toMarkdown } from './report.js';
import type { AuditReport } from './types.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export function conclusionOf(report: AuditReport, failOn: Level): 'failure' | 'neutral' | 'success' {
  return reaches(report.findings, failOn) ? 'failure' : report.findings.length ? 'neutral' : 'success';
}

export async function createCheckRun(
  gh: GitHub,
  owner: string,
  repo: string,
  headSha: string,
  report: AuditReport,
  failOn: Level,
  detailsUrl?: string,
): Promise<number> {
  const json = JSON.stringify({ findings: report.findings, tallies: report.tallies }, null, 2);
  const res = await gh.request<{ id: number }>('POST', `${repoPath(owner, repo)}/check-runs`, {
    name: CHECK_NAME,
    head_sha: headSha,
    status: 'completed',
    conclusion: conclusionOf(report, failOn),
    details_url: safeUrl(detailsUrl),
    output: {
      title: title(report),
      summary: toMarkdown(report, { runUrl: detailsUrl }),
      text: codeBlock(json.length > 60000 ? `${json.slice(0, 60000)}\n…truncated` : json, 'json'),
    },
  });
  return res.data.id;
}

interface IssueItem {
  id: number;
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  html_url?: string;
  user?: { login?: string | null } | null;
  pull_request?: unknown;
}

export interface IssueOptions {
  gh: GitHub;
  owner: string;
  repo: string;
  report: AuditReport;
  issueOn: Level;
  /** Login the token posts as (resolveCommentAuthor); only an issue opened by it is touched. */
  author: string;
}

export interface IssueResult {
  action: 'created' | 'updated' | 'unchanged' | 'closed' | 'none';
  number?: number;
  url?: string;
}

export function issueTitle(report: AuditReport): string {
  return plainText(`${PRODUCT}: required checks do not protect ${report.branch}`, 200, true);
}

export function issueBody(report: AuditReport): string {
  return [
    ISSUE_MARKER,
    `This issue is kept up to date by the scheduled ${PRODUCT} audit and closed automatically once the required checks on ${mdCode(report.branch)} protect it again. Edits to this text are overwritten.`,
    '',
    toMarkdown(report, { heading: '##' }),
  ].join('\n');
}

/** The open tracking issue, if any: starts with the marker and was opened by `author`. */
export async function findTrackingIssue(gh: GitHub, owner: string, repo: string, author: string): Promise<IssueItem | undefined> {
  const issues = await gh.paginate<IssueItem>(`${repoPath(owner, repo)}/issues?state=open&sort=created&direction=asc&per_page=100`);
  return findSticky(
    issues.filter((i) => !i.pull_request),
    ISSUE_MARKER,
    author,
  );
}

export async function syncTrackingIssue(o: IssueOptions): Promise<IssueResult> {
  const { gh, owner, repo, report } = o;
  const base = repoPath(owner, repo);
  const wrong = reaches(report.findings, o.issueOn);
  const mine = await findTrackingIssue(gh, owner, repo, o.author);
  if (wrong) {
    const body = issueBody(report);
    const t = issueTitle(report);
    if (!mine) {
      const res = await gh.request<IssueItem>('POST', `${base}/issues`, { title: t, body });
      return { action: 'created', number: res.data.number, url: res.data.html_url };
    }
    // No run link in the body, so a re-run with the same result leaves the issue alone.
    if (mine.body === body && mine.title === t) return { action: 'unchanged', number: mine.number, url: mine.html_url };
    await gh.request('PATCH', `${base}/issues/${mine.number}`, { title: t, body });
    return { action: 'updated', number: mine.number, url: mine.html_url };
  }
  if (!mine) return { action: 'none' };
  const summary = report.findings.length ? `${plural(report.findings.length, "finding")} remain below the \`issueOn\` level; see the ${PRODUCT} check run.` : 'Every required check reports as intended.';
  await gh.request('PATCH', `${base}/issues/${mine.number}`, {
    body: [ISSUE_MARKER, `Resolved by the ${PRODUCT} audit of ${mdCode(report.branch)} on ${report.collectedAt.slice(0, 10)}: ${summary}`].join('\n'),
    state: 'closed',
    state_reason: 'completed',
  });
  return { action: 'closed', number: mine.number, url: mine.html_url };
}
