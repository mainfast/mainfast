// Post the evidence: one check run per head sha (updated in place on re-runs) and one sticky comment.
import { CHECK_NAME, COMMENT_MARKER } from "../constants.ts";
import type { EvidenceReport } from "../evaluate.ts";
import { checkRunPayload, renderCard } from "../render.ts";
import type { GitHubApi, RawComment } from "./api.ts";
import { DEFAULT_COMMENT_AUTHOR, findSticky as sharedFindSticky } from "@mainfast/shared/github";

export { DEFAULT_COMMENT_AUTHOR };

/**
 * The sticky comment is ours only if it carries the marker AND was written by the identity we post
 * as (shared implementation: @mainfast/shared/github `findSticky`).
 */
export function findSticky(comments: RawComment[], author: string): RawComment | undefined {
  return sharedFindSticky(comments, COMMENT_MARKER, author);
}

export interface PublishResult {
  checkRunId: number;
  checkRunUrl?: string;
  commentId?: number;
  commentUrl?: string;
  commentAction: "created" | "updated" | "skipped";
}

export async function publish(
  api: GitHubApi,
  report: EvidenceReport,
  opts: {
    comment?: "always" | "on-flags" | "never";
    /** Login the token posts as, e.g. "my-app[bot]" for a GitHub App installation token. Default: `GET /user`, else github-actions[bot]. */
    commentAuthor?: string;
    /** Only update a check run from this app (its slug). A GitHub App may not update another app's run: GitHub answers 403. */
    checkRunApp?: string;
  } = {},
): Promise<PublishResult> {
  const [owner, repo] = report.repo.split("/") as [string, string];
  const payload = checkRunPayload(report);
  const existing = (await api.listCheckRunsForRef(owner, repo, report.pr.headSha, CHECK_NAME)).find(
    (r) => r.name === CHECK_NAME && r.head_sha === report.pr.headSha && (!opts.checkRunApp || r.app?.slug === opts.checkRunApp),
  );
  const { name: _n, head_sha: _h, ...update } = payload;
  const run = existing ? await api.updateCheckRun(owner, repo, existing.id, update) : await api.createCheckRun(owner, repo, payload);
  const checkRunUrl = run.html_url ?? run.details_url ?? undefined;

  const mode = opts.comment ?? "always";
  const comments = mode === "never" ? [] : await api.listIssueComments(owner, repo, report.pr.number);
  const author = mode === "never" ? "" : opts.commentAuthor?.trim() || (await api.getAuthenticatedLogin?.()) || DEFAULT_COMMENT_AUTHOR;
  const sticky = findSticky(comments, author);
  // Do not open a new comment for a clean or non-agent PR in on-flags mode, but keep an existing one current.
  const wantsComment = mode === "always" ? report.applies || !!sticky : mode === "on-flags" ? report.flags.length > 0 || !!sticky : false;
  if (!wantsComment) return { checkRunId: run.id, checkRunUrl, commentAction: "skipped" };
  const body = renderCard(report, { checkUrl: checkRunUrl });
  if (sticky) {
    const c = await api.updateIssueComment(owner, repo, sticky.id, body);
    return { checkRunId: run.id, checkRunUrl, commentId: c.id, commentUrl: c.html_url, commentAction: "updated" };
  }
  const c = await api.createIssueComment(owner, repo, report.pr.number, body);
  return { checkRunId: run.id, checkRunUrl, commentId: c.id, commentUrl: c.html_url, commentAction: "created" };
}
