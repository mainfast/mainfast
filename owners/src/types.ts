export type Severity = 'error' | 'warning';

/**
 * Which CODEOWNERS a finding is about. `current`: the file GitHub uses now (the default branch
 * in an audit, the PR's base branch on a pull request). `proposed`: the version a pull request
 * would merge, linted separately so mistakes show before merge.
 */
export type Scope = 'current' | 'proposed';

export interface Finding {
  code: string;
  severity: Severity;
  /** Detail. Our own text uses `backticks` around paths, patterns and owners (rendered with mdCell). */
  message: string;
  /** One-line fix. */
  hint?: string;
  scope: Scope;
  /** CODEOWNERS line, when the finding is about one. */
  line?: number;
  owner?: string;
  paths?: string[];
  /** Proposed-file finding that is already on the base branch (not introduced by this PR): never an error. */
  preexisting?: boolean;
}

export interface OwnerStatus {
  owner: string;
  kind: 'user' | 'team' | 'email';
  valid: boolean;
  /** False when the check needed something the token cannot read (org teams, members). */
  verified: boolean;
  /** Finding code when invalid (or `email-owner`). */
  code?: string;
  problems: string[];
  /** PRs reviewed in the dormancy window, when checked. */
  reviews?: number;
}

/** Whether org membership and team checks ran. */
export type OrgChecks =
  | 'enabled' // org-token (or the CLI token) can read org members and teams
  | 'needs-token' // org-owned repo, no org-token: membership and teams not checked (one note)
  | 'refused' // an org-token was given but GitHub refused it
  | 'not-org' // user-owned repository: no org to check
  | 'offline' // no API at all (CLI lint)
  | 'untrusted-pr'; // PR from a fork or an author without write access: public lookups only

export interface DormancyInfo {
  /** Days; 0 = off (always off on pull requests). */
  days: number;
  /** Search API requests made. */
  searches: number;
  /** Owners left unchecked because the per-run search cap or the rate limit was hit. */
  skipped: number;
  capped: boolean;
}

export interface OwnersReport {
  repository: string;
  mode: 'pr' | 'audit';
  pr?: number;
  /** Ref the current CODEOWNERS was read at (default branch, or the PR's base branch). */
  ref?: string;
  codeownersPath?: string;
  /** PR mode, when the PR edits CODEOWNERS: where the proposed file lives and at which commit. */
  proposed?: { path?: string; ref?: string };
  ok: boolean;
  findings: Finding[];
  /** PR mode: changed files with no working owner under the base CODEOWNERS. Audit mode: every unowned tracked file. */
  unowned: string[];
  /** PR mode: unowned paths that the PR's own CODEOWNERS would own once merged. */
  ownedAfterMerge: string[];
  checkedFiles: number;
  owners: OwnerStatus[];
  orgChecks: OrgChecks;
  dormancy: DormancyInfo;
  /** Things the run could not check, once each (shown in the summary, never a failure). */
  notes: string[];
}
