// The checks. Two modes:
//
// - audit (schedule / workflow_dispatch): the default branch's CODEOWNERS against the whole tree
//   and the GitHub API: syntax, what GitHub itself rejects, every owner, unowned files, dead and
//   shadowed patterns, dormant owners.
// - pr: the changed files judged with the BASE branch's CODEOWNERS (the one GitHub uses to
//   request reviews), and only the owners that decide them. When the PR edits CODEOWNERS, the
//   PR's version is linted on its own (scope `proposed`) so its mistakes show before merge.
//   Dormancy is never checked on a PR.
import { CODEOWNERS_LOCATIONS, MAX_CODEOWNERS_BYTES, parseCodeowners, ruleFor, type Codeowners, type Owner, type Rule } from './codeowners.js';
import type { CodeownersFile, OwnersApi, PrFile, RepoPermission } from './api.js';
import { DEFAULT_CONFIG, type OwnersConfig } from './config.js';
import { matchesAny } from '@mainfast/shared/glob';
import type { Finding, OrgChecks, OwnersReport, OwnerStatus, Scope } from './types.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface ProposedInput {
  /** Commit the proposed file was read at (the PR head). */
  ref?: string;
  /** The PR's CODEOWNERS; undefined when the PR removes the last one. */
  codeowners?: CodeownersFile;
  /** Tracked files at the PR head (for dead and shadowed patterns). */
  files: string[];
  truncated?: boolean;
}

export interface OwnersInput {
  repository: string;
  /** Ref `codeowners` was read at (default branch, or the PR's base branch). */
  ref?: string;
  /** The CODEOWNERS GitHub uses now, or undefined when the repository has none. */
  codeowners?: CodeownersFile;
  /** Audit: every tracked file at `ref`. Unused in PR mode. */
  files: string[];
  /** The tree listing was truncated by the API (dead/shadowed patterns are then skipped). */
  truncated?: boolean;
  /**
   * PR mode: the PR's changed files, and its CODEOWNERS when it edits one. `trusted`: same-repo PR
   * by an OWNER / MEMBER / COLLABORATOR. Anything else (default) gets public lookups only: the
   * output of a PR run (comment, job summary, annotations) is readable by the PR author, who could
   * otherwise list arbitrary @users / @org/teams in CODEOWNERS and read private org membership,
   * secret-team existence or repository access back from it.
   */
  pr?: { number: number; files: PrFile[]; proposed?: ProposedInput; trusted?: boolean };
  api?: OwnersApi;
  config?: OwnersConfig;
  now?: Date;
  /** Extra notes from loading (shown once in the summary). */
  notes?: string[];
}

/** One-line fix per finding code (README lists the same). */
export const FIXES: Record<string, string> = {
  'unowned-files': 'Add a CODEOWNERS line for these paths (see the suggested lines), or list them under `owners.ignore`.',
  'unknown-user': 'The account was deleted or renamed: put the current login or a team in its place.',
  'owner-left-org': 'Remove the owner or replace them with a current member or team.',
  'owner-no-write': 'Give the owner write access (directly or through a team), or replace them; GitHub skips owners without write.',
  'team-not-found': 'Fix the slug (as in the team URL, `@org/team-slug`) or create the team.',
  'team-no-write': 'Give the team Write on this repository (Settings → Collaborators and teams), or use another team.',
  'team-wrong-org': 'Use a team of the organization that owns this repository.',
  'rule-without-valid-owner': 'Add at least one owner with write access to the line, or delete the line if the paths should be unowned.',
  'github-error': 'Fix the line as GitHub suggests; the CODEOWNERS file view on GitHub shows the same error.',
  'invalid-line': 'Rewrite the line without `!`, `[ ]` or `[Section]`; owners are @user, @org/team or an email.',
  'too-large': 'Shrink the file below 3 MB (broader patterns, fewer lines).',
  'no-codeowners': 'Add `.github/CODEOWNERS` with a catch-all line such as `* @org/maintainers`.',
  'pattern-matches-nothing': 'The path was moved or deleted: update the pattern or delete the line.',
  'shadowed-rule': 'The last matching line wins: move the broad line above the specific ones, or delete it.',
  'dormant-owner': 'Confirm they still own this code, or hand the paths to an active owner.',
  'dormant-team': 'Confirm the team still owns this code, or hand the paths to an active team.',
  'email-owner': 'Use the @login instead; an email only works when it is a verified email of an account with write access.',
};

const WRITE: RepoPermission[] = ['admin', 'maintain', 'write'];
const DAY = 86_400_000;
const key = (o: Owner | string) => (typeof o === 'string' ? o : o.raw).toLowerCase();

export function findCodeowners(files: string[]): string | undefined {
  return CODEOWNERS_LOCATIONS.find((p) => files.includes(p));
}

function dirsOf(paths: string[], depth = 2): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split('/');
    const k = parts.length > depth ? `${parts.slice(0, depth).join('/')}/` : parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : p;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** Validates owners against the API, once per owner per run. */
class OwnerChecker {
  readonly statuses = new Map<string, OwnerStatus>();
  usersUnchecked = 0;
  teamsUnchecked = 0;
  permUnknown = 0;
  publicOnly = 0;
  constructor(
    private readonly api: OwnersApi,
    private readonly skip: Set<string>,
    /** Untrusted PR: only GET /users/{u} (public) and static checks; no org, team or permission lookups. */
    private readonly publicMode = false,
  ) {}

  async checkAll(owners: Owner[]): Promise<void> {
    for (const o of owners) if (!this.skip.has(key(o)) && !this.statuses.has(key(o))) this.statuses.set(key(o), await this.check(o));
  }

  private async check(o: Owner): Promise<OwnerStatus> {
    const api = this.api;
    const st: OwnerStatus = { owner: o.raw, kind: o.kind, valid: true, verified: true, problems: [] };
    const bad = (code: string, p: string) => {
      st.valid = false;
      st.code = code;
      st.problems.push(p);
    };
    if (o.kind === 'email') {
      st.verified = false;
      st.code = 'email-owner';
      st.problems.push('email owners cannot be checked through the API');
      return st;
    }
    if (this.publicMode) {
      if (o.kind === 'user' && !(await api.userExists(o.login))) {
        bad('unknown-user', 'account does not exist (deleted or renamed)');
        return st;
      }
      if (o.kind === 'team' && o.org.toLowerCase() !== api.owner.toLowerCase()) {
        bad('team-wrong-org', `team belongs to ${o.org}, but code-owner teams must be in ${api.owner}`);
        return st;
      }
      this.publicOnly++;
      st.verified = false;
      return st;
    }
    const org = await api.orgChecks();
    if (o.kind === 'user') {
      if (!(await api.userExists(o.login))) {
        bad('unknown-user', 'account does not exist (deleted or renamed)');
        return st;
      }
      const perm = await api.userPermission(o.login);
      if (perm === 'unknown') {
        this.permUnknown++;
        st.verified = false;
        return st;
      }
      const member = org === 'enabled' ? await api.isOrgMember(o.login) : undefined;
      if (org === 'needs-token' || org === 'refused') this.usersUnchecked++;
      if (!WRITE.includes(perm)) {
        if (member === false) bad('owner-left-org', `no longer in the ${api.owner} org and has ${perm} access`);
        else if (perm === 'none') bad('owner-no-write', `has no access to ${api.owner}/${api.repo}${org === 'enabled' ? '' : ' (removed, or left the org)'}; code owners need write`);
        else bad('owner-no-write', `has ${perm} access; code owners need write`);
      } else if (member === false) st.problems.push(`not an ${api.owner} org member (outside collaborator with ${perm})`);
      return st;
    }
    if (org === 'not-org' || o.org.toLowerCase() !== api.owner.toLowerCase()) {
      bad('team-wrong-org', `team belongs to ${o.org}, but code-owner teams must be in ${api.owner}${org === 'not-org' ? ' (and this repository is not owned by an organization)' : ''}`);
      return st;
    }
    if (org !== 'enabled') {
      this.teamsUnchecked++;
      st.verified = false;
      return st;
    }
    if (!(await api.teamExists(o.slug))) {
      bad('team-not-found', 'team does not exist');
      return st;
    }
    const perm = await api.teamPermission(o.slug);
    if (!WRITE.includes(perm)) bad('team-no-write', `team has ${perm} access to ${api.owner}/${api.repo}; code-owner teams need write`);
    return st;
  }

  effective = (o: Owner): boolean => this.skip.has(key(o)) || this.statuses.get(key(o))?.valid !== false;
}

/** Each owner's status as findings, with the CODEOWNERS lines that name it. */
function ownerFindings(co: Codeowners, statuses: OwnerStatus[], scope: Scope): Finding[] {
  const out: Finding[] = [];
  for (const st of statuses) {
    const lines = co.rules.filter((r) => r.owners.some((o) => key(o) === key(st.owner))).map((r) => r.line);
    if (!lines.length) continue;
    const where = `${co.path} line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}`;
    if (!st.valid || st.code === 'email-owner')
      out.push({
        code: st.code!,
        severity: st.valid ? 'warning' : 'error',
        scope,
        owner: st.owner,
        line: lines[0],
        message: `\`${st.owner}\` (${where}): ${st.problems.join('; ')}`,
      });
  }
  return out;
}

function syntaxFindings(co: Codeowners, file: CodeownersFile, scope: Scope): Finding[] {
  const out: Finding[] = [];
  if ((file.size ?? Buffer.byteLength(file.text)) > MAX_CODEOWNERS_BYTES)
    out.push({ code: 'too-large', severity: 'error', scope, message: `\`${co.path}\` is over 3 MB; GitHub ignores it entirely` });
  for (const p of co.problems) out.push({ code: 'invalid-line', severity: 'error', scope, line: p.line, message: `\`${co.path}\` line ${p.line}: ${p.message}` });
  return out;
}

async function githubErrorFindings(api: OwnersApi, ref: string | undefined, scope: Scope, notes: string[]): Promise<Finding[]> {
  const errors = await api.codeownersErrors(ref);
  if (!errors) {
    notes.push(`GitHub's own CODEOWNERS check (GET /codeowners/errors) was refused (403); its findings are missing.`);
    return [];
  }
  return errors.map((e) => ({
    code: 'github-error',
    severity: 'error' as const,
    scope,
    line: e.line,
    message: `GitHub: \`${e.path}\` line ${e.line}: ${e.kind}${e.source ? ` in \`${e.source.trim()}\`` : ''}`,
    hint: e.suggestion ? `GitHub suggests: ${e.suggestion}` : undefined,
  }));
}

function ruleWithoutOwnerFindings(co: Codeowners, rules: Rule[], checker: OwnerChecker, scope: Scope): Finding[] {
  return rules
    .filter((r) => r.owners.length && !r.owners.some(checker.effective))
    .map((r) => ({
      code: 'rule-without-valid-owner',
      severity: 'error' as const,
      scope,
      line: r.line,
      message: `\`${co.path}\` line ${r.line} \`${r.pattern}\`: none of ${r.owners.map((o) => `\`${o.raw}\``).join(', ')} can review, so these paths are effectively unowned`,
    }));
}

/** Patterns that match no file, and lines that never decide a file (last match wins). */
export function hygieneFindings(co: Codeowners, files: string[], scope: Scope): Finding[] {
  const out: Finding[] = [];
  const winners = new Set<Rule>();
  const matched = new Set<Rule>();
  for (const f of files) {
    let last: Rule | undefined;
    for (const r of co.rules)
      if (r.regex.test(f)) {
        matched.add(r);
        last = r;
      }
    if (last) winners.add(last);
  }
  for (const r of co.rules) {
    if (!matched.has(r))
      out.push({ code: 'pattern-matches-nothing', severity: 'warning', scope, line: r.line, message: `\`${co.path}\` line ${r.line} \`${r.pattern}\` matches no file in the repository` });
    else if (!winners.has(r)) {
      const dup = co.rules.find((x) => x !== r && x.line > r.line && x.pattern === r.pattern);
      out.push({
        code: 'shadowed-rule',
        severity: 'warning',
        scope,
        line: r.line,
        message: `\`${co.path}\` line ${r.line} \`${r.pattern}\` never applies: every file it matches is claimed by a later line${dup ? ` (the same pattern repeats on line ${dup.line})` : ''}`,
      });
    }
  }
  return out;
}

const ownersIn = (rules: Rule[]) => rules.flatMap((r) => r.owners);

function orgNote(org: OrgChecks, checker: OwnerChecker, api: OwnersApi): string | undefined {
  const { usersUnchecked: u, teamsUnchecked: t } = checker;
  if (!u && !t) return undefined;
  const what = [t ? `${plural(t, "team owner")} (existence and write access)` : '', u ? `org membership of ${plural(u, "user owner")}` : ''].filter(Boolean).join(' and ');
  const why =
    org === 'refused'
      ? `the \`org-token\` was refused (${api.orgRefusal ?? 'error'}); it needs Organization → Members: read for ${api.owner}`
      : 'this needs a token with Organization → Members: read, which GITHUB_TOKEN cannot have; pass one as `org-token`';
  return `Not checked: ${what}: ${why}. Unchecked teams count as valid owners; user owners were still checked for existence and write access.`;
}

/** Dormancy for valid users (and teams with expandTeams), rotated weekly so a capped run covers others next time. */
async function dormancy(statuses: OwnerStatus[], api: OwnersApi, cfg: OwnersConfig, days: number, now: Date, org: OrgChecks): Promise<void> {
  if (days <= 0) return;
  const since = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
  const candidates = statuses.filter((s) => s.valid && s.verified && (s.kind === 'user' || (s.kind === 'team' && cfg.expandTeams && org === 'enabled')));
  const week = Math.floor(now.getTime() / (7 * DAY));
  const start = candidates.length ? week % candidates.length : 0;
  const order = [...candidates.slice(start), ...candidates.slice(0, start)];
  for (const st of order) {
    if (st.kind === 'user') st.reviews = await api.reviewsSince(st.owner.slice(1), since);
    else {
      const members = await api.teamMembers(st.owner.split('/')[1]!.toLowerCase());
      let total = 0;
      let complete = true;
      for (const m of members) {
        const n = await api.reviewsSince(m, since);
        if (n === undefined) complete = false;
        else total += n;
        if (total > 0) break;
      }
      st.reviews = total > 0 || complete ? total : undefined;
    }
  }
}

function dormantFindings(co: Codeowners, statuses: OwnerStatus[], days: number): Finding[] {
  const out: Finding[] = [];
  for (const st of statuses) {
    if (st.reviews !== 0) continue;
    const lines = co.rules.filter((r) => r.owners.some((o) => key(o) === key(st.owner))).map((r) => r.line);
    out.push({
      code: st.kind === 'team' ? 'dormant-team' : 'dormant-owner',
      severity: 'warning',
      scope: 'current',
      owner: st.owner,
      line: lines[0],
      message: `\`${st.owner}\` (${co.path} line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}) has not reviewed a PR in this repository in ${days} days`,
    });
  }
  return out;
}

export async function auditOwners(input: OwnersInput): Promise<OwnersReport> {
  const cfg = input.config ?? DEFAULT_CONFIG;
  const now = input.now ?? new Date();
  const mode: 'pr' | 'audit' = input.pr ? 'pr' : 'audit';
  // Dormancy is a scheduled-audit check only: one search per owner on every PR push would exhaust the search API.
  const days = mode === 'pr' ? 0 : cfg.dormantDays;
  const api = input.api;
  const findings: Finding[] = [];
  const notes = [...(input.notes ?? [])];
  const report: OwnersReport = {
    repository: input.repository,
    mode,
    pr: input.pr?.number,
    ref: input.ref,
    codeownersPath: input.codeowners?.path,
    ok: true,
    findings,
    unowned: [],
    ownedAfterMerge: [],
    checkedFiles: 0,
    owners: [],
    orgChecks: 'offline',
    dormancy: { days, searches: 0, skipped: 0, capped: false },
    notes,
  };
  const skip = new Set(cfg.skipOwners.map(key));
  const untrusted = mode === 'pr' && input.pr!.trusted !== true;
  const checker = api ? new OwnerChecker(api, skip, untrusted) : undefined;
  const effective = (o: Owner) => (checker ? checker.effective(o) : true);

  const targetFiles = input.pr ? input.pr.files.map((f) => f.filename) : input.files.filter((f) => !CODEOWNERS_LOCATIONS.includes(f));
  const needOwners = targetFiles.filter((f) => !matchesAny(f, cfg.ignore));
  report.checkedFiles = needOwners.length;
  const proposedIn = input.pr?.proposed;
  const co = input.codeowners ? parseCodeowners(input.codeowners.text, input.codeowners.path) : undefined;

  // --- the CODEOWNERS GitHub uses now -------------------------------------------------------
  if (!co) {
    report.unowned = needOwners;
    const addsFirst = Boolean(proposedIn?.codeowners);
    findings.push({
      code: 'no-codeowners',
      severity: mode === 'pr' && cfg.requireOwners && !addsFirst ? 'error' : 'warning',
      scope: 'current',
      message: `no CODEOWNERS file${input.ref ? ` on \`${input.ref}\`` : ''} (looked in ${CODEOWNERS_LOCATIONS.map((l) => `\`${l}\``).join(', ')})${
        addsFirst ? `; this PR adds \`${proposedIn!.codeowners!.path}\`, which takes effect once merged` : ''
      }`,
    });
  } else {
    if (mode === 'audit') {
      findings.push(...syntaxFindings(co, input.codeowners!, 'current'));
      if (api) findings.push(...(await githubErrorFindings(api, input.ref, 'current', notes)));
    }
    // Audit: every rule. PR: the rules that decide a changed file.
    const relevant = mode === 'audit' ? co.rules : [...new Set(needOwners.map((f) => ruleFor(co, f)).filter((r): r is Rule => !!r))];
    if (checker) {
      await checker.checkAll(ownersIn(relevant));
      const sts = [...new Set(ownersIn(relevant).map(key))].map((k) => checker.statuses.get(k)).filter((s): s is OwnerStatus => !!s);
      findings.push(...ownerFindings(co, sts, 'current'));
      findings.push(...ruleWithoutOwnerFindings(co, relevant, checker, 'current'));
    }
    const unowned = needOwners.filter((f) => !(ruleFor(co, f)?.owners ?? []).some(effective));
    report.unowned = unowned;
    if (unowned.length)
      findings.push(
        mode === 'pr'
          ? {
              code: 'unowned-files',
              severity: cfg.requireOwners ? 'error' : 'warning',
              scope: 'current',
              message: `${plural(unowned.length, "changed file")} ${unowned.length === 1 ? "has" : "have"} no code owner in \`${co.path}\` on \`${input.ref ?? 'the base branch'}\` (the file GitHub uses to request reviews)`,
              paths: unowned,
            }
          : {
              code: 'unowned-files',
              severity: 'warning',
              scope: 'current',
              message: `${unowned.length} of ${needOwners.length} tracked files have no code owner; largest gaps: ${dirsOf(unowned)
                .slice(0, 5)
                .map(([d, n]) => `\`${d}\` (${n})`)
                .join(', ')}`,
              paths: unowned.slice(0, 200),
            },
      );
    if (mode === 'audit') {
      if (input.truncated) notes.push('The git tree listing was truncated by the API: dead and shadowed patterns were not checked.');
      else if (input.files.length) findings.push(...hygieneFindings(co, input.files, 'current'));
    }
  }

  // --- the PR's own CODEOWNERS, when it edits one --------------------------------------------
  if (proposedIn) {
    report.proposed = { path: proposedIn.codeowners?.path, ref: proposedIn.ref };
    const pf = proposedIn.codeowners;
    if (!pf) {
      if (co)
        findings.push({
          code: 'no-codeowners',
          severity: 'error',
          scope: 'proposed',
          message: `this PR removes \`${co.path}\`: once merged, no file has a code owner and no review is requested`,
        });
    } else {
      const pco = parseCodeowners(pf.text, pf.path);
      if (co && pco.path !== co.path) notes.push(`This PR makes \`${pco.path}\` the CODEOWNERS file GitHub uses (was \`${co.path}\`).`);
      const baseLines = new Set(co ? [...co.rules.map((r) => r.source), ...co.problems.map((p) => p.source.trim())] : []);
      const baseOwners = new Set(co ? ownersIn(co.rules).map(key) : []);
      const sourceAt = new Map<number, string>([...pco.rules.map((r) => [r.line, r.source] as const), ...pco.problems.map((p) => [p.line, p.source.trim()] as const)]);
      const pFindings: Finding[] = [...syntaxFindings(pco, pf, 'proposed')];
      // GitHub's own errors name owners it cannot resolve ("make sure @org/team exists and has write access"),
      // which would tell an untrusted PR author whether a secret team exists: skipped for them.
      if (api && !untrusted) pFindings.push(...(await githubErrorFindings(api, proposedIn.ref, 'proposed', notes)));
      if (checker) {
        await checker.checkAll(ownersIn(pco.rules));
        const sts = [...new Set(ownersIn(pco.rules).map(key))].map((k) => checker.statuses.get(k)).filter((s): s is OwnerStatus => !!s);
        pFindings.push(...ownerFindings(pco, sts, 'proposed'));
        pFindings.push(...ruleWithoutOwnerFindings(pco, pco.rules, checker, 'proposed'));
      }
      if (proposedIn.truncated) notes.push("The PR head's git tree listing was truncated by the API: dead and shadowed patterns in the PR's CODEOWNERS were not checked.");
      else pFindings.push(...hygieneFindings(pco, proposedIn.files, 'proposed'));
      // A problem the PR did not introduce (same line or same owner on the base) stays visible but never fails the PR.
      for (const f of pFindings) {
        const pre = f.owner ? baseOwners.has(key(f.owner)) : f.line !== undefined ? baseLines.has(sourceAt.get(f.line) ?? '\u0000') : false;
        if (pre && co) {
          f.preexisting = true;
          f.severity = 'warning';
        }
      }
      findings.push(...pFindings);
      report.ownedAfterMerge = report.unowned.filter((f) => (ruleFor(pco, f)?.owners ?? []).some(effective));
    }
  }

  if (checker && api && untrusted) {
    report.orgChecks = 'untrusted-pr';
    if (checker.publicOnly)
      notes.push(
        `This PR comes from a fork or from an author without write access, so owners were checked for public account existence only: team, org membership and repository access checks (and GitHub's own CODEOWNERS errors) would show private org data to the PR author. ${plural(checker.publicOnly, "owner")} count as valid here; the scheduled audit checks them in full.`,
      );
    report.owners = [...checker.statuses.values()];
  } else if (checker && api) {
    report.orgChecks = await api.orgChecks();
    const note = orgNote(report.orgChecks, checker, api);
    if (note) notes.push(note);
    if (checker.permUnknown) notes.push(`Repository permission of ${plural(checker.permUnknown, "user owner")} could not be read (403); they count as valid.`);
    if (co && days > 0) {
      const sts = [...new Set(ownersIn(co.rules).map(key))].map((k) => checker.statuses.get(k)).filter((s): s is OwnerStatus => !!s);
      await dormancy(sts, api, cfg, days, now, report.orgChecks);
      findings.push(...dormantFindings(co, sts, days));
      report.dormancy = api.dormancyInfo(days);
      if (report.dormancy.capped) {
        const total = sts.filter((s) => s.reviews !== undefined).length;
        notes.push(
          `Dormancy checked for ${total} of ${plural(total + report.dormancy.skipped, "owner")}: stopped after ${plural(report.dormancy.searches, "search request")} (${
            api.searchStop ?? `owners.maxSearches is ${cfg.maxSearches}`
          }). The order rotates weekly, so the next runs cover the rest.`,
        );
      }
      if (cfg.expandTeams && report.orgChecks !== 'enabled' && sts.some((s) => s.kind === 'team'))
        notes.push('Team dormancy (`owners.expandTeams`) needs `org-token` to list team members; teams were not checked for dormancy.');
    }
    report.owners = [...checker.statuses.values()];
  }

  for (const f of findings) f.hint ??= FIXES[f.code];
  report.ok = !findings.some((f) => f.severity === 'error');
  return report;
}

export { findCodeowners as locateCodeowners };
