// Pure audit over a Snapshot: required checks (classic protection + active rulesets, resolved by
// @mainfast/shared/required-checks, the same logic Evidence uses per PR) against what recent
// merged and open PRs actually reported and what the workflow files can produce.
import { checkRunState, classifyRequired, commitStatusState, latestRuns, latestStatuses, outcomeOf, pinnedApps, resolveRequiredChecks, rulesetTargetsBranch, sourceLabel, type CommitChecks, type Outcome, type RequiredSet } from '@mainfast/shared/required-checks';
import { CHECK_NAME } from './brand.js';
import type { AuditReport, CheckTally, Finding, PullObservation, RequiredCheck, Snapshot } from './types.js';
import { branchAllowed, conditionOnPr, filtersOf, parseWorkflows, producersOf, type JobInfo, type WorkflowInfo } from './workflows.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface AuditOptions {
  /** Required contexts to leave out of the audit. */
  ignore?: string[];
  /** A check missing on this many newest PRs in a row (but seen before) counts as "stopped reporting". */
  stoppedAfter?: number;
}

export function requiredSet(s: Snapshot): RequiredSet {
  return resolveRequiredChecks({ classic: s.classic, branchRules: s.branchRules, rulesets: s.rulesets });
}

export function requiredChecks(s: Snapshot): RequiredCheck[] {
  return requiredSet(s).required;
}

/** The one-line fix for each finding, used when the finding has no more specific one. */
export const FIXES: Record<string, string> = {
  'never-ran': 'Remove the stale requirement, or restore the job that reported it. Merges into this branch currently need a bypass.',
  renamed: 'Put the new job name in the required list and drop the old one.',
  'stopped-reporting': 'Find the commit that removed or renamed the job, then restore it or update the required list.',
  'matrix-name-mismatch': 'Require each matrix leg by its full name, or add an `if: always()` gate job with the required name that fails unless every leg succeeded.',
  'skipped-as-success': 'Make the required check a gate job with `if: always()` that fails when its dependencies did not succeed, or move the condition from the job into its steps.',
  'path-filtered': 'Drop the paths filter and skip inside the job (for example, a paths-filter step with step conditions), or require a gate job that always runs.',
  'branch-filtered': 'Add this branch to the workflow\'s `pull_request` branches filter (or remove the filter).',
  'not-on-pull-request': 'Add a `pull_request` trigger (and `merge_group` if you use a merge queue).',
  'app-mismatch': 'Pin the requirement to the app that reports it (GitHub Actions is 15368 on github.com), or to any source.',
  'required-workflow-missing': 'Point the ruleset\'s required workflow at a file that exists, or remove the rule.',
  'conditional-job': 'Move the condition into the steps, or make sure every skip is intended.',
  'skips-when-needs-fail': "Add `if: always()` and fail the job when `contains(needs.*.result, 'failure')`, or require the needed jobs too.",
  'neutral-as-success': 'Have the check conclude success or failure; neutral passes a required check without proving anything.',
  'merged-without': 'Review who bypassed (the ruleset insights / audit log show it) and limit the bypass list.',
  'merged-with-failure': 'Review the bypass; if the check is flaky, fix it rather than merging over it.',
  'merged-while-pending': 'Do not merge until required checks finish; limit who can bypass, or turn on the merge queue.',
  'protection-drift': 'Keep one source of truth: move every required check into the ruleset and empty the classic list (or the reverse).',
  'ruleset-not-enforced': 'Switch the ruleset to Active once its checks report reliably, or delete it.',
  'ambiguous-name': 'Give each job a unique name.',
  'workflow-unparsable': 'Fix the YAML; GitHub will not run this workflow either.',
};

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function similarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x.length && !y.length) return 1;
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const tok = (s: string) => new Set(s.split(/[^a-z0-9]+/).filter(Boolean));
  const tx = tok(x);
  const ty = tok(y);
  const shared = [...tx].filter((t) => ty.has(t)).length;
  const jac = shared / Math.max(1, new Set([...tx, ...ty]).size);
  return Math.max(lev, jac);
}

const prList = (ns: number[]) => ns.map((n) => `#${n}`).join(', ');
const ALWAYS = /\b(always|failure|cancelled)\s*\(\s*\)/;

const isMerged = (p: PullObservation) => (p.state ?? 'merged') === 'merged';
/** With no merge for this long while PRs stay active, missing checks on open PRs may be what blocks them. */
const STALLED_MERGES_DAYS = 7;
/**
 * The run was going when the PR merged and finished later. A run that started after the merge is a
 * re-run, so it says nothing about the merge; one still queued at merge time looks the same.
 */
const runningAtMerge = (run: { startedAt?: string | null; completedAt?: string | null } | undefined, mergedAt?: string | null) => {
  if (!run?.startedAt || !run.completedAt || !mergedAt) return false;
  const merged = Date.parse(mergedAt);
  return Date.parse(run.startedAt) <= merged && merged < Date.parse(run.completedAt);
};

/** The result arrived after the merge, so it says nothing about the state at merge time. */
const reportedAfterMerge = (at: string | null | undefined, mergedAt?: string | null) => Boolean(at && mergedAt && Date.parse(at) > Date.parse(mergedAt));

function commitChecks(p: PullObservation): CommitChecks {
  return {
    sha: p.headSha,
    runs: p.checkRuns.map((r) => ({ name: r.name, headSha: r.head_sha, status: r.status, conclusion: r.conclusion, startedAt: r.started_at, completedAt: r.completed_at, id: r.id, appId: r.app?.id ?? null, appSlug: r.app?.slug ?? null })),
    statuses: p.statuses.map((x) => ({ context: x.context, state: x.state, updatedAt: x.updated_at })),
  };
}

function onlyPathFiltered(producers: JobInfo[], workflows: WorkflowInfo[]): boolean {
  const filtered = (j: JobInfo) => workflows.find((w) => w.path === j.workflow)?.prTriggers.some((t) => t.paths || t.pathsIgnore) ?? false;
  return producers.length > 0 && producers.every(filtered);
}

function mergedWithout(context: string, missing: number[]): Finding {
  return {
    code: 'merged-without',
    severity: 'warning',
    context,
    message: `${plural(missing.length, "merged PR")} have no \`${context}\` result on their head commit (${prList(missing.slice(0, 10))}): merged by bypass, or the requirement was added after them`,
    evidence: missing.slice(0, 10),
  };
}

export function audit(s: Snapshot, opts: AuditOptions = {}): AuditReport {
  const stoppedAfter = opts.stoppedAfter ?? 2;
  const ignore = new Set([...(opts.ignore ?? []), CHECK_NAME]);
  const set = requiredSet(s);
  const required = set.required.filter((r) => !ignore.has(r.context));
  const requiredNames = new Set(required.map((r) => r.context));
  const workflows = parseWorkflows(s.workflows);
  const opaqueJobs = workflows.filter((w) => !w.callableOnly).flatMap((w) => w.jobs.filter((j) => j.opaque));
  const findings: Finding[] = [];
  const pulls = s.pulls;
  const merged = pulls.filter(isMerged);
  const obs = pulls.map((p) => {
    const c = commitChecks(p);
    const names = new Set([...latestRuns(c).map((r) => r.name), ...latestStatuses(c).map((x) => x.context)]);
    return { p, c, names };
  });
  const seenNames = new Map<string, number[]>();
  for (const { p, names } of obs) for (const n of names) seenNames.set(n, [...(seenNames.get(n) ?? []), p.number]);

  for (const w of workflows)
    if (w.error) findings.push({ code: 'workflow-unparsable', severity: 'warning', message: `\`${w.path}\` is not valid YAML: ${w.error}` });

  // Rulesets that carry required checks but are not enforced.
  for (const r of set.notEnforced) {
    // A ruleset aimed at other branches says nothing about this one.
    const ruleset = s.rulesets.find((x) => x.id === r.rulesetId);
    if (ruleset && !rulesetTargetsBranch(ruleset, s.branch, s.defaultBranch)) continue;
    const ctxs = r.contexts.filter((c) => !ignore.has(c));
    if (ctxs.length)
      findings.push({
        code: 'ruleset-not-enforced',
        severity: 'warning',
        message: `ruleset \`${r.rulesetName}\` requires ${ctxs.map((c) => `\`${c}\``).join(', ')} but its enforcement is \`${r.enforcement}\`, so nothing is blocked`,
        hint: r.enforcement === 'evaluate' ? 'Evaluate mode only records insights; switch it to Active once the checks report reliably.' : 'Enable the ruleset or delete it.',
      });
  }

  // Drift between classic branch protection and rulesets.
  const classicCtx = new Set(required.filter((r) => r.sources.some((x) => x.kind === 'classic')).map((r) => r.context));
  const rulesetCtx = new Set(required.filter((r) => r.sources.some((x) => x.kind === 'ruleset')).map((r) => r.context));
  if (classicCtx.size && rulesetCtx.size) {
    for (const r of required) {
      const inC = classicCtx.has(r.context);
      const inR = rulesetCtx.has(r.context);
      if (inC !== inR)
        findings.push({
          code: 'protection-drift',
          severity: 'warning',
          context: r.context,
          message: `\`${r.context}\` is required by ${inC ? 'branch protection only' : `${r.sources.map(sourceLabel).join(', ')} only`}; the other layer does not list it`,
        });
      else {
        // Only two explicit pins can disagree. GitHub pins a check named in classic protection to
        // the app that recently reported it, and both layers must pass, so one pin still holds.
        if (new Set(pinnedApps(r.sources)).size > 1)
          findings.push({
            code: 'protection-drift',
            severity: 'warning',
            context: r.context,
            message: `\`${r.context}\` is pinned to different apps: ${r.sources.map((x) => `${sourceLabel(x)} -> ${x.appId ?? 'any app'}`).join('; ')}`,
            hint: 'Pin it to the same app in both layers (or to any source in both).',
          });
      }
    }
    const { classic: classicStrict, ruleset: rulesetStrict } = set.strict;
    if (classicStrict !== undefined && rulesetStrict !== undefined && classicStrict !== rulesetStrict)
      findings.push({
        code: 'protection-drift',
        severity: 'warning',
        message: `"require branches to be up to date" is ${classicStrict ? 'on' : 'off'} in branch protection but ${rulesetStrict ? 'on' : 'off'} in the ruleset`,
        hint: 'Set "require branches to be up to date" the same way in both layers; the stricter one wins anyway.',
      });
  }

  const tallies: CheckTally[] = [];
  const lateFailures: string[] = [];
  for (const r of required) {
    const producers = producersOf(r.context, workflows);
    const by: Record<Outcome, number[]> = { passed: [], failed: [], skipped: [], neutral: [], pending: [], stale: [], missing: [] };
    const mergedBy: Record<Outcome, number[]> = { passed: [], failed: [], skipped: [], neutral: [], pending: [], stale: [], missing: [] };
    const appMismatch: Array<{ pr: number; app: string }> = [];
    const pins = pinnedApps(r.sources);
    const missingAt = new Set<number>();
    const failedAfterMerge: number[] = [];
    for (const { p, c } of obs) {
      const res = classifyRequired(r.context, c, r.sources);
      by[res.outcome].push(p.number);
      if (isMerged(p)) {
        const status = latestStatuses(c).find((x) => x.context === r.context);
        // A failure that came in after the merge did not get merged over, unless another source had
        // already failed. It is still worth knowing about, so it goes in the report's notes.
        const failing = [
          ...(res.run && outcomeOf(checkRunState(res.run.status, res.run.conclusion)) === 'failed' ? [res.run.startedAt] : []),
          ...(status && outcomeOf(commitStatusState(status.state)) === 'failed' ? [status.updatedAt] : []),
        ];
        if (failing.length && failing.every((at) => reportedAfterMerge(at, p.mergedAt))) failedAfterMerge.push(p.number);
        else mergedBy[runningAtMerge(res.run, p.mergedAt) ? 'pending' : res.outcome].push(p.number);
      }
      if (res.outcome === 'missing') missingAt.add(p.number);
      if (res.run && !res.appSatisfied) appMismatch.push({ pr: p.number, app: `${res.run.appSlug ?? '?'} (${res.run.appId ?? '?'})` });
    }
    if (failedAfterMerge.length) lateFailures.push(`\`${r.context}\` failed after the merge on ${prList(failedAfterMerge.slice(0, 10))} (a re-run or a late report), so it is not counted as merged over a failure`);
    tallies.push({
      context: r.context,
      sources: r.sources.map(sourceLabel),
      sampled: pulls.length,
      passed: by.passed.length,
      failed: by.failed.length,
      skipped: by.skipped.length,
      neutral: by.neutral.length,
      pending: by.pending.length + by.stale.length,
      missing: by.missing.length,
      open: pulls.length - merged.length,
      producers: producers.map((j) => `${j.workflow}#${j.id}`),
    });

    const seen = pulls.length - by.missing.length;
    if (pulls.length && seen === 0) {
      const matrixLegs = [...seenNames.keys()].filter((n) => n.startsWith(`${r.context} (`) && !requiredNames.has(n));
      const staticLegs = workflows.flatMap((w) => w.jobs).filter((j) => j.matrix && j.rawName === r.context);
      if (matrixLegs.length || staticLegs.length) {
        findings.push({
          code: 'matrix-name-mismatch',
          severity: 'error',
          context: r.context,
          message: `\`${r.context}\` is required, but the job is a matrix and reports ${
            matrixLegs.length ? matrixLegs.slice(0, 4).map((n) => `\`${n}\``).join(', ') : `\`${r.context} (…)\``
          }. No check is ever named exactly \`${r.context}\`, so PRs wait for it ("Expected — Waiting for status to be reported") or get merged by bypass.`,
          hint: `Require each matrix leg by its full name, or add a gate job (needs: ${staticLegs[0]?.id ?? 'the matrix job'}, if: always()) named \`${r.context}\` that fails unless every leg succeeded.`,
        });
      } else {
        const candidates = new Set<string>([
          ...[...seenNames.keys()].filter((n) => !requiredNames.has(n)),
          ...workflows.flatMap((w) => w.jobs).filter((j) => !/\$\{\{/.test(j.rawName) && !j.matrix && !j.reusable).map((j) => j.rawName).filter((n) => !requiredNames.has(n)),
        ]);
        const best = [...candidates].map((n) => ({ n, s: similarity(r.context, n) })).sort((a, b) => b.s - a.s)[0];
        if (best && best.s >= 0.5) {
          const on = seenNames.get(best.n)?.length ?? 0;
          findings.push({
            code: 'renamed',
            severity: 'error',
            context: r.context,
            message: `\`${r.context}\` did not report on any of the ${pulls.length} sampled PRs; \`${best.n}\` (${on ? `reported on ${on} of them` : 'defined in a workflow'}, not required) looks like its new name. The required list still names the old job, so the renamed job protects nothing.`,
            hint: `Replace \`${r.context}\` with \`${best.n}\` in ${r.sources.map(sourceLabel).join(' and ')}.`,
          });
        } else {
          findings.push({
            code: 'never-ran',
            severity: 'error',
            context: r.context,
            message: `\`${r.context}\` (required by ${r.sources.map(sourceLabel).join(', ')}) did not report on any of the ${pulls.length} sampled PRs. ${
              producers.length ? `It is produced by ${producers.map((j) => `\`${j.workflow}\` job \`${j.id}\``).join(', ')}, so check that workflow's triggers.` : `No job in .github/workflows produces this name${opaqueJobs.length ? `, though ${opaqueJobs.map((j) => `\`${j.workflow}\` job \`${j.id}\``).slice(0, 3).join(', ')} take their name from an expression and may produce it` : ''}.`
            }`,
            evidence: by.missing.slice(0, 10),
          });
        }
      }
    } else if (pulls.length) {
      // Missing on the newest merged PRs in a row, but present on older ones. Open PRs do not count:
      // their CI may not have reached this check, or a path or approval may be holding it.
      const missingStreak = (list: typeof obs) => {
        let n = 0;
        for (const x of list) {
          if (!missingAt.has(x.p.number)) break;
          n++;
        }
        return n;
      };
      const mergedObs = obs.filter((x) => isMerged(x.p));
      const streak = missingStreak(mergedObs);
      const firstMerged = obs.findIndex((x) => isMerged(x.p));
      const openFirst = firstMerged < 0 ? obs : obs.slice(0, firstMerged);
      const lastMerge = Date.parse(mergedObs[0]?.p.mergedAt ?? '');
      const weekOld = (at: number) => Date.parse(s.collectedAt) - at >= STALLED_MERGES_DAYS * 86_400_000;
      // A branch that still moves (a mirror, say) is not being blocked: nothing lands through PRs at all.
      const headDate = Date.parse(s.headCommittedAt ?? '');
      const stalled = !Number.isNaN(lastMerge) && weekOld(lastMerge) && (Number.isNaN(headDate) || weekOld(headDate));
      // The exception: a required check that vanished blocks every PR, so nothing merges at all.
      const blockedOpen = stalled && streak < stoppedAfter ? missingStreak(openFirst) : 0;
      if (stoppedAfter > 0 && (streak >= stoppedAfter || blockedOpen >= stoppedAfter)) {
        const recent = streak >= stoppedAfter ? mergedObs.slice(0, streak) : openFirst.slice(0, blockedOpen);
        const older = streak >= stoppedAfter ? mergedObs.slice(streak) : mergedObs;
        const reportedBefore = older.filter((x) => !missingAt.has(x.p.number)).length;
        const appeared = [...seenNames.keys()].filter((n) => !requiredNames.has(n) && recent.every((x) => x.names.has(n)) && !older.some((x) => x.names.has(n)));
        // Only a similar name counts as the new name: any job added since would otherwise qualify.
        const best = appeared.map((n) => ({ n, s: similarity(r.context, n) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s)[0];
        const onlyOpen = streak < stoppedAfter;
        // The job still exists behind a path filter, and path-filtered below reports that as an error.
        if (!best && onlyPathFiltered(producers, workflows)) {
          if (mergedBy.missing.length) findings.push(mergedWithout(r.context, mergedBy.missing));
        } else findings.push({
          code: best ? 'renamed' : 'stopped-reporting',
          severity: onlyOpen ? 'warning' : 'error',
          context: r.context,
          message: `\`${r.context}\` stopped reporting: missing on the ${recent.length} newest ${onlyOpen ? `open PRs, with no merge in ${STALLED_MERGES_DAYS} days or more` : 'merged PRs'} (${prList(recent.map((x) => x.p.number))}) after reporting on ${reportedBefore} older ones.${
            best ? ` \`${best.n}\` first appears on exactly those PRs and is not required — the job was probably renamed and fell out of the required list.` : ''
          }`,
          evidence: recent.map((x) => x.p.number),
          hint: best ? `Replace \`${r.context}\` with \`${best.n}\` in ${r.sources.map(sourceLabel).join(' and ')}.` : undefined,
        });
      } else if (mergedBy.missing.length) findings.push(mergedWithout(r.context, mergedBy.missing));
    }

    if (by.skipped.length)
      findings.push({
        code: 'skipped-as-success',
        severity: 'error',
        context: r.context,
        message: `\`${r.context}\` concluded "skipped" on ${by.skipped.length} of ${pulls.length} PRs (${prList(by.skipped.slice(0, 10))}). GitHub counts skipped as passing, so those PRs can merge (or merged) without the check running.`,
        evidence: by.skipped.slice(0, 10),
      });
    if (by.neutral.length)
      findings.push({
        code: 'neutral-as-success',
        severity: 'warning',
        context: r.context,
        message: `\`${r.context}\` concluded "neutral" on ${prList(by.neutral.slice(0, 10))}; neutral satisfies a required check.`,
        evidence: by.neutral.slice(0, 10),
      });
    // A merged PR whose required check failed was a bypass (or the check was not required then).
    if (mergedBy.failed.length)
      findings.push({
        code: 'merged-with-failure',
        severity: 'warning',
        context: r.context,
        message: `\`${r.context}\` had failed on ${prList(mergedBy.failed.slice(0, 10))} when they merged (bypass, or the check was not required then)`,
        evidence: mergedBy.failed.slice(0, 10),
      });
    // Still running (or never finished: GitHub marks it stale after 14 days) when the PR merged.
    const notDone = new Set([...mergedBy.pending, ...mergedBy.stale]);
    const pendingAtMerge = obs.map((x) => x.p.number).filter((n) => notDone.has(n));
    if (pendingAtMerge.length)
      findings.push({
        code: 'merged-while-pending',
        severity: 'warning',
        context: r.context,
        message: `\`${r.context}\` had not finished on ${prList(pendingAtMerge.slice(0, 10))} when they merged (bypass, admin merge, or the check was not required then)`,
        evidence: pendingAtMerge.slice(0, 10),
      });
    if (appMismatch.length)
      findings.push({
        code: 'app-mismatch',
        severity: 'error',
        context: r.context,
        message: `\`${r.context}\` is pinned to app ${pins.join('/')}, but the runs come from ${[...new Set(appMismatch.map((x) => x.app))].join(', ')} (${prList(appMismatch.map((x) => x.pr).slice(0, 10))}); a check from another app does not satisfy the rule`,
      });

    findings.push(...staticFindings(r.context, producers, workflows, s.branch, requiredNames, s.repository, seen, pulls.length, opaqueJobs));
  }

  // Required workflows (ruleset "workflows" rule) whose file is gone.
  for (const rule of s.branchRules) {
    if (rule.type !== 'workflows') continue;
    for (const w of rule.parameters?.workflows ?? [])
      if (s.workflows.length && !s.workflows.some((f) => f.path === w.path) && rule.ruleset_source === s.repository)
        findings.push({
          code: 'required-workflow-missing',
          severity: 'error',
          message: `ruleset requires workflow \`${w.path}\`, which is not in \`${s.branch}\``,
        });
  }

  for (const f of findings) f.hint ??= FIXES[f.code];

  return {
    repository: s.repository,
    branch: s.branch,
    collectedAt: s.collectedAt,
    ok: !findings.some((f) => f.severity === 'error'),
    required,
    tallies,
    findings,
    sampledPulls: merged.map((p) => p.number),
    sampledOpen: pulls.filter((p) => !isMerged(p)).map((p) => p.number),
    notes: [...(s.notes ?? []), ...lateFailures, ...(pulls.length ? [] : ['no merged or open PRs into this branch were found; only static checks ran'])],
  };
}

function staticFindings(
  context: string,
  producers: JobInfo[],
  workflows: WorkflowInfo[],
  branch: string,
  requiredSet: Set<string>,
  repository: string,
  seen: number,
  sampled: number,
  opaqueJobs: JobInfo[],
): Finding[] {
  const out: Finding[] = [];
  const wfByPath = new Map(workflows.map((w) => [w.path, w]));
  const wfOf = (j: JobInfo) => wfByPath.get(j.workflow)!;
  // Same-named jobs can both report on one commit, so one can stand in for the other, unless one
  // runs only in the merge queue and the other never does: those commits never overlap.
  const queueOnly = (w: WorkflowInfo) => w.events.length > 0 && w.events.every((e) => e === 'merge_group');
  const inQueue = (w: WorkflowInfo) => w.events.includes('merge_group');
  const disjoint = (a: WorkflowInfo, b: WorkflowInfo) => (queueOnly(a) && !inQueue(b)) || (queueOnly(b) && !inQueue(a));
  const clashing = producers.some((a, i) => producers.slice(i + 1).some((b) => a.workflow !== b.workflow && !disjoint(wfOf(a), wfOf(b))));
  // A PR-stage trigger that reaches this branch. The merge queue is another stage: its run does not report on PR commits.
  const reachesPrs = (w: WorkflowInfo) => w.prTriggers.filter((t) => t.event !== 'merge_group' && branchAllowed(t, branch));
  const onPrs = (j: JobInfo) => reachesPrs(wfOf(j)).length > 0;
  const onEveryPr = (j: JobInfo) => reachesPrs(wfOf(j)).some((t) => !t.paths && !t.pathsIgnore);
  // Another job can report the check when this one does not run, so a filter on one proves nothing.
  const unfilteredProducer = producers.some(onEveryPr);
  // A job whose name is an expression may be that other job, when the check reports on most PRs.
  const opaqueAlternative = opaqueJobs.some(onEveryPr) && sampled > 0 && seen / sampled >= 0.5;
  // Two filtered workflows with one name are the usual no-op pattern: their filters are meant to
  // cover every path. When the check also reported on every sampled PR, that is what they do.
  const coveredByFilters = new Set(producers.filter(onPrs).map((j) => j.workflow)).size > 1 && sampled >= 5 && seen === sampled;
  if (clashing)
    out.push({
      code: 'ambiguous-name',
      severity: 'warning',
      context,
      message: `\`${context}\` is produced by ${producers.length} jobs in different workflows (${producers.map((j) => `${j.workflow}#${j.id}`).join(', ')}); whichever reports last decides the check`,
      hint: 'Give each job a unique name.',
    });
  for (const job of producers) {
    const wf = wfByPath.get(job.workflow)!;
    const where = `\`${job.workflow}\` job \`${job.id}\``;
    if (!wf.prTriggers.length) {
      if (producers.some(onPrs)) continue;
      out.push({
        code: 'not-on-pull-request',
        severity: 'error',
        context,
        message: `\`${context}\` comes from ${where}, but that workflow has no pull_request / pull_request_target / merge_group trigger`,
        hint: 'Add a pull_request trigger (and merge_group if you use a merge queue).',
      });
      continue;
    }
    const filters = filtersOf(wf);
    const pathFiltered = wf.prTriggers.some((t) => t.paths || t.pathsIgnore);
    if (pathFiltered && !unfilteredProducer && !opaqueAlternative && !coveredByFilters)
      out.push({
        code: 'path-filtered',
        severity: 'error',
        context,
        message: `\`${context}\` is required but ${where} only runs on some paths (${filters.filter((f) => f.includes('paths')).map((f) => `\`${f}\``).join('; ')}). PRs outside those paths never get the check and wait on "Expected — Waiting for status to be reported", which teams end up bypassing.`,
              });
    if (!wf.prTriggers.some((t) => branchAllowed(t, branch)))
      out.push({
        code: 'branch-filtered',
        severity: 'error',
        context,
        message: `\`${context}\` is required on \`${branch}\`, but ${where} does not run for PRs into \`${branch}\` (${filters.filter((f) => f.includes('branches')).map((f) => `\`${f}\``).join('; ')})`,
      });
    const cond = job.if;
    if (cond && !ALWAYS.test(cond) && conditionOnPr(cond, wf.prTriggers.map((t) => t.event), repository) !== true)
      out.push({
        code: 'conditional-job',
        severity: 'warning',
        context,
        message: `${where} has \`if: ${cond}\`; when it is false the job reports "skipped", which satisfies the required check`,
        hint: 'Move the condition into the steps, or make sure every skip is intended.',
      });
    if (job.needs.length && !(cond && ALWAYS.test(cond))) {
      const needed = wf.jobs.filter((j) => job.needs.includes(j.id));
      // An opaque job might produce a required check, so it cannot be called unguarded.
      const unguarded = needed.filter((j) => !j.opaque && !producesRequired(j, requiredSet));
      if (unguarded.length)
        out.push({
          code: 'skips-when-needs-fail',
          severity: 'warning',
          context,
          message: `${where} needs ${unguarded.map((j) => j.id).join(', ')} (not required themselves). If one fails, \`${context}\` is skipped and still counts as passing.`,
          hint: "Add `if: always()` and fail the job when `contains(needs.*.result, 'failure')`, or require the needed jobs too.",
        });
    }
  }
  return out;
}

function producesRequired(j: JobInfo, required: Set<string>): boolean {
  return [...required].some((r) => j.pattern.test(r));
}
