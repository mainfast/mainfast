// Which pull request does a triggering event belong to?
//
// `workflow_run` lists the PRs of the run in `workflow_run.pull_requests`, but that array is empty
// when the PR comes from a fork, so a fork PR would get no card. For those the PR is looked up by
// the run's head sha (`GET /commits/{sha}/pulls`, then open PRs filtered by `head=<owner>:<branch>`,
// then open PRs scanned), and a candidate is only accepted when GitHub's own PR record matches:
// open, head sha equal to the run's head sha, base repository = this repository. Nothing from the
// event payload is trusted beyond being a search key.
import { GitHubError, type GitHubApi, type RawPull } from "./api.ts";

export interface WorkflowRunPayload {
  head_sha?: string;
  head_branch?: string | null;
  head_repository?: { full_name?: string; owner?: { login?: string } } | null;
  repository?: { full_name?: string };
  pull_requests?: Array<{ number: number }>;
}

export interface ResolvedPr {
  number: number;
  /** The PR record, already fetched (saves a request). */
  pull?: RawPull;
  /** How it was found, for the log. */
  via: "event" | "commit-pulls" | "head-filter" | "open-scan";
  fork: boolean;
  /** Why no PR was taken (for a notice). */
  note?: string;
}

/** A lookup the token may not be allowed to make (403/404/422) is just no candidates. */
const none = (err: unknown): RawPull[] => {
  if (err instanceof GitHubError && [403, 404, 422].includes(err.status)) return [];
  throw err;
};

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A PR record matches when it is open, targets this repository and its head is exactly `sha`. */
export function pullMatches(p: RawPull, repoFull: string, sha: string): boolean {
  return (p.state === undefined || p.state === "open") && p.head?.sha === sha && same(p.base?.repo?.full_name, repoFull);
}

function pick(cands: RawPull[], repoFull: string, sha: string): RawPull | undefined {
  const ok = cands.filter((p) => pullMatches(p, repoFull, sha));
  // Two open PRs with the same head (one branch into two bases): the most recently updated one.
  return ok.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.number - a.number)[0];
}

/** PR for a `workflow_run` event, forks included. */
export async function resolveWorkflowRunPr(api: GitHubApi, owner: string, repo: string, run: WorkflowRunPayload): Promise<ResolvedPr | undefined> {
  const repoFull = `${owner}/${repo}`;
  const sha = run.head_sha;
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return undefined;
  const fork = !!run.head_repository?.full_name && !same(run.head_repository.full_name, repoFull);

  // Same-repository PRs are listed in the event; still check against the PR record.
  for (const { number } of run.pull_requests ?? []) {
    const p = await api.getPull(owner, repo, number);
    if (pullMatches(p, repoFull, sha)) return { number, pull: p, via: "event", fork };
    if (same(p.base?.repo?.full_name, repoFull) && p.state === "open" && p.head.sha !== sha)
      return {
        number,
        via: "event",
        fork,
        note: `PR #${number} has moved on to ${p.head.sha.slice(0, 7)}; this run was for ${sha.slice(0, 7)}. The run for the new head evaluates it.`,
      };
  }

  const hit1 = pick(await api.listPullsForCommit(owner, repo, sha).catch(none), repoFull, sha);
  if (hit1) return { number: hit1.number, pull: hit1, via: "commit-pulls", fork };

  const headOwner = run.head_repository?.owner?.login;
  if (headOwner && run.head_branch) {
    const hit2 = pick(await api.listOpenPulls(owner, repo, { head: `${headOwner}:${run.head_branch}`, max: 100 }).catch(none), repoFull, sha);
    if (hit2) return { number: hit2.number, pull: hit2, via: "head-filter", fork };
  }

  const hit3 = pick(await api.listOpenPulls(owner, repo, { max: 300 }).catch(none), repoFull, sha);
  if (hit3) return { number: hit3.number, pull: hit3, via: "open-scan", fork };
  return undefined;
}
