// Turns a report into PR feedback: one marker comment, a stale label and the
// commit status (on by default; the status is what blocks a merge once required). Works with the plain GITHUB_TOKEN (pull-requests: write,
// issues: write, statuses: write).
import { COMMENT_MARKER, PRODUCT, STATUS_CONTEXT } from './brand.js';
import type { MigrationsReport } from './engine.js';
import { toMarkdown } from './report.js';
import { findOwnComment, GitHub, GitHubError, resolveCommentAuthor, upsertSticky } from '@mainfast/shared/github';
import { mdCode } from '@mainfast/shared/markdown';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface PublishOptions {
  gh: GitHub;
  owner: string;
  repo: string;
  pr: number;
  /** Labels the PR already has, when known (saves a request). */
  currentLabels?: string[];
  label: string;
  comment: boolean;
  status: boolean;
  targetUrl?: string;
  /** Extra line at the top of the comment, e.g. which main commit triggered the recheck. Trusted Markdown: escape any untrusted part. */
  preface?: string;
  /**
   * Login the token posts as; only a marker comment by this login is ever updated. Default:
   * `GET /user`, else github-actions[bot] (see resolveCommentAuthor).
   */
  commentAuthor?: string;
}

export interface PublishResult {
  comment: 'created' | 'updated' | 'unchanged' | 'resolved' | 'none';
  label: 'added' | 'removed' | 'kept' | 'none';
  status?: 'success' | 'failure';
}

export async function publish(report: MigrationsReport, o: PublishOptions): Promise<PublishResult> {
  const stale = !report.ok;
  const base = `/repos/${o.owner}/${o.repo}`;
  const result: PublishResult = { comment: 'none', label: 'none' };

  if (o.comment) {
    const author = o.commentAuthor ?? (await resolveCommentAuthor(o.gh));
    if (stale) {
      const body = [o.preface, toMarkdown(report)].filter(Boolean).join('\n\n');
      result.comment = await upsertSticky(o.gh, o.owner, o.repo, o.pr, COMMENT_MARKER, body, author);
    } else {
      const existing = await findOwnComment(o.gh, o.owner, o.repo, o.pr, COMMENT_MARKER, author);
      if (existing && !existing.body?.includes('Resolved:')) {
        await o.gh.request('PATCH', `${base}/issues/comments/${existing.id}`, {
          body: `${COMMENT_MARKER}\n### ${PRODUCT}\n\nResolved: migrations are consistent with ${mdCode(report.main.ref)} at ${report.main.sha.slice(0, 7)}.`,
        });
        result.comment = 'resolved';
      }
    }
  }

  const labels = o.currentLabels ?? (await o.gh.paginate<{ name: string }>(`${base}/issues/${o.pr}/labels?per_page=100`)).map((l) => l.name);
  const has = labels.includes(o.label);
  if (stale && !has) {
    await o.gh.request('POST', `${base}/issues/${o.pr}/labels`, { labels: [o.label] });
    result.label = 'added';
  } else if (!stale && has) {
    try {
      await o.gh.request('DELETE', `${base}/issues/${o.pr}/labels/${encodeURIComponent(o.label)}`);
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    result.label = 'removed';
  } else if (has) result.label = 'kept';

  if (o.status) {
    const errors = report.findings.filter((f) => f.severity === 'error').length;
    const state = stale ? 'failure' : 'success';
    await o.gh.request('POST', `${base}/statuses/${report.head.sha}`, {
      state,
      context: STATUS_CONTEXT,
      description: (stale ? `${plural(errors, "migration error")} against ${report.main.ref}` : `Migrations consistent with ${report.main.ref}`).slice(0, 140),
      target_url: o.targetUrl,
    });
    result.status = state;
  }
  return result;
}
