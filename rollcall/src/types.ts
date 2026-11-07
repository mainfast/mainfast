// Shapes follow the GitHub REST docs (API version 2022-11-28); only fields the audit reads are typed.

// Requirement shapes and resolution live in @mainfast/shared/required-checks (shared with Evidence).
import type { BranchRule, ClassicRequiredChecks, RequiredCheck, Ruleset } from '@mainfast/shared/required-checks';
export type { BranchRule, ClassicRequiredChecks, RequiredCheck, RequiredSource, Ruleset } from '@mainfast/shared/required-checks';

export type CheckStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | null;

/** Item of GET /repos/{o}/{r}/commits/{ref}/check-runs -> check_runs[]. */
export interface CheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
  started_at?: string | null;
  completed_at?: string | null;
  app?: { id: number; slug?: string } | null;
}

/** Item of GET /repos/{o}/{r}/commits/{ref}/status -> statuses[]. */
export interface CommitStatus {
  context: string;
  state: 'error' | 'failure' | 'pending' | 'success';
  updated_at?: string;
}

export interface PullObservation {
  number: number;
  title: string;
  headSha: string;
  /** merged (default when absent, for older snapshots) or still open. */
  state?: 'merged' | 'open';
  mergedAt?: string | null;
  updatedAt?: string | null;
  checkRuns: CheckRun[];
  statuses: CommitStatus[];
}

export interface WorkflowFile {
  path: string;
  text: string;
}

/** Everything the audit needs, collected once (from the API, or a saved JSON snapshot). */
export interface Snapshot {
  repository: string;
  branch: string;
  /** The repository's default branch, for rulesets aimed at `~DEFAULT_BRANCH`. Unknown counts as a match. */
  defaultBranch?: string;
  collectedAt: string;
  classic: ClassicRequiredChecks | null;
  /** Active rules for the branch, as returned by rules/branches. */
  branchRules: BranchRule[];
  /** Every ruleset on the repo (including parents), with rules, to see evaluate/disabled ones. */
  rulesets: Ruleset[];
  /** Newest first. */
  pulls: PullObservation[];
  workflows: WorkflowFile[];
  /** Head commit of the audited branch (where the check run goes). */
  headSha?: string;
  /** When that commit landed, if known. */
  headCommittedAt?: string;
  /** What could not be read (missing permission, 404) and was treated as empty. */
  notes?: string[];
}

export type Severity = 'error' | 'warning';

export interface Finding {
  code: string;
  severity: Severity;
  context?: string;
  message: string;
  /** PR numbers that show it. */
  evidence?: number[];
  hint?: string;
}

export interface CheckTally {
  context: string;
  sources: string[];
  sampled: number;
  passed: number;
  failed: number;
  skipped: number;
  neutral: number;
  /** Not completed (or concluded stale). */
  pending: number;
  missing: number;
  /** Of `sampled`, how many were open PRs. */
  open: number;
  producers: string[];
}

export interface AuditReport {
  repository: string;
  branch: string;
  collectedAt: string;
  ok: boolean;
  required: RequiredCheck[];
  tallies: CheckTally[];
  findings: Finding[];
  /** Merged PRs sampled, newest first. */
  sampledPulls: number[];
  /** Open PRs sampled (only those whose head reported at least one check). */
  sampledOpen: number[];
  notes: string[];
}
