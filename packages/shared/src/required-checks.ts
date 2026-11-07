// Required status checks: which contexts protect a branch, and what a commit reported for each.
// Shared by Mainfast Evidence (one PR head at a time) and Mainfast Rollcall (a repo-wide audit
// over many PRs). Pure functions plus one collector; shapes follow the GitHub REST docs (API
// version 2022-11-28) and only type the fields read here.
//
// Sources of requirements:
// - classic branch protection: `GET /repos/{o}/{r}/branches/{b}` -> protection.required_status_checks
//   (contents: read), else `GET .../branches/{b}/protection/required_status_checks` (administration:
//   read, which GITHUB_TOKEN can never have);
// - active rulesets: `GET /repos/{o}/{r}/rules/branches/{b}` (metadata: read). It already resolves
//   org/enterprise rulesets and ref conditions, and returns only rules from ACTIVE rulesets;
// - rulesets in `evaluate` / `disabled` mode only show up in `GET /repos/{o}/{r}/rulesets` (+ `/{id}`
//   for the rules, metadata: read). They block nothing, so they are reported apart (`notEnforced`).
// A check pinned to an app (`app_id` / `integration_id`) is only satisfied by a run from that app.
import { GitHub, GitHubError, encPath } from "./github.ts";

/** Classic protection's required checks (either endpoint). */
export interface ClassicRequiredChecks {
  strict?: boolean;
  enforcement_level?: string;
  contexts: string[];
  checks: Array<{ context: string; app_id: number | null }>;
}

/** Item of GET /repos/{o}/{r}/rules/branches/{branch}. */
export interface BranchRule {
  type: string;
  parameters?: {
    required_status_checks?: Array<{ context: string; integration_id?: number | null }>;
    strict_required_status_checks_policy?: boolean;
    do_not_enforce_on_create?: boolean;
    workflows?: Array<{ path: string; repository_id: number; ref?: string; sha?: string }>;
  };
  ruleset_source_type?: "Repository" | "Organization" | "Enterprise";
  ruleset_source?: string;
  ruleset_id?: number;
}

/** GET /repos/{o}/{r}/rulesets/{id} (subset). */
export interface Ruleset {
  id: number;
  name: string;
  target?: "branch" | "tag" | "push" | "repository";
  source_type?: "Repository" | "Organization" | "Enterprise";
  source?: string;
  enforcement: "disabled" | "active" | "evaluate";
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  rules?: BranchRule[];
}

/** A ref pattern from a ruleset condition: `*` stays within a path segment, `**` crosses them. */
function refMatches(pattern: string, ref: string): boolean {
  const escape = (t: string) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const source = pattern
    .split("**/")
    .map((a) => a.split("**").map((b) => b.split("*").map(escape).join("[^/]*")).join(".*"))
    .join("(?:.*/)?");
  return new RegExp(`^${source}$`).test(ref);
}

/**
 * Whether a ruleset's `conditions.ref_name` covers a branch. With no such condition (some org
 * rulesets) or an unknown default branch and `~DEFAULT_BRANCH`, it counts as a match.
 */
export function rulesetTargetsBranch(r: Pick<Ruleset, "target" | "conditions">, branch: string, defaultBranch?: string): boolean {
  if (r.target && r.target !== "branch") return false;
  const cond = r.conditions?.ref_name;
  if (!cond) return true;
  const ref = `refs/heads/${branch}`;
  const hit = (p: string) => p === "~ALL" || (p === "~DEFAULT_BRANCH" ? defaultBranch === undefined || defaultBranch === branch : refMatches(p, ref));
  return (cond.include ?? []).some(hit) && !(cond.exclude ?? []).some(hit);
}

export interface RequiredSource {
  kind: "classic" | "ruleset";
  rulesetId?: number;
  rulesetName?: string;
  enforcement?: Ruleset["enforcement"];
  /** App the check must come from; null/undefined = any app. */
  appId?: number | null;
}

export interface RequiredCheck {
  context: string;
  sources: RequiredSource[];
}

/** A ruleset that lists required checks but blocks nothing (evaluate or disabled). */
export interface NotEnforcedRuleset {
  rulesetId: number;
  rulesetName: string;
  enforcement: Ruleset["enforcement"];
  contexts: string[];
}

export interface RequiredSet {
  /** Enforced requirements (classic + active rulesets), one entry per context. */
  required: RequiredCheck[];
  notEnforced: NotEnforcedRuleset[];
  /** "Require branches to be up to date": per layer, undefined when that layer sets no checks. */
  strict: { classic?: boolean; ruleset?: boolean };
}

export interface RequiredInputs {
  classic?: ClassicRequiredChecks | null;
  branchRules?: BranchRule[];
  rulesets?: Ruleset[];
}

/**
 * The required contexts for a branch. Contexts are listed in the order they are first seen
 * (active rulesets, then classic protection); each context's sources list classic first.
 */
export function resolveRequiredChecks(input: RequiredInputs): RequiredSet {
  const byContext = new Map<string, RequiredSource[]>();
  const add = (context: string, src: RequiredSource) => {
    const list = byContext.get(context) ?? [];
    list.push(src);
    byContext.set(context, list);
  };
  const names = new Map((input.rulesets ?? []).map((r) => [r.id, r.name]));
  let rulesetStrict: boolean | undefined;
  for (const rule of input.branchRules ?? []) {
    if (rule.type !== "required_status_checks") continue;
    if (rule.parameters?.strict_required_status_checks_policy !== undefined)
      rulesetStrict = (rulesetStrict ?? false) || rule.parameters.strict_required_status_checks_policy;
    for (const c of rule.parameters?.required_status_checks ?? [])
      add(c.context, {
        kind: "ruleset",
        rulesetId: rule.ruleset_id,
        rulesetName: (rule.ruleset_id !== undefined ? names.get(rule.ruleset_id) : undefined) ?? rule.ruleset_source ?? "ruleset",
        enforcement: "active",
        appId: c.integration_id ?? null,
      });
  }
  const classic = input.classic;
  if (classic) {
    const pinned = new Map((classic.checks ?? []).map((c) => [c.context, c.app_id]));
    for (const ctx of new Set([...(classic.contexts ?? []), ...(classic.checks ?? []).map((c) => c.context)]))
      add(ctx, { kind: "classic", appId: pinned.get(ctx) ?? null });
  }
  const required = [...byContext].map(([context, sources]) => ({
    context,
    sources: [...sources.filter((s) => s.kind === "classic"), ...sources.filter((s) => s.kind !== "classic")],
  }));
  const notEnforced: NotEnforcedRuleset[] = [];
  for (const r of input.rulesets ?? []) {
    if (r.enforcement === "active") continue;
    const contexts = (r.rules ?? []).flatMap((x) => (x.type === "required_status_checks" ? (x.parameters?.required_status_checks ?? []).map((c) => c.context) : []));
    if (contexts.length) notEnforced.push({ rulesetId: r.id, rulesetName: r.name, enforcement: r.enforcement, contexts });
  }
  const hasClassic = Boolean(classic && ((classic.contexts ?? []).length || (classic.checks ?? []).length));
  return { required, notEnforced, strict: { classic: hasClassic ? classic?.strict : undefined, ruleset: rulesetStrict } };
}

export const requiredContexts = (set: RequiredSet): string[] => set.required.map((r) => r.context);

export const sourceLabel = (s: RequiredSource): string => (s.kind === "classic" ? "branch protection" : `ruleset "${s.rulesetName}"`);

/** True when a run from `appId` satisfies every source (each source either allows any app or pins this one). */
export function appSatisfies(sources: RequiredSource[], appId: number | null | undefined): boolean {
  return sources.every((s) => s.appId === null || s.appId === undefined || s.appId === appId);
}

/** App ids the requirement is pinned to (empty = any app). */
export const pinnedApps = (sources: RequiredSource[]): number[] => [...new Set(sources.map((s) => s.appId).filter((x): x is number => typeof x === "number"))];

// --- collecting ---------------------------------------------------------------------------

export interface RequiredSourcesSnapshot {
  classic: ClassicRequiredChecks | null;
  branchRules: BranchRule[];
  rulesets: Ruleset[];
  /** Head commit of the branch, from "Get a branch". */
  headSha?: string;
  headCommittedAt?: string;
  /** What could not be read (403/404), treated as empty. */
  notes: string[];
}

async function soft<T>(notes: string[], what: string, fn: () => Promise<T>, fallback: T, why?: (status: number) => string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError && [403, 404].includes(e.status)) {
      // On a private repository the plan can refuse these endpoints; "Upgrade to GitHub Pro ..." is not a token problem.
      const planLimit = e.status === 403 && /upgrade to github/i.test(e.body);
      const reason = planLimit ? "not available on this GitHub plan for a private repository" : (why?.(e.status) ?? (e.status === 403 ? "token lacks permission" : "not found"));
      notes.push(`${what}: ${e.status} (${reason}), treated as empty`);
      return fallback;
    }
    throw e;
  }
}

/**
 * Reads classic protection (read-access endpoint first, admin endpoint as the fallback), the
 * active rules for the branch and, unless `rulesets: false`, every branch ruleset with its rules
 * (to see evaluate/disabled ones). A source the token cannot read becomes a note.
 */
export async function fetchRequiredSources(
  gh: GitHub,
  owner: string,
  repo: string,
  branch: string,
  opts: { rulesets?: boolean } = {},
): Promise<RequiredSourcesSnapshot> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const b = encPath(branch);
  const notes: string[] = [];
  const info = await soft(notes, `GET ${base}/branches/${branch}`, () => gh.get<any>(`${base}/branches/${b}`), undefined);
  let classic: ClassicRequiredChecks | null = null;
  const rsc = info?.protection?.required_status_checks;
  if (info?.protected && rsc && (rsc.contexts?.length || rsc.checks?.length)) {
    classic = { strict: rsc.strict, enforcement_level: rsc.enforcement_level, contexts: rsc.contexts ?? [], checks: rsc.checks ?? [] };
  } else if (info?.protected && info.protection?.enabled !== false) {
    // enabled: false means no classic protection: the branch is protected by rulesets alone.
    classic = await soft(
      notes,
      `GET ${base}/branches/${branch}/protection/required_status_checks`,
      () => gh.get<ClassicRequiredChecks>(`${base}/branches/${b}/protection/required_status_checks`),
      null,
      (s) => (s === 403 ? "needs administration: read, which GITHUB_TOKEN cannot have; classic required checks unknown" : "no classic required checks"),
    );
    if (classic) classic = { ...classic, contexts: classic.contexts ?? [], checks: classic.checks ?? [] };
  }
  const branchRules = await soft(notes, `GET ${base}/rules/branches/${branch}`, () => gh.paginate<BranchRule>(`${base}/rules/branches/${b}?per_page=100`), []);
  const rulesets: Ruleset[] = [];
  if (opts.rulesets !== false) {
    const list = await soft(notes, `GET ${base}/rulesets`, () => gh.paginate<Ruleset>(`${base}/rulesets?includes_parents=true&per_page=100`), []);
    for (const r of list) {
      if (r.target && r.target !== "branch") continue;
      rulesets.push(await soft(notes, `GET ${base}/rulesets/${r.id}`, () => gh.get<Ruleset>(`${base}/rulesets/${r.id}?includes_parents=true`), r));
    }
  }
  const committedAt = info?.commit?.commit?.committer?.date;
  return { classic, branchRules, rulesets, headSha: typeof info?.commit?.sha === "string" ? info.commit.sha : undefined, headCommittedAt: typeof committedAt === "string" ? committedAt : undefined, notes };
}

// --- what a commit reported ------------------------------------------------------------------

export type CheckState =
  | "success"
  | "failure"
  | "pending"
  | "skipped"
  | "neutral"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "stale"
  | "missing";

/** Worst first: when a check run and a status (or two runs) share a name, the worst one decides. */
export const STATE_ORDER: readonly CheckState[] = ["failure", "timed_out", "cancelled", "action_required", "stale", "pending", "skipped", "neutral", "success"];

/** A check run's state: not completed = pending; unknown or null conclusion = failure. */
export function checkRunState(status: string, conclusion: string | null | undefined): CheckState {
  if (status !== "completed") return "pending";
  switch (conclusion) {
    case "success":
    case "failure":
    case "neutral":
    case "skipped":
    case "cancelled":
    case "timed_out":
    case "action_required":
    case "stale":
      return conclusion;
    default:
      return "failure";
  }
}

/** A commit status's state (error and failure both fail). */
export function commitStatusState(state: string): CheckState {
  if (state === "success") return "success";
  if (state === "pending") return "pending";
  return "failure";
}

export function worstState(states: readonly CheckState[]): CheckState {
  const known = states.filter((s) => s !== "missing");
  if (!known.length) return "missing";
  return [...known].sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b))[0]!;
}

/** Coarse outcome for audits: what a required check did on a commit. */
export type Outcome = "passed" | "failed" | "pending" | "skipped" | "neutral" | "stale" | "missing";

export function outcomeOf(state: CheckState): Outcome {
  switch (state) {
    case "success":
      return "passed";
    case "skipped":
    case "neutral":
    case "pending":
    case "stale":
    case "missing":
      return state;
    default:
      return "failed";
  }
}

/** GitHub counts success, skipped and neutral as satisfying a required check. */
export const satisfiesRequired = (state: CheckState): boolean => state === "success" || state === "skipped" || state === "neutral";

/** Newest item per key; on a tie the later item wins. */
export function latestBy<T>(items: readonly T[], key: (t: T) => string, order: (t: T) => string): T[] {
  const by = new Map<string, T>();
  for (const it of items) {
    const k = key(it);
    const prev = by.get(k);
    if (!prev || order(it) >= order(prev)) by.set(k, it);
  }
  return [...by.values()];
}

/** Order key for check runs: start time, then id. */
export const runOrder = (r: { startedAt?: string | null; id?: number }): string => `${r.startedAt ?? ""}|${String(r.id ?? 0).padStart(15, "0")}`;

export interface ObservedRun {
  name: string;
  /** Commit the run reported on; runs for another commit are stale evidence and ignored. */
  headSha?: string;
  status: string;
  conclusion: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  id?: number;
  appId?: number | null;
  appSlug?: string | null;
}

export interface ObservedStatus {
  context: string;
  state: string;
  updatedAt?: string;
}

export interface CommitChecks {
  sha: string;
  runs: readonly ObservedRun[];
  statuses: readonly ObservedStatus[];
}

export interface RequiredResult {
  context: string;
  state: CheckState;
  outcome: Outcome;
  /** The latest run with this name, if any. */
  run?: ObservedRun;
  /** False when the requirement is pinned to an app and the run came from another one. */
  appSatisfied: boolean;
}

/** Latest run per name on `sha` (other commits' runs dropped). */
export function latestRuns(c: CommitChecks): ObservedRun[] {
  return latestBy(
    c.runs.filter((r) => r.headSha === undefined || r.headSha === c.sha),
    (r) => r.name,
    runOrder,
  );
}

/** Latest status per context. */
export const latestStatuses = (c: CommitChecks): ObservedStatus[] => latestBy(c.statuses, (s) => s.context, (s) => s.updatedAt ?? "");

/** What `sha` reported for one required context (check runs and statuses of that name; the worst decides). */
export function classifyRequired(context: string, c: CommitChecks, sources: RequiredSource[] = []): RequiredResult {
  const run = latestRuns(c).find((r) => r.name === context);
  const status = latestStatuses(c).find((s) => s.context === context);
  const states: CheckState[] = [];
  if (run) states.push(checkRunState(run.status, run.conclusion));
  if (status) states.push(commitStatusState(status.state));
  const state = worstState(states);
  return { context, state, outcome: outcomeOf(state), run, appSatisfied: !run || appSatisfies(sources, run.appId) };
}
