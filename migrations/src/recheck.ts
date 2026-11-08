// Push-to-main mode: main just moved, so every open PR's migrations are judged
// against the new main. Lists open PRs (GITHUB_TOKEN is enough), fetches each
// head as refs/pull/<n>/head, re-runs the analysis, and comments/labels the
// stale ones (and clears the label on PRs that became clean).
import type { MigrationsConfig } from './config.js';
import { analyze, loadConfigFromRef, type MigrationsReport } from './engine.js';
import { git, Tree } from './git.js';
import { publish, type PublishResult } from './publish.js';
import { resolveCommentAuthor, type GitHub } from '@mainfast/shared/github';
import { mdCode, mdText } from '@mainfast/shared/markdown';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface RecheckOptions {
  repoDir: string;
  gh: GitHub;
  owner: string;
  repo: string;
  mainBranch: string;
  remote?: string;
  label?: string;
  comment?: boolean;
  /** Set the blocking commit status on every re-checked head (default true). */
  status?: boolean;
  maxPrs?: number;
  config?: MigrationsConfig;
  targetUrl?: string;
  /** Login the token posts as (input `comment-author`); default GET /user, else github-actions[bot]. */
  commentAuthor?: string;
  /** Skip `git fetch` (tests that prepared the refs themselves). */
  noFetch?: boolean;
}

export interface RecheckEntry {
  number: number;
  title: string;
  stale: boolean;
  report?: MigrationsReport;
  published?: PublishResult;
  error?: string;
}

interface PullSummary {
  number: number;
  title: string;
  draft?: boolean;
  head: { sha: string; ref: string };
  base: { ref: string };
  labels?: Array<{ name: string }>;
}

export const MAIN_REF = 'refs/mainfast/main';
export const prRef = (n: number) => `refs/mainfast/pr/${n}`;

export async function recheckOpenPrs(o: RecheckOptions): Promise<RecheckEntry[]> {
  const remote = o.remote ?? 'origin';
  const pulls = (
    await o.gh.paginate<PullSummary>(
      `/repos/${o.owner}/${o.repo}/pulls?state=open&base=${encodeURIComponent(o.mainBranch)}&per_page=100`,
    )
  ).slice(0, o.maxPrs ?? 50);

  const fetchErrors = new Map<number, string>();
  if (!o.noFetch) {
    const fetch = (specs: string[]) => git(o.repoDir, ['fetch', '--no-tags', '--quiet', remote, ...specs]);
    const mainSpec = `+refs/heads/${o.mainBranch}:${MAIN_REF}`;
    const prSpec = (n: number) => `+refs/pull/${n}/head:${prRef(n)}`;
    try {
      fetch([mainSpec, ...pulls.map((p) => prSpec(p.number))]);
    } catch {
      // one bad ref fails the whole batch; fall back to one fetch per PR so the rest still get checked
      fetch([mainSpec]);
      for (const p of pulls) {
        try {
          fetch([prSpec(p.number)]);
        } catch (e) {
          fetchErrors.set(p.number, `could not fetch refs/pull/${p.number}/head: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        }
      }
    }
  }
  const mainTree = Tree.atRef(o.repoDir, MAIN_REF, o.mainBranch);
  const config = o.config ?? loadConfigFromRef(mainTree);
  const label = o.label ?? config.label;
  const mainSha = git(o.repoDir, ['rev-parse', MAIN_REF]).trim();
  const commentAuthor = (o.comment ?? true) && pulls.length ? await resolveCommentAuthor(o.gh, o.commentAuthor) : undefined;

  const out: RecheckEntry[] = [];
  for (const p of pulls) {
    const entry: RecheckEntry = { number: p.number, title: p.title, stale: false };
    if (fetchErrors.has(p.number)) {
      out.push({ ...entry, error: fetchErrors.get(p.number) });
      continue;
    }
    try {
      const report = analyze({ repo: o.repoDir, mainRef: MAIN_REF, headRef: prRef(p.number), config });
      report.main.ref = o.mainBranch;
      report.head.ref = `#${p.number}`;
      entry.report = report;
      entry.stale = !report.ok;
      entry.published = await publish(report, {
        gh: o.gh,
        owner: o.owner,
        repo: o.repo,
        pr: p.number,
        currentLabels: (p.labels ?? []).map((l) => l.name),
        label,
        comment: o.comment ?? true,
        status: o.status ?? true,
        targetUrl: o.targetUrl,
        commentAuthor,
        preface: `${mdCode(o.mainBranch)} moved to ${mainSha.slice(0, 7)}; this PR's migrations no longer line up with it.`,
      });
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    out.push(entry);
  }
  return out;
}

export function recheckMarkdown(entries: RecheckEntry[], mainBranch: string): string {
  const stale = entries.filter((e) => e.stale);
  const lines = [
    `### Open PRs re-checked against ${mdCode(mainBranch)}`,
    '',
    `${plural(entries.length, "open PR")} checked, ${stale.length} stale.`,
    '',
  ];
  if (entries.length) {
    lines.push('| PR | Result | Findings |', '|---|---|---|');
    for (const e of entries)
      lines.push(
        `| #${e.number} ${mdText(e.title, 200)} | ${e.error ? 'error' : e.stale ? 'stale' : 'ok'} | ${
          e.error ? mdText(e.error, 200) : (e.report?.findings ?? []).map((f) => `${f.framework}:${f.code}`).join(', ')
        } |`,
      );
  }
  return lines.join('\n');
}
