// GitHub REST payloads -> PrSnapshot. Every check lookup is keyed by the PR's *current* head sha.
import { nameMatcher, type EvidencePolicy } from "../config.ts";
import { CONFIG_FILE } from "../constants.ts";
import type { ChecksSnapshot, CommitInfo, FileChange, FileStatus, PrSnapshot, PullRequestInfo, RequiredChecks } from "../types.ts";
import { fetchRequiredSources, requiredContexts, resolveRequiredChecks } from "@mainfast/shared/required-checks";
import { GitHubError, type GitHubApi, type RawCheckRun, type RawCommit, type RawFile, type RawPull, type RawStatus } from "./api.ts";

export function mapPull(p: RawPull): PullRequestInfo {
  return {
    number: p.number,
    title: p.title ?? "",
    body: p.body ?? "",
    authorLogin: p.user?.login ?? "",
    authorType: p.user?.type ?? "User",
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseRef: p.base.ref,
    baseSha: p.base.sha,
    labels: (p.labels ?? []).map((l) => l.name),
    htmlUrl: p.html_url,
  };
}

export function mapCommit(c: RawCommit): CommitInfo {
  return {
    sha: c.sha,
    message: c.commit.message ?? "",
    authorName: c.commit.author?.name ?? "",
    authorEmail: c.commit.author?.email ?? "",
    committerName: c.commit.committer?.name,
    committerEmail: c.commit.committer?.email,
    authorLogin: c.author?.login,
    authorType: c.author?.type,
  };
}

const STATUSES: FileStatus[] = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];

export function mapFile(f: RawFile): FileChange {
  return {
    path: f.filename,
    previousPath: f.previous_filename,
    status: (STATUSES as string[]).includes(f.status) ? (f.status as FileStatus) : "modified",
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  };
}

export function mapChecks(sha: string, runs: RawCheckRun[], statuses: RawStatus[]): ChecksSnapshot {
  return {
    sha,
    checkRuns: runs.map((r) => ({
      id: r.id,
      name: r.name,
      headSha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      appSlug: r.app?.slug,
      appId: r.app?.id ?? null,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      outputTitle: r.output?.title ?? null,
      outputSummary: r.output?.summary ?? null,
      detailsUrl: r.html_url ?? r.details_url,
    })),
    statuses: statuses.map((s) => ({ context: s.context, state: s.state, description: s.description, targetUrl: s.target_url, updatedAt: s.updated_at })),
  };
}

export async function fetchChecks(api: GitHubApi, owner: string, repo: string, sha: string): Promise<ChecksSnapshot> {
  const notes: string[] = [];
  const [runs, statuses] = await Promise.all([
    api.listCheckRunsForRef(owner, repo, sha),
    // The combined status needs "Commit statuses: read"; a workflow that does not grant it still
    // gets a card (check runs only) and a note instead of an error.
    api.listStatusesForRef(owner, repo, sha).catch((err: unknown) => {
      if (err instanceof GitHubError && [403, 404].includes(err.status)) {
        notes.push(`commit statuses on ${sha.slice(0, 7)}: ${err.status} (grant statuses: read to see them), treated as none`);
        return [];
      }
      throw err;
    }),
  ]);
  return { ...mapChecks(sha, runs, statuses), ...(notes.length ? { notes } : {}) };
}

/**
 * Required checks for the base branch, read and resolved by the suite's shared logic
 * (@mainfast/shared/required-checks), the same Mainfast Rollcall audits a repository with:
 * classic protection from "Get a branch" (contents: read; the admin endpoint only as a fallback,
 * which GITHUB_TOKEN can never read), active rulesets from `GET /rules/branches/{branch}`, app pins
 * kept per context. Rulesets in evaluate/disabled mode block nothing and are not listed.
 */
export async function fetchRequired(api: GitHubApi, owner: string, repo: string, branch: string): Promise<RequiredChecks> {
  const snap = await fetchRequiredSources(api.gh, owner, repo, branch, { rulesets: false });
  const set = resolveRequiredChecks({ classic: snap.classic, branchRules: snap.branchRules });
  const sources: string[] = [];
  const rulesNote = snap.notes.some((n) => n.includes("/rules/branches/"));
  if (!rulesNote) {
    const any = snap.branchRules.some((r) => r.type === "required_status_checks" && (r.parameters?.required_status_checks ?? []).length > 0);
    sources.push(any ? "rulesets" : "rulesets (none required)");
  }
  if (snap.classic) sources.push("branch protection");
  return { contexts: requiredContexts(set), sources, checks: set.required, notes: snap.notes };
}

export async function fetchPolicyText(api: GitHubApi, owner: string, repo: string, baseSha: string): Promise<string | undefined> {
  return (await api.getFileContent(owner, repo, CONFIG_FILE, baseSha)) ?? (await api.getFileContent(owner, repo, ".mainfast.yaml", baseSha));
}

export async function collectSnapshot(
  api: GitHubApi,
  repoFull: string,
  prNumber: number,
  policy: EvidencePolicy,
  opts: { pull?: RawPull; previousCommitsToCheck?: number } = {},
): Promise<PrSnapshot> {
  const [owner, repo] = repoFull.split("/") as [string, string];
  const pull = opts.pull ?? (await api.getPull(owner, repo, prNumber));
  const pr = mapPull(pull);
  const [commits, files, headChecks, required] = await Promise.all([
    api.listPullCommits(owner, repo, prNumber).then((cs) => cs.map(mapCommit)),
    api.listPullFiles(owner, repo, prNumber).then((fs) => fs.map(mapFile)),
    fetchChecks(api, owner, repo, pr.headSha),
    fetchRequired(api, owner, repo, pr.baseRef),
  ]);
  // Only look back when the head has no test evidence: it explains *why* (tests ran on an older push).
  const isTest = policy.testChecks.map(nameMatcher);
  const headHasTests = [...headChecks.checkRuns.map((r) => r.name), ...headChecks.statuses.map((s) => s.context)].some((n) => isTest.some((m) => m(n)));
  const previousChecks: ChecksSnapshot[] = [];
  if (!headHasTests) {
    const earlier = commits.filter((c) => c.sha !== pr.headSha).reverse().slice(0, opts.previousCommitsToCheck ?? 3);
    for (const c of earlier) previousChecks.push(await fetchChecks(api, owner, repo, c.sha));
  }
  return { repo: repoFull, pr, commits, files, headChecks, previousChecks, required };
}
