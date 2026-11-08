// Did tests actually run on THIS head sha, and did every required check really pass?
import { CHECK_NAME } from "../constants.ts";
import { nameMatcher, type EvidencePolicy } from "../config.ts";
import type { CheckRunInfo, ChecksSnapshot, CommitStatusInfo, PrSnapshot } from "../types.ts";
import type { Finding } from "./finding.ts";
import { checkRunState, classifyRequired, commitStatusState, latestBy, runOrder, type CheckState, type CommitChecks } from "@mainfast/shared/required-checks";

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Check-state classification and "worst state wins" are shared with Mainfast Rollcall
// (@mainfast/shared/required-checks), so both read a check run or status the same way.
export type { CheckState };

export interface CheckView {
  name: string;
  kind: "check_run" | "status";
  state: CheckState;
  url?: string | null;
  summary?: string | null;
}

export interface RequiredView {
  context: string;
  state: CheckState;
  /** False when the requirement is pinned to an app and the latest run came from another app. */
  appSatisfied: boolean;
}

export interface ChecksEval {
  evaluated: boolean;
  headSha: string;
  all: CheckView[];
  tests: CheckView[];
  /** `skipped`: no test check failed or is running, but at least one concluded skipped. */
  testsState: "passed" | "failed" | "skipped" | "pending" | "none" | "empty";
  /** An earlier PR commit where test checks did run, when none ran on head. */
  staleTestsOn?: { sha: string; tests: CheckView[] };
  required: RequiredView[];
  requiredSources: string[];
  /** Check / requirement sources the token could not read. */
  notes: string[];
  pending: boolean;
  findings: Finding[];
}

function keeper(policy: EvidencePolicy): (name: string) => boolean {
  const ignored = policy.ignoreChecks.map(nameMatcher);
  return (name) => name !== CHECK_NAME && !ignored.some((m) => m(name));
}

/** Latest check run per name and latest status per context, minus our own check and ignored ones. */
export function viewsFor(snap: ChecksSnapshot, policy: EvidencePolicy): CheckView[] {
  const keep = keeper(policy);
  const runs = latestBy(
    snap.checkRuns.filter((r) => r.headSha === snap.sha && keep(r.name)),
    (r) => r.name,
    runOrder,
  );
  const statuses = latestBy(
    snap.statuses.filter((s) => keep(s.context)),
    (s) => s.context,
    (s) => s.updatedAt ?? "",
  );
  return [
    ...runs.map<CheckView>((r) => ({
      name: r.name,
      kind: "check_run",
      state: checkRunState(r.status, r.conclusion),
      url: r.detailsUrl,
      summary: [r.outputTitle, r.outputSummary].filter(Boolean).join(" — ") || null,
    })),
    ...statuses.map<CheckView>((s) => ({ name: s.context, kind: "status", state: commitStatusState(s.state), url: s.targetUrl, summary: s.description })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

const EMPTY_RUN = /\b(no tests? (were )?(found|ran|run|executed|collected)|0 tests?\b|collected 0 items|tests?:\s*0 total|ran 0 tests|no test files found|\[no test files\])/i;

function testsStateOf(tests: CheckView[]): ChecksEval["testsState"] {
  if (tests.length === 0) return "none";
  if (tests.some((t) => t.state === "pending")) return "pending";
  const notOk = tests.filter((t) => t.state !== "success");
  if (notOk.length && notOk.every((t) => t.state === "skipped")) return "skipped";
  if (notOk.length) return "failed";
  if (tests.every((t) => t.summary && EMPTY_RUN.test(t.summary))) return "empty";
  return "passed";
}

export function evaluateChecks(snap: PrSnapshot, policy: EvidencePolicy): ChecksEval {
  const headSha = snap.pr.headSha;
  const findings: Finding[] = [];
  if (!snap.headChecks) {
    return {
      evaluated: false,
      headSha,
      all: [],
      tests: [],
      testsState: "none",
      required: [],
      requiredSources: [],
      notes: [],
      pending: false,
      findings,
    };
  }
  // Only ever trust check data for the current head; anything else is stale evidence.
  const head: ChecksSnapshot = snap.headChecks.sha === headSha ? snap.headChecks : { sha: headSha, checkRuns: [], statuses: [] };
  const all = viewsFor(head, policy);
  const isTest = policy.testChecks.map(nameMatcher);
  const tests = all.filter((c) => isTest.some((m) => m(c.name)));
  const testsState = testsStateOf(tests);
  const short = headSha.slice(0, 7);

  let staleTestsOn: ChecksEval["staleTestsOn"];
  if (testsState === "none") {
    for (const prev of snap.previousChecks ?? []) {
      const pt = viewsFor(prev, policy).filter((c) => isTest.some((m) => m(c.name)));
      if (pt.length) {
        staleTestsOn = { sha: prev.sha, tests: pt };
        break;
      }
    }
    findings.push({
      id: "tests_not_run_on_head",
      title: "No test check ran on the head commit",
      detail: staleTestsOn
        ? `Tests ran on earlier commit ${staleTestsOn.sha.slice(0, 7)} (${staleTestsOn.tests.map((t) => `${t.name}: ${t.state}`).join(", ")}) but not on head ${short}. Evidence from an earlier commit does not cover the code being merged.`
        : `No check run or status on ${short} matches the \`test_checks\` patterns (${policy.testChecks.join(", ")}).`,
    });
  } else if (testsState === "failed") {
    const bad = tests.filter((t) => t.state !== "success");
    findings.push({
      id: "tests_failed",
      title: "Test checks did not pass on the head commit",
      detail: bad.map((t) => `${t.name}: ${t.state}`).join(", "),
    });
  } else if (testsState === "skipped") {
    const skipped = tests.filter((t) => t.state === "skipped");
    const ran = tests.length - skipped.length;
    findings.push({
      id: "tests_skipped",
      title: ran ? "Some test checks were skipped on the head commit" : "Every test check was skipped on the head commit",
      detail: `${skipped.map((t) => `${t.name}: skipped`).join(", ")} — ${ran ? `${plural(ran, "other test check")} passed, ` : "nothing was tested on this commit; "}a skipped job (an \`if:\` or path filter) verifies nothing.`,
    });
  } else if (testsState === "empty") {
    findings.push({
      id: "tests_empty",
      title: "Test checks passed but ran zero tests",
      detail: tests.map((t) => `${t.name}: "${t.summary}"`).join("; "),
    });
  }

  const contexts = [...new Set([...(snap.required?.contexts ?? []), ...policy.requiredChecks])].filter((c) => c !== CHECK_NAME);
  const requiredSources = [...(snap.required?.sources ?? []), ...(policy.requiredChecks.length ? [".mainfast.yml required_checks"] : [])];
  // What head reported for each required context: the shared classification (latest run per name
  // on this sha, worst of run + status, app pins honoured), the same Mainfast Rollcall uses.
  const keep = keeper(policy);
  const commit: CommitChecks = {
    sha: headSha,
    runs: head.checkRuns.filter((r) => keep(r.name)),
    statuses: head.statuses.filter((s) => keep(s.context)),
  };
  const sourcesFor = new Map((snap.required?.checks ?? []).map((c) => [c.context, c.sources]));
  const required: RequiredView[] = contexts.map((context) => {
    const res = classifyRequired(context, commit, sourcesFor.get(context) ?? []);
    return { context, state: res.appSatisfied ? res.state : "missing", appSatisfied: res.appSatisfied };
  });
  const missing = required.filter((r) => r.state === "missing");
  const skipped = required.filter((r) => r.state === "skipped" || r.state === "neutral" || r.state === "stale");
  const failed = required.filter((r) => ["failure", "timed_out", "cancelled", "action_required"].includes(r.state));
  if (missing.length)
    findings.push({
      id: "required_check_missing",
      title: "Required check never reported on the head commit",
      detail: `${missing.map((r) => (r.appSatisfied ? r.context : `${r.context} (reported by a different app than the one the rule requires)`)).join(", ")} — no check under that name that satisfies the rule ran on ${short}. Usual causes: a renamed job, a path filter, a removed workflow, or another app posting the name.`,
    });
  if (skipped.length)
    findings.push({
      id: "required_check_skipped",
      title: "Required check was skipped or neutral",
      detail: `${skipped.map((r) => `${r.context}: ${r.state}`).join(", ")} — GitHub treats skipped and neutral as passing for branch protection, but nothing was verified.`,
    });
  if (failed.length)
    findings.push({
      id: "required_check_failed",
      title: "Required check failed",
      detail: failed.map((r) => `${r.context}: ${r.state}`).join(", "),
    });

  const pending = testsState === "pending" || required.some((r) => r.state === "pending");
  return { evaluated: true, headSha, all, tests, testsState, staleTestsOn, required, requiredSources, notes: [...(snap.headChecks.notes ?? []), ...(snap.required?.notes ?? [])], pending, findings };
}
