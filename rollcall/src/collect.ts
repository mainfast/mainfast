// Reads protection, rulesets, recent merged and open PRs' check runs/statuses and the workflow
// files of the audited branch through the REST API. Each source that the token cannot read is
// recorded in `notes` and treated as empty, so a partial audit still runs.
import { encPath, GitHub, GitHubError } from '@mainfast/shared/github';
import { fetchRequiredSources } from '@mainfast/shared/required-checks';
import type { CheckRun, CommitStatus, PullObservation, Snapshot, WorkflowFile } from './types.js';

export interface CollectOptions {
  gh: GitHub;
  owner: string;
  repo: string;
  branch?: string;
  /** The repository's default branch when the caller knows it. Without `branch` it is looked up. */
  defaultBranch?: string;
  /** How many recently merged PRs to sample. */
  pulls?: number;
  /** How many open PRs to sample (default 10; 0 = none). */
  openPulls?: number;
  /** Workflow files already on disk; when omitted they are read through the contents API at the audited branch. */
  workflows?: WorkflowFile[];
  now?: () => Date;
}

async function soft<T>(notes: string[], what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError && [403, 404].includes(e.status)) {
      notes.push(`${what}: ${e.status} (${e.status === 403 ? 'token lacks permission' : 'not found'}), treated as empty`);
      return fallback;
    }
    throw e;
  }
}

/** The workflow files on `ref`, through the contents API (contents: read). */
export async function fetchWorkflows(gh: GitHub, owner: string, repo: string, ref: string, notes: string[]): Promise<WorkflowFile[]> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const dir = await soft(
    notes,
    `GET ${base}/contents/.github/workflows`,
    () => gh.get<Array<{ path: string; type: string; name: string }>>(`${base}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`),
    [],
  );
  const out: WorkflowFile[] = [];
  for (const f of Array.isArray(dir) ? dir : []) {
    if (f.type !== 'file' || !/\.ya?ml$/.test(f.name)) continue;
    const text = await gh.getFileText(owner, repo, f.path, ref);
    if (text !== undefined) out.push({ path: f.path, text });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function collect(o: CollectOptions): Promise<Snapshot> {
  const { gh, owner, repo } = o;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const defaultBranch = o.defaultBranch ?? (o.branch ? undefined : (await gh.get<{ default_branch: string }>(base)).default_branch);
  const branch = o.branch ?? defaultBranch!;
  const b = encPath(branch);

  // Classic protection ("Get a branch" first: read access is enough), active rules, all rulesets.
  const req = await fetchRequiredSources(gh, owner, repo, branch);
  const notes = [...req.notes];

  const observe = async (p: any, state: 'merged' | 'open'): Promise<PullObservation> => {
    const sha = p.head.sha as string;
    const checkRuns = await gh.paginate<CheckRun>(`${base}/commits/${sha}/check-runs?filter=latest&per_page=100`, 'check_runs');
    const combined = await soft(notes, `GET ${base}/commits/{sha}/status (needs statuses: read)`, () => gh.get<{ statuses?: CommitStatus[] }>(`${base}/commits/${sha}/status?per_page=100`), {});
    return { number: p.number, title: String(p.title ?? ''), headSha: sha, state, mergedAt: p.merged_at ?? null, updatedAt: p.updated_at ?? null, checkRuns, statuses: combined.statuses ?? [] };
  };

  const want = o.pulls ?? 20;
  const closed = await gh.paginate<any>(`${base}/pulls?state=closed&base=${b}&sort=updated&direction=desc&per_page=100`);
  const merged = closed
    .filter((p) => p.merged_at)
    .sort((x, y) => String(y.merged_at).localeCompare(String(x.merged_at)))
    .slice(0, want);
  const pulls: PullObservation[] = [];
  for (const p of merged) pulls.push(await observe(p, 'merged'));

  const wantOpen = o.openPulls ?? 10;
  if (wantOpen > 0) {
    const open = (await gh.paginate<any>(`${base}/pulls?state=open&base=${b}&sort=updated&direction=desc&per_page=100`))
      .filter((p) => p.state === 'open' && !p.merged_at)
      .slice(0, wantOpen);
    let silent = 0;
    for (const p of open) {
      const obs = await observe(p, 'open');
      // A head with nothing reported yet (CI not started) says nothing about any one check.
      if (!obs.checkRuns.length && !obs.statuses.length) silent++;
      else pulls.push(obs);
    }
    if (silent) notes.push(`${silent} open PR(s) had no check runs or statuses on their head yet and were not counted`);
  }
  // Newest first: merged PRs by merge time, open PRs by last update.
  pulls.sort((x, y) => String(y.mergedAt ?? y.updatedAt ?? '').localeCompare(String(x.mergedAt ?? x.updatedAt ?? '')));

  const workflows = o.workflows ?? (await fetchWorkflows(gh, owner, repo, branch, notes));

  return {
    repository: `${owner}/${repo}`,
    branch,
    defaultBranch,
    collectedAt: (o.now?.() ?? new Date()).toISOString(),
    classic: req.classic,
    branchRules: req.branchRules,
    rulesets: req.rulesets,
    pulls,
    workflows,
    headSha: req.headSha,
    headCommittedAt: req.headCommittedAt,
    notes: [...new Set(notes)],
  };
}
