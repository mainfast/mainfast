// Keeps ONE PR comment: written when something is unowned or wrong, marked resolved once clean.
// The comment is ours only if it starts with the marker AND was written by the identity we post
// as (`comment-author` input, else GET /user, else github-actions[bot]); a marker pasted into
// anyone else's comment is ignored, never edited or followed.
import { findOwnComment, type GitHub } from '@mainfast/shared/github';
import { COMMENT_MARKER, PRODUCT } from './brand.js';
import { toMarkdown, type MarkdownOptions } from './report.js';
import type { OwnersReport } from './types.js';

export const RESOLVED_BODY = `${COMMENT_MARKER}\n### ${PRODUCT}\n\nResolved: every changed file has a code owner and this PR's CODEOWNERS (if it edits one) has no problems.`;

export type CommentResult = 'created' | 'updated' | 'unchanged' | 'resolved' | 'none';

export async function publishComment(
  gh: GitHub,
  owner: string,
  repo: string,
  report: OwnersReport,
  author: string,
  o: MarkdownOptions = {},
): Promise<CommentResult> {
  if (!report.pr) return 'none';
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  const mine = await findOwnComment(gh, owner, repo, report.pr, COMMENT_MARKER, author);
  if (report.findings.length) {
    // No run link in the comment, so a re-run with the same result leaves it untouched.
    const body = `${COMMENT_MARKER}\n${toMarkdown(report, { ...o, runUrl: undefined })}`;
    if (mine?.body === body) return 'unchanged';
    if (mine) {
      await gh.request('PATCH', `${base}/comments/${mine.id}`, { body });
      return 'updated';
    }
    await gh.request('POST', `${base}/${report.pr}/comments`, { body });
    return 'created';
  }
  if (!mine || mine.body === RESOLVED_BODY) return 'none';
  await gh.request('PATCH', `${base}/comments/${mine.id}`, { body: RESOLVED_BODY });
  return 'resolved';
}
