import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePolicy } from "../src/config.ts";
import { evaluate, type EvidenceReport } from "../src/evaluate.ts";
import { RestClient } from "../src/github/api.ts";
import { collectSnapshot, fetchPolicyText } from "../src/github/collect.ts";
import { mockFetch, type FixtureRoutes } from "../src/github/mockFetch.ts";

export const REPO = "octo-org/widgets";
export const R = `/repos/${REPO}`;
export const BASE = "6dcb09b5b57875f334f61aebed695e2e4193db5e";
export const PREV = "a1e2d3c4b5a6978877665544332211ffeeddccbb";
export const HEAD = "b7f3c2a1d4e5f60718293a4b5c6d7e8f90a1b2c3";

const DIR = join(import.meta.dirname, "fixtures", "github");

export function fx<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), "utf8")) as T;
}

export interface Variant {
  pull?: (p: any) => void;
  commits?: (c: any[]) => void;
  files?: any[] | ((f: any[]) => void);
  checkRuns?: (runs: any[]) => void;
  statuses?: (s: any[]) => void;
  prevCheckRuns?: any[];
  rules?: any[];
  /** "Get a branch" payload for main (classic protection lives in `protection.required_status_checks`). */
  branch?: (b: any) => void;
  protection?: { status: number; body: unknown };
  config?: string;
  comments?: any[];
  extra?: FixtureRoutes;
}

/** Build a REST route table from the base fixture PR, with per-test mutations. */
export function routes(v: Variant = {}): FixtureRoutes {
  const pull = fx("pull.json");
  v.pull?.(pull);
  const commits = fx<any[]>("commits.json");
  v.commits?.(commits);
  let files = fx<any[]>("files.json");
  if (Array.isArray(v.files)) files = v.files;
  else v.files?.(files);
  const cr = fx("check-runs-head.json");
  v.checkRuns?.(cr.check_runs);
  for (const r of cr.check_runs) r.head_sha ??= pull.head.sha;
  cr.total_count = cr.check_runs.length;
  const st = fx("status-head.json");
  v.statuses?.(st.statuses);
  const headSha = pull.head.sha;
  const branch = fx("branch-main.json");
  v.branch?.(branch);
  const out: FixtureRoutes = {
    [`GET ${R}/pulls/42`]: pull,
    [`GET ${R}/pulls/42/commits`]: commits,
    [`GET ${R}/pulls/42/files`]: files,
    [`GET ${R}/commits/${headSha}/check-runs`]: cr,
    [`GET ${R}/commits/${headSha}/status`]: st,
    [`GET ${R}/commits/${PREV}/check-runs`]: { total_count: v.prevCheckRuns?.length ?? 0, check_runs: v.prevCheckRuns ?? [] },
    [`GET ${R}/commits/${PREV}/status`]: { state: "pending", statuses: [], sha: PREV, total_count: 0 },
    [`GET ${R}/branches/main`]: branch,
    [`GET ${R}/rules/branches/main`]: v.rules ?? fx("rules-main.json"),
    [`GET ${R}/branches/main/protection/required_status_checks`]: v.protection ?? { status: 403, body: fx("protection-403.json") },
    [`GET ${R}/issues/42/comments`]: v.comments ?? [],
  };
  if (v.config !== undefined) {
    const c = fx("contents-config.json");
    c.content = Buffer.from(v.config).toString("base64");
    c.size = v.config.length;
    out[`GET ${R}/contents/.mainfast.yml`] = c;
  }
  return { ...out, ...v.extra };
}

export async function runVariant(v: Variant = {}): Promise<{ report: EvidenceReport; calls: ReturnType<typeof mockFetch>["calls"]; api: RestClient }> {
  const { fetch, calls } = mockFetch(routes(v));
  const api = new RestClient("test-token", { fetch });
  const pull = await api.getPull("octo-org", "widgets", 42);
  const loaded = parsePolicy(await fetchPolicyText(api, "octo-org", "widgets", pull.base.sha));
  const snap = await collectSnapshot(api, REPO, 42, loaded.policy, { pull });
  return { report: evaluate(snap, loaded.policy, loaded.warnings), calls, api };
}

export function ids(r: EvidenceReport): string[] {
  return r.flags.map((f) => f.id).sort();
}

/** A GitHub-style per-file patch from added/removed lines (one hunk). */
export function patchOf(removed: string[], added: string[], start = 1): string {
  return [`@@ -${start},${removed.length} +${start},${added.length} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join("\n");
}

export function file(filename: string, removed: string[], added: string[], status = "modified"): any {
  return { filename, status, additions: added.length, deletions: removed.length, changes: added.length + removed.length, patch: patchOf(removed, added) };
}

export function checkRun(name: string, conclusion: string | null, extra: Record<string, unknown> = {}): any {
  return {
    id: Math.floor(Math.random() * 1e9),
    name,
    head_sha: HEAD,
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    started_at: "2026-10-27T08:00:12Z",
    completed_at: conclusion === null ? null : "2026-10-27T08:02:40Z",
    details_url: `https://github.com/${REPO}/actions/runs/1/job/2`,
    html_url: `https://github.com/${REPO}/actions/runs/1/job/2`,
    output: { title: null, summary: null, text: null, annotations_count: 0 },
    app: { id: 15368, slug: "github-actions" },
    pull_requests: [],
    ...extra,
  };
}
