import type { RequiredCheck } from "@mainfast/shared/required-checks";

// Normalised inputs and outputs. GitHub payloads are mapped into these in github/collect.ts,
// and the local git path (diff/git.ts) produces the same shapes, so every analyser is pure.

export type Severity = "fail" | "warn" | "off";

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  authorLogin: string;
  authorType: string; // "User" | "Bot" | "Organization"
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  labels: string[];
  htmlUrl?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName?: string;
  committerEmail?: string;
  /** GitHub login of the commit author, when GitHub could link one. */
  authorLogin?: string;
  authorType?: string;
}

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export interface FileChange {
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file. Missing when GitHub truncates large or binary diffs. */
  patch?: string;
}

export interface CheckRunInfo {
  id?: number;
  name: string;
  headSha: string;
  status: string; // queued | in_progress | completed | waiting | requested | pending
  conclusion: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required | stale
  appSlug?: string;
  /** GitHub App id of the app that created the run (a required check can be pinned to one). */
  appId?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  outputTitle?: string | null;
  outputSummary?: string | null;
  detailsUrl?: string | null;
}

export interface CommitStatusInfo {
  context: string;
  state: string; // error | failure | pending | success
  description?: string | null;
  targetUrl?: string | null;
  updatedAt?: string;
}

export interface ChecksSnapshot {
  sha: string;
  checkRuns: CheckRunInfo[];
  statuses: CommitStatusInfo[];
  /** What could not be read (e.g. commit statuses without `statuses: read`). */
  notes?: string[];
}

export interface RequiredChecks {
  contexts: string[];
  /** Where the list came from, for the evidence card. */
  sources: string[];
  /** Per context: which layer requires it and the app it is pinned to (shared resolution). */
  checks?: RequiredCheck[];
  /** Sources the token could not read (e.g. classic protection needs administration: read). */
  notes?: string[];
}

export interface PrSnapshot {
  repo: string; // owner/name
  pr: PullRequestInfo;
  commits: CommitInfo[];
  files: FileChange[];
  /** Check runs + statuses for pr.headSha. Absent in offline (local git) mode. */
  headChecks?: ChecksSnapshot;
  /** Check runs + statuses for earlier PR commits, newest first, to explain stale evidence. */
  previousChecks?: ChecksSnapshot[];
  required?: RequiredChecks;
  /** git-ai authorship notes (refs/notes/ai) keyed by commit sha. */
  gitAiNotes?: Record<string, string>;
  coverage?: CoverageReport;
  /** Why coverage is not used (fork PR: the report comes from the fork's own CI). Set means: no coverage findings. */
  coverageUnavailable?: string;
}

export interface LineCoverage {
  /** line number -> hit count */
  lines: Map<number, number>;
}

export interface CoverageReport {
  format: "lcov" | "cobertura";
  files: Map<string, LineCoverage>;
}

export interface Flag {
  id: FlagId;
  severity: Exclude<Severity, "off">;
  title: string;
  detail: string;
  /** Optional per-line locations, used for check-run annotations. */
  locations?: Array<{ path: string; line?: number; message: string }>;
}

export const FLAG_IDS = [
  "tests_not_run_on_head",
  "tests_failed",
  "tests_skipped",
  "tests_empty",
  "required_check_missing",
  "required_check_skipped",
  "required_check_failed",
  "coverage_below_threshold",
  "coverage_missing",
  "touched_workflows",
  "touched_codeowners",
  "touched_lockfiles",
  "touched_tests",
  "touched_test_config",
  "touched_policy",
  "tests_deleted",
  "tests_removed",
  "assertions_dropped",
  "assertions_commented_out",
  "skip_added",
  "focus_added",
  "trivial_assertion_added",
  "claim_tests_added_unbacked",
  "claim_tests_pass_unbacked",
  "diff_too_large",
  "secret_like_string",
  "diff_unanalyzed",
] as const;

export type FlagId = (typeof FLAG_IDS)[number];
