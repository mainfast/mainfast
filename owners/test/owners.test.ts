import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OwnersApi } from '../src/api.js';
import { auditOwners, FIXES, type OwnersInput } from '../src/audit.js';
import { COMMENT_MARKER } from '../src/brand.js';
import { main as cli } from '../src/cli.js';
import { ownersOf, parseCodeowners, patternToRegExp } from '../src/codeowners.js';
import { parseConfig } from '../src/config.js';
import { isTrustedPr } from '../src/load.js';
import { publishComment, RESOLVED_BODY } from '../src/publish.js';
import { codeownersPattern, toMarkdown } from '../src/report.js';
import { GitHub } from '@mainfast/shared/github';
import { mockFetch, type MockRoute } from '@mainfast/shared/mockfetch';
import { acmeRoutes, repoFiles } from './fixtures/api.js';

const CODEOWNERS = readFileSync(new URL('./fixtures/CODEOWNERS', import.meta.url), 'utf8');
const BASE = { path: '.github/CODEOWNERS', text: CODEOWNERS };
const now = new Date('2026-10-27T00:00:00Z');
const HEAD = 'c'.repeat(40);
const perm404 = { status: 404, body: { message: 'Not Found' } };

/** Fixture API. `org: true` gives the API an org client (the org-token); default is GITHUB_TOKEN only. */
function api(extra: Record<string, MockRoute> = {}, o: { org?: boolean; ownerType?: string; maxSearches?: number; sleep?: (ms: number) => Promise<void>; clock?: () => number } = {}) {
  const fetch = mockFetch(acmeRoutes(extra));
  const gh = new GitHub({ token: 't', userAgent: 'test', fetch });
  const org = o.org ? new GitHub({ token: 'org', userAgent: 'test', fetch }) : undefined;
  return { fetch, gh, api: new OwnersApi(gh, 'acme', 'app', { org, ownerType: o.ownerType, maxSearches: o.maxSearches, sleep: o.sleep, clock: o.clock }) };
}
const codes = (r: { findings: Array<{ code: string; owner?: string; line?: number }> }) =>
  r.findings.map((f) => `${f.code}${f.owner ? ` ${f.owner}` : f.line !== undefined ? ` L${f.line}` : ''}`).sort();
const scoped = (r: { findings: Array<{ code: string; scope: string; owner?: string; line?: number; severity: string; preexisting?: boolean }> }, scope: string) =>
  r.findings
    .filter((f) => f.scope === scope)
    .map((f) => `${f.severity} ${f.code}${f.owner ? ` ${f.owner}` : f.line !== undefined ? ` L${f.line}` : ''}${f.preexisting ? ' (pre)' : ''}`)
    .sort();

/** The Markdown with code spans and fenced blocks removed: what GitHub renders as Markdown/HTML. */
function outsideCode(md: string): string {
  return md.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, '').replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
}

describe('CODEOWNERS patterns (GitHub semantics)', () => {
  const cases: Array<[string, string, boolean]> = [
    ['*', 'a/b/c.txt', true],
    ['*.js', 'src/deep/x.js', true],
    ['*.js', 'x.jsx', false],
    ['/build/logs/', 'build/logs/a/b.log', true],
    ['/build/logs/', 'x/build/logs/a.log', false],
    ['docs/*', 'docs/getting-started.md', true],
    ['docs/*', 'docs/build-app/troubleshooting.md', false],
    ['apps/', 'x/apps/y.ts', true],
    ['/docs/', 'docs/a/b.md', true],
    ['**/logs', 'a/b/logs/x.log', true],
    ['**/logs', 'logs/x.log', true],
    ['/scripts/**', 'scripts/a/b.sh', true],
    ['src/**/test', 'src/a/b/test/x.ts', true],
    ['README.md', 'pkg/README.md', true],
    ['/README.md', 'pkg/README.md', false],
    ['\\#notes', '#notes', true],
    ['/my\\ dir/', 'my dir/x', true],
  ];
  it.each(cases)('%s vs %s -> %s', (pattern, path, expected) => {
    expect(patternToRegExp(pattern).test(path)).toBe(expected);
  });

  it('applies the last matching line and treats an owner-less line as unowned', () => {
    const co = parseCodeowners(CODEOWNERS);
    expect(ownersOf(co, 'web/legacy/old.ts').map((o) => o.raw)).toEqual(['@acme/web']);
    expect(ownersOf(co, 'web/generated/schema.ts').map((o) => o.raw)).toEqual(['@acme/web']);
    expect(ownersOf(co, 'api/payments/charge.ts').map((o) => o.raw)).toEqual(['@ghost', '@acme/readers']);
    expect(ownersOf(parseCodeowners('* @a\n/gen/\n'), 'gen/x')).toEqual([]);
  });

  it('reports syntax GitHub does not support', () => {
    const co = parseCodeowners('!/x @a\n[Section] @b\n/y/[ab] @c\n/z @not valid!\n/ok @d # comment\n');
    expect(co.problems.map((p) => p.line)).toEqual([1, 2, 3, 4]);
    expect(co.problems[3]!.message).toContain('`valid!` is not a valid owner');
    expect(co.rules.map((r) => r.pattern)).toEqual(['/z', '/ok']);
    expect(co.rules[1]!.owners.map((o) => o.raw)).toEqual(['@d']);
  });

  it('suggests patterns GitHub reads back as the same path', () => {
    expect(codeownersPattern('/my dir/')).toBe('/my\\ dir/');
    expect(patternToRegExp(codeownersPattern('/my dir/')).test('my dir/a')).toBe(true);
    expect(codeownersPattern('/a\nb/')).toBe('/a\\ b/');
  });
});

describe('audit mode', () => {
  it('with an org-token: finds every planted drift', async () => {
    const { api: a, fetch } = api({}, { org: true });
    const r = await auditOwners({ repository: 'acme/app', ref: 'main', codeowners: BASE, files: repoFiles, api: a, now });
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
    expect(r.orgChecks).toBe('enabled');
    expect(codes(r)).toEqual([
      'dormant-owner @dave',
      'email-owner docs@acme.example',
      'github-error L11',
      'invalid-line L24',
      'owner-left-org @bob',
      'owner-no-write @carol',
      'pattern-matches-nothing L15',
      'rule-without-valid-owner L10',
      'rule-without-valid-owner L11',
      'rule-without-valid-owner L6',
      'rule-without-valid-owner L7',
      // /web/ on line 23 repeats line 5 and swallows the more specific lines above it
      'shadowed-rule L21',
      'shadowed-rule L5',
      'shadowed-rule L6',
      'shadowed-rule L7',
      'team-no-write @acme/readers',
      'team-not-found @acme/gone',
      'team-wrong-org @other/writers',
      'unknown-user @ghost',
      'unowned-files',
    ]);
    expect(r.unowned.sort()).toEqual(['api/payments/charge.ts', 'api/server.ts']);
    const byCode = (c: string) => r.findings.find((f) => f.code === c)!;
    expect(byCode('owner-left-org').message).toContain('no longer in the acme org and has read access');
    expect(byCode('owner-no-write').message).toContain('has triage access');
    expect(r.findings.find((f) => f.code === 'shadowed-rule' && f.line === 5)!.message).toContain('same pattern repeats on line 23');
    // every finding carries a one-line fix
    for (const f of r.findings) expect(f.hint, f.code).toBeTruthy();
    for (const c of new Set(r.findings.map((f) => f.code))) if (c !== 'github-error') expect(FIXES[c], c).toBeTruthy();
    // default dormancy window is 180 days
    expect(byCode('dormant-owner').message).toContain('180 days');
    expect(decodeURIComponent(fetch.calls.find((c) => c.path.startsWith('/search/issues'))!.path)).toContain('updated:>=2026-04-30');
    expect(r.notes).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('with GITHUB_TOKEN only: file checks and public lookups run, org checks become one note', async () => {
    const { api: a, fetch } = api();
    const r = await auditOwners({ repository: 'acme/app', ref: 'main', codeowners: BASE, files: repoFiles, api: a, now });
    expect(fetch.calls.some((c) => c.path.startsWith('/orgs/'))).toBe(false);
    expect(r.orgChecks).toBe('needs-token');
    expect(codes(r)).toEqual([
      'dormant-owner @dave',
      'email-owner docs@acme.example',
      'github-error L11',
      'invalid-line L24',
      'owner-no-write @bob', // left the org, but without Members: read that cannot be told apart
      'owner-no-write @carol',
      'pattern-matches-nothing L15',
      'rule-without-valid-owner L6',
      'rule-without-valid-owner L7',
      'shadowed-rule L21',
      'shadowed-rule L5',
      'shadowed-rule L6',
      'shadowed-rule L7',
      'team-wrong-org @other/writers', // static: no API needed
      'unknown-user @ghost',
    ]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain('Not checked: 4 team owner(s)');
    expect(r.notes[0]).toContain('Members: read');
    expect(r.notes[0]).toContain('`org-token`');
    const md = toMarkdown(r);
    expect(md).toContain('Not checked');
    expect(md.match(/Members: read/g)).toHaveLength(1);
  });

  it('an org-token GitHub refuses: one note with the status, no org calls past the probe', async () => {
    const { api: a, fetch } = api({ 'GET /orgs/acme/teams': { status: 403, body: { message: 'Resource not accessible by personal access token' } } }, { org: true });
    const r = await auditOwners({ repository: 'acme/app', codeowners: BASE, files: repoFiles, api: a, now, config: parseConfig('owners:\n  dormantDays: 0\n') });
    expect(r.orgChecks).toBe('refused');
    expect(fetch.calls.filter((c) => c.path.startsWith('/orgs/')).map((c) => c.path)).toEqual(['/orgs/acme/teams?per_page=1']);
    expect(r.notes[0]).toContain('was refused (403: Resource not accessible by personal access token)');
  });

  it('a user-owned repository: teams cannot own code, no org probe', async () => {
    const { api: a, fetch } = api({}, { org: true, ownerType: 'User' });
    const r = await auditOwners({ repository: 'acme/app', codeowners: { path: 'CODEOWNERS', text: '* @alice @acme/web\n' }, files: ['a'], api: a, now, config: parseConfig('owners:\n  dormantDays: 0\n') });
    expect(r.orgChecks).toBe('not-org');
    expect(codes(r)).toContain('team-wrong-org @acme/web');
    expect(fetch.calls.some((c) => c.path.startsWith('/orgs/'))).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it('caches each owner lookup and skips owners listed in skipOwners', async () => {
    const { api: a, fetch } = api({}, { org: true });
    await auditOwners({ repository: 'acme/app', codeowners: BASE, files: repoFiles, api: a, now, config: parseConfig('owners:\n  skipOwners: ["@ghost"]\n  dormantDays: 0\n') });
    expect(fetch.calls.filter((c) => c.path === '/users/alice')).toHaveLength(1);
    expect(fetch.calls.some((c) => c.path === '/users/ghost')).toBe(false);
    expect(fetch.calls.some((c) => c.path.startsWith('/search/'))).toBe(false);
  });

  it('checks team members for dormancy with expandTeams (org-token only)', async () => {
    const routes = { 'GET /orgs/acme/teams/platform/members': { body: [{ login: 'dave' }] }, 'GET /orgs/acme/teams/web/members': { body: [{ login: 'alice' }] } };
    const input: OwnersInput = { repository: 'acme/app', codeowners: { path: '.github/CODEOWNERS', text: '* @acme/platform\n/web/ @acme/web\n' }, files: ['a', 'web/x'], now, config: parseConfig('owners:\n  expandTeams: true\n') };
    const withOrg = await auditOwners({ ...input, api: api(routes, { org: true }).api });
    expect(codes(withOrg)).toEqual(['dormant-team @acme/platform', 'github-error L11']);
    const without = await auditOwners({ ...input, api: api(routes).api });
    expect(codes(without)).toEqual(['github-error L11']);
    expect(without.notes.join('\n')).toContain('Team dormancy (`owners.expandTeams`) needs `org-token`');
  });

  it('skips dead/shadowed patterns when the tree listing was truncated, and says so', async () => {
    const { api: a } = api();
    const r = await auditOwners({ repository: 'acme/app', codeowners: BASE, files: repoFiles, truncated: true, api: a, now, config: parseConfig('owners:\n  dormantDays: 0\n') });
    expect(codes(r).filter((c) => /pattern|shadowed/.test(c))).toEqual([]);
    expect(r.notes.join('\n')).toContain('truncated');
  });
});

describe('dormancy and the search rate limit (30 a minute)', () => {
  const since = '2026-04-30';
  it('waits for the reset when a response says the quota is spent', async () => {
    const t0 = 1_800_000_000_000;
    const sleep = vi.fn(async () => {});
    const { api: a } = api(
      { 'GET /search/issues': { body: { total_count: 1 }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(t0 / 1000 + 10) } } },
      { sleep, clock: () => t0 },
    );
    expect(await a.reviewsSince('alice', since)).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(await a.reviewsSince('dave', since)).toBe(1);
    expect(sleep).toHaveBeenCalledWith(11_000);
  });

  it('backs off and retries a rate-limit 403, then gives up after two retries', async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const { api: a } = api(
      {
        'GET /search/issues': () =>
          ++n === 1 ? { status: 403, body: { message: 'API rate limit exceeded for installation ID 1.' } } : n === 2 ? { body: { total_count: 3 } } : { status: 429, body: { message: 'You have exceeded a secondary rate limit' } },
      },
      { sleep },
    );
    expect(await a.reviewsSince('alice', since)).toBe(3);
    expect(sleep).toHaveBeenCalledWith(15_000);
    expect(await a.reviewsSince('dave', since)).toBeUndefined();
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(a.searchStop).toContain('after two retries');
    expect(await a.reviewsSince('carol', since)).toBeUndefined(); // stopped: no more requests
    expect(n).toBe(5);
    expect(a.dormancyInfo(180)).toMatchObject({ searches: 5, capped: true, skipped: 2 });
  });

  it('stops instead of waiting longer than a minute for a reset', async () => {
    const t0 = 1_800_000_000_000;
    const sleep = vi.fn(async () => {});
    const { api: a, fetch } = api({ 'GET /search/issues': { body: { total_count: 1 }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(t0 / 1000 + 600) } } }, { sleep, clock: () => t0 });
    await a.reviewsSince('alice', since);
    expect(await a.reviewsSince('dave', since)).toBeUndefined();
    expect(sleep).not.toHaveBeenCalled();
    expect(fetch.calls.filter((c) => c.path.startsWith('/search/'))).toHaveLength(1);
  });

  it('caps the searches per run and notes how many owners were left for the next run', async () => {
    const { api: a, fetch } = api({}, { org: true, maxSearches: 1 });
    const r = await auditOwners({ repository: 'acme/app', codeowners: { path: 'CODEOWNERS', text: '* @alice @dave\n' }, files: ['a'], api: a, now, config: parseConfig('owners:\n  maxSearches: 1\n') });
    expect(fetch.calls.filter((c) => c.path.startsWith('/search/'))).toHaveLength(1);
    expect(r.dormancy).toMatchObject({ days: 180, searches: 1, skipped: 1, capped: true });
    expect(r.notes.join('\n')).toContain('Dormancy checked for 1 of 2 owner(s)');
    expect(r.notes.join('\n')).toContain('owners.maxSearches is 1');
  });

  it('dormantDays: 0 turns it off', async () => {
    const { api: a, fetch } = api();
    await auditOwners({ repository: 'acme/app', codeowners: BASE, files: repoFiles, api: a, now, config: parseConfig('owners:\n  dormantDays: 0\n') });
    expect(fetch.calls.some((c) => c.path.startsWith('/search/'))).toBe(false);
  });
});

describe('pr mode', () => {
  const prFiles = [
    { filename: 'web/app.ts', status: 'modified' },
    { filename: 'api/server.ts', status: 'modified' },
    { filename: 'api/payments/charge.ts', status: 'added' },
    { filename: 'tools/new-script.sh', status: 'added' },
  ];

  it("judges changed files with the base CODEOWNERS and validates only the owners that decide them; no dormancy", async () => {
    const { api: a, fetch } = api({}, { org: true });
    const r = await auditOwners({
      repository: 'acme/app',
      ref: 'main',
      codeowners: { path: '.github/CODEOWNERS', text: CODEOWNERS.replace('*                       @acme/platform', '') },
      files: [],
      pr: { number: 7, files: prFiles, trusted: true },
      api: a,
      now,
    });
    expect(r.unowned).toEqual(['api/server.ts', 'api/payments/charge.ts', 'tools/new-script.sh']);
    expect(codes(r)).toEqual([
      'rule-without-valid-owner L10',
      'rule-without-valid-owner L11',
      'team-no-write @acme/readers',
      'team-not-found @acme/gone',
      'unknown-user @ghost',
      'unowned-files',
    ]);
    expect(r.proposed).toBeUndefined();
    expect(fetch.calls.some((c) => c.path.includes('/users/bob'))).toBe(false);
    expect(fetch.calls.some((c) => c.path.startsWith('/search/'))).toBe(false); // never on a PR
    expect(fetch.calls.some((c) => c.path.includes('/codeowners/errors'))).toBe(false); // base-file errors belong to the audit
    const md = toMarkdown(r);
    expect(md).toContain('3 of 4 changed file(s) have no code owner');
    expect(md).toContain('Judged with `.github/CODEOWNERS` on `main`');
    expect(md).toContain('- `tools/new-script.sh`');
    expect(md).toContain('/tools/ @OWNER');
  });

  it('lints the PR\'s own CODEOWNERS separately; problems already on the base never fail the PR', async () => {
    const base = '/web/ @alice\n/old/ @ghost\n';
    const head = '/web/ @alice\n/old/ @ghost\n/tools/ @carol\n/nowhere/ @alice\n!/x @alice\n/tools/ @acme/web\n';
    const { api: a, fetch } = api({ [`GET /repos/acme/app/codeowners/errors?ref=${HEAD}`]: { body: { errors: [] } } }, { org: true });
    const r = await auditOwners({
      repository: 'acme/app',
      ref: 'main',
      codeowners: { path: '.github/CODEOWNERS', text: base },
      files: [],
      pr: {
        number: 8,
        trusted: true,
        files: [{ filename: '.github/CODEOWNERS', status: 'modified' }, { filename: 'tools/new.sh', status: 'added' }],
        proposed: { ref: HEAD, codeowners: { path: '.github/CODEOWNERS', text: head }, files: ['.github/CODEOWNERS', 'web/a.ts', 'tools/new.sh'] },
      },
      api: a,
      now,
    });
    // judged with the base: neither file has an owner there
    expect(scoped(r, 'current')).toEqual(['error unowned-files']);
    expect(r.unowned).toEqual(['.github/CODEOWNERS', 'tools/new.sh']);
    expect(r.ownedAfterMerge).toEqual(['tools/new.sh']);
    expect(scoped(r, 'proposed')).toEqual([
      'error invalid-line L5',
      'error owner-no-write @carol',
      'error rule-without-valid-owner L3',
      'warning pattern-matches-nothing L2 (pre)',
      'warning pattern-matches-nothing L4',
      'warning rule-without-valid-owner L2 (pre)',
      'warning shadowed-rule L3',
      'warning unknown-user @ghost (pre)',
    ]);
    expect(fetch.calls.some((c) => c.path === `/repos/acme/app/codeowners/errors?ref=${HEAD}`)).toBe(true);
    const md = toMarkdown(r);
    expect(md).toContain("#### This PR's CODEOWNERS (`.github/CODEOWNERS` at `ccccccc`)");
    expect(md).toContain("`tools/new.sh` (this PR's CODEOWNERS owns it once merged)");
    expect(md).toContain('(already on the base branch)');
    expect(md).not.toContain('/tools/ @OWNER'); // no suggestion for a path the PR already covers
  });

  it('a clean CODEOWNERS edit says so', async () => {
    const { api: a } = api({ [`GET /repos/acme/app/codeowners/errors?ref=${HEAD}`]: { body: { errors: [] } } }, { org: true });
    const r = await auditOwners({
      repository: 'acme/app',
      ref: 'main',
      codeowners: { path: '.github/CODEOWNERS', text: '* @alice\n' },
      files: [],
      pr: { number: 9, trusted: true, files: [{ filename: '.github/CODEOWNERS', status: 'modified' }], proposed: { ref: HEAD, codeowners: { path: '.github/CODEOWNERS', text: '* @alice\n/web/ @acme/web\n' }, files: ['.github/CODEOWNERS', 'web/a'] } },
      api: a,
      now,
    });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(toMarkdown(r)).toContain('No problems found');
  });

  it('a PR that removes CODEOWNERS is an error in its own section', async () => {
    const { api: a } = api({}, { org: true });
    const r = await auditOwners({
      repository: 'acme/app',
      codeowners: { path: '.github/CODEOWNERS', text: '* @alice\n' },
      files: [],
      pr: { number: 3, files: [{ filename: '.github/CODEOWNERS', status: 'removed' }], proposed: { ref: HEAD, files: ['a'] } },
      api: a,
      now,
    });
    expect(scoped(r, 'proposed')).toEqual(['error no-codeowners']);
    expect(r.findings.find((f) => f.scope === 'proposed')!.message).toContain('this PR removes `.github/CODEOWNERS`');
  });

  it("a PR that adds the first CODEOWNERS is not blocked by the base having none", async () => {
    const { api: a } = api({ [`GET /repos/acme/app/codeowners/errors?ref=${HEAD}`]: { body: { errors: [] } } }, { org: true });
    const r = await auditOwners({
      repository: 'acme/app',
      ref: 'main',
      files: [],
      pr: { number: 4, trusted: true, files: [{ filename: '.github/CODEOWNERS', status: 'added' }, { filename: 'x.ts', status: 'added' }], proposed: { ref: HEAD, codeowners: { path: '.github/CODEOWNERS', text: '* @alice\n' }, files: ['.github/CODEOWNERS', 'x.ts'] } },
      api: a,
      now,
    });
    expect(scoped(r, 'current')).toEqual(['warning no-codeowners']);
    expect(r.ownedAfterMerge).toEqual(['.github/CODEOWNERS', 'x.ts']);
    expect(r.ok).toBe(true);
  });

  it('honours owners.ignore and passes when everything is owned', async () => {
    const { api: a } = api();
    const r = await auditOwners({
      repository: 'acme/app',
      codeowners: { path: '.github/CODEOWNERS', text: '* @alice\n' },
      files: [],
      pr: { number: 7, files: [{ filename: 'web/app.ts', status: 'modified' }, { filename: 'x.snap', status: 'added' }] },
      api: a,
      now,
      config: parseConfig('owners:\n  ignore: ["**/*.snap"]\n'),
    });
    expect(r.checkedFiles).toBe(1);
    expect(r.unowned).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('fails on a repo with no CODEOWNERS', async () => {
    const r = await auditOwners({ repository: 'acme/app', files: [], pr: { number: 1, files: prFiles } });
    expect(codes(r)).toEqual(['no-codeowners']);
    expect(r.unowned).toHaveLength(4);
    expect(r.ok).toBe(false);
  });
});

describe('untrusted PR authors get no org-private outcome', () => {
  const base = '* @acme/platform\n';
  const head = '* @acme/platform\n/x/ @acme/secret-team @someone\n/y/ @ghost\n';
  const input = (trusted: boolean): OwnersInput => ({
    repository: 'acme/app',
    ref: 'main',
    codeowners: { path: '.github/CODEOWNERS', text: base },
    files: [],
    pr: { number: 11, trusted, files: [{ filename: '.github/CODEOWNERS', status: 'modified' }], proposed: { ref: HEAD, codeowners: { path: '.github/CODEOWNERS', text: head }, files: ['.github/CODEOWNERS', 'x/a', 'y/b'] } },
    now,
  });
  const extra = {
    'GET /users/someone': { body: { login: 'someone' } },
    'GET /orgs/acme/teams/secret-team': { status: 404, body: { message: 'Not Found' } },
    'GET /orgs/acme/members/someone': { status: 404, body: { message: 'Not Found' } },
    'GET /repos/acme/app/collaborators/someone/permission': perm404,
    [`GET /repos/acme/app/codeowners/errors?ref=${HEAD}`]: { body: { errors: [{ line: 2, column: 5, kind: 'Unknown owner', source: '/x/ @acme/secret-team', suggestion: 'make sure @acme/secret-team exists and has write access to the repository', message: 'x', path: '.github/CODEOWNERS' }] } },
  };

  it('fork PR proposing @acme/secret-team and @someone: public existence only, even with an org-token', async () => {
    const { api: a, fetch } = api(extra, { org: true });
    const r = await auditOwners({ ...input(false), api: a });
    // no org, team, permission or GitHub-errors lookup at all
    expect(fetch.calls.filter((c) => /^\/orgs\/|\/collaborators\/|\/codeowners\/errors/.test(c.path))).toEqual([]);
    expect(fetch.calls.map((c) => c.path).sort()).toEqual(['/users/ghost', '/users/someone']);
    expect(r.orgChecks).toBe('untrusted-pr');
    // only the publicly knowable result: @ghost does not exist
    expect(scoped(r, 'proposed')).toEqual(['error rule-without-valid-owner L3', 'error unknown-user @ghost']);
    const md = toMarkdown(r);
    expect(md).not.toMatch(/not found|does not exist \(or|not an acme org member|no longer in|secret|access to acme\/app/i);
    expect(md).toContain('public account existence only');
    expect(r.notes).toHaveLength(1);
    expect(JSON.stringify(r.owners)).not.toMatch(/member|access/);
  });

  it('a trusted member PR still gets the full lint', async () => {
    const { api: a, fetch } = api(extra, { org: true });
    const r = await auditOwners({ ...input(true), api: a });
    expect(r.orgChecks).toBe('enabled');
    expect(scoped(r, 'proposed')).toEqual([
      'error github-error L2',
      'error owner-left-org @someone',
      'error rule-without-valid-owner L2',
      'error rule-without-valid-owner L3',
      'error team-not-found @acme/secret-team',
      'error unknown-user @ghost',
    ]);
    expect(fetch.calls.some((c) => c.path === '/orgs/acme/teams/secret-team')).toBe(true);
  });

  it('trust = same repository AND OWNER / MEMBER / COLLABORATOR', () => {
    const pr = (assoc: string, head = 'acme/app') => ({ author_association: assoc, head: { repo: { full_name: head } }, base: { repo: { full_name: 'acme/app' } } });
    expect(isTrustedPr(pr('MEMBER'))).toBe(true);
    expect(isTrustedPr(pr('OWNER'))).toBe(true);
    expect(isTrustedPr(pr('COLLABORATOR'))).toBe(true);
    expect(isTrustedPr(pr('CONTRIBUTOR'))).toBe(false);
    expect(isTrustedPr(pr('FIRST_TIME_CONTRIBUTOR'))).toBe(false);
    expect(isTrustedPr(pr('MEMBER', 'mallory/app'))).toBe(false); // fork, even by a member
    expect(isTrustedPr({ author_association: 'MEMBER', head: { repo: null }, base: { repo: { full_name: 'acme/app' } } })).toBe(false); // deleted fork
    expect(isTrustedPr(undefined)).toBe(false);
  });
});

describe('untrusted text', () => {
  const hostile = [
    `${COMMENT_MARKER}.md`,
    'a|b|c.ts',
    'x`y``z.ts',
    '@acme/admins.ts',
    '[click](https://evil.example)/x.ts',
    '<img src=x onerror=alert(1)>.ts',
    'line\nbreak.ts',
    '```\n<script>alert(1)</script>.ts',
  ];

  it('escapes hostile file names, patterns, owners and GitHub error text in the comment', async () => {
    const head = ['/<img src=x>/ @nobody-here', '/a|b/ @evil @acme/admins', '/`x`/ @ghost', '/web/ docs@acme.example'].join('\n');
    const { api: a } = api(
      {
        [`GET /repos/acme/app/codeowners/errors?ref=${HEAD}`]: {
          body: { errors: [{ line: 1, column: 1, kind: 'Unknown owner <b>bold</b>', source: '/<img src=x>/ @nobody-here', suggestion: 'ask @acme/admins <script>x</script> [here](https://evil.example)', message: 'x', path: '.github/CODEOWNERS' }] },
        },
        'GET /users/nobody-here': { status: 404, body: { message: 'Not Found' } },
        'GET /users/evil': { status: 404, body: { message: 'Not Found' } },
      },
      { org: true },
    );
    const r = await auditOwners({
      repository: 'acme/app',
      ref: 'main<img src=y>',
      codeowners: { path: '.github/CODEOWNERS', text: '/web/ @alice\n' },
      files: [],
      pr: { number: 5, trusted: true, files: [...hostile.map((filename) => ({ filename, status: 'added' })), { filename: '.github/CODEOWNERS', status: 'modified' }], proposed: { ref: HEAD, codeowners: { path: '.github/CODEOWNERS', text: head }, files: hostile } },
      api: a,
      now,
    });
    const md = toMarkdown(r);
    const plain = outsideCode(md);
    expect(plain).not.toMatch(/<img|<script|<b>|<!--/);
    expect(plain).not.toMatch(/\]\(https:\/\/evil/);
    expect(plain).not.toMatch(/@(?=[A-Za-z0-9])/); // no mention can ping anyone
    expect(md).toContain('line break.ts'); // one list item stays one line
    // every table row has exactly its 5 cell separators (no `|` from a path breaks out)
    for (const row of md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| |---'))) {
      expect(outsideCode(row).match(/(?<!\\)\|/g)?.length, row).toBe(5);
    }
    expect(md.split(COMMENT_MARKER).length - 1).toBe(1); // only inside a code span, never as a live marker
    expect(md.indexOf(COMMENT_MARKER)).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.code === 'unknown-user' && f.owner === '@evil')).toBe(true);
  });

  it('keeps hostile paths inert in the suggested-lines block', () => {
    const r = {
      repository: 'acme/app',
      mode: 'pr',
      pr: 1,
      ok: false,
      findings: [{ code: 'unowned-files', severity: 'error', scope: 'current', message: 'x' }],
      unowned: ['```/x.ts', 'ok/y.ts'],
      ownedAfterMerge: [],
      checkedFiles: 2,
      owners: [],
      orgChecks: 'enabled',
      dormancy: { days: 0, searches: 0, skipped: 0, capped: false },
      notes: [],
    } as unknown as Parameters<typeof toMarkdown>[0];
    const md = toMarkdown(r);
    expect(md).toContain('````\n/```/ @OWNER\n/ok/ @OWNER\n````');
  });
});

describe('sticky comment: marker AND author', () => {
  const prFiles = [{ filename: 'tools/x.sh', status: 'added' }];
  const dirty = () => auditOwners({ repository: 'acme/app', files: [], pr: { number: 7, files: prFiles } });

  it('ignores a forged marker in someone else\'s comment and posts its own', async () => {
    const { gh, fetch } = api({
      'GET /repos/acme/app/issues/7/comments': { body: [{ id: 1, body: `${COMMENT_MARKER}\nplanted`, user: { login: 'mallory' } }] },
      'POST /repos/acme/app/issues/7/comments': { status: 201, body: { id: 2 } },
    });
    expect(await publishComment(gh, 'acme', 'app', await dirty(), 'github-actions[bot]')).toBe('created');
    expect(fetch.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(fetch.calls.find((c) => c.method === 'POST')!.body.body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('updates its own comment (matched case-insensitively by login), leaves it when unchanged', async () => {
    const report = await dirty();
    const { gh, fetch } = api({
      'GET /repos/acme/app/issues/7/comments': { body: [{ id: 3, body: `${COMMENT_MARKER}\nold`, user: { login: 'My-App[bot]' } }] },
      'PATCH /repos/acme/app/issues/comments/3': { body: {} },
    });
    expect(await publishComment(gh, 'acme', 'app', report, 'my-app[bot]')).toBe('updated');
    const body = fetch.calls.find((c) => c.method === 'PATCH')!.body.body;
    const { gh: gh2 } = api({ 'GET /repos/acme/app/issues/7/comments': { body: [{ id: 3, body, user: { login: 'my-app[bot]' } }] } });
    expect(await publishComment(gh2, 'acme', 'app', report, 'my-app[bot]')).toBe('unchanged');
  });

  it('marks its own comment resolved once clean, never someone else\'s', async () => {
    const clean = await auditOwners({ repository: 'acme/app', codeowners: { path: 'CODEOWNERS', text: '* @alice' }, files: [], pr: { number: 7, files: prFiles } });
    const { gh, fetch } = api({
      'GET /repos/acme/app/issues/7/comments': { body: [{ id: 8, body: `${COMMENT_MARKER}\nforged`, user: { login: 'mallory' } }, { id: 9, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]' } }] },
      'PATCH /repos/acme/app/issues/comments/9': { body: {} },
    });
    expect(await publishComment(gh, 'acme', 'app', clean, 'github-actions[bot]')).toBe('resolved');
    expect(fetch.calls.filter((c) => c.method === 'PATCH').map((c) => c.path)).toEqual(['/repos/acme/app/issues/comments/9']);
    expect(fetch.calls.find((c) => c.method === 'PATCH')!.body.body).toBe(RESOLVED_BODY);
    const { gh: gh3, fetch: f3 } = api({ 'GET /repos/acme/app/issues/7/comments': { body: [{ id: 8, body: `${COMMENT_MARKER}\nforged`, user: { login: 'mallory' } }] } });
    expect(await publishComment(gh3, 'acme', 'app', clean, 'github-actions[bot]')).toBe('none');
    expect(f3.calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});

describe('config', () => {
  it('defaults: dormancy 180 days, 100 searches; rejects bad values and unknown keys', () => {
    expect(parseConfig(undefined)).toMatchObject({ dormantDays: 180, maxSearches: 100, requireOwners: true });
    expect(parseConfig('owners:\n  dormantDays: 0\n').dormantDays).toBe(0);
    expect(() => parseConfig('owners:\n  dormantDays: -1\n')).toThrow(/dormantDays/);
    expect(() => parseConfig('owners:\n  maxSearches: 0\n')).toThrow(/maxSearches/);
    expect(() => parseConfig('owners:\n  requireOwners: "no"\n')).toThrow(/requireOwners/);
    expect(() => parseConfig('owners:\n  dormant: 3\n')).toThrow(/unknown key "dormant"/);
    expect(() => parseConfig('ownrs:\n  dormantDays: 3\n')).toThrow(/unknown top-level key/);
  });
});

describe('cli lint (offline, real git repo)', () => {
  it('reads CODEOWNERS and git ls-files from a checkout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owners-'));
    const write = (p: string, s: string) => {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), s);
    };
    write('.github/CODEOWNERS', '/src/ @alice\n/old/ @bob\n');
    write('src/a.ts', '');
    write('lib/b.ts', '');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await cli(['lint', '--repo', dir, '--format', 'json']);
    const out = JSON.parse(String(log.mock.calls[0]![0]));
    log.mockRestore();
    expect(code).toBe(0); // only warnings without the API
    expect(out.findings.map((f: { code: string }) => f.code).sort()).toEqual(['pattern-matches-nothing', 'unowned-files']);
    expect(out.unowned).toEqual(['lib/b.ts']);
    expect(out.orgChecks).toBe('offline');
  });

  it('prints usage with the CLI name from brand.json', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await cli(['--help'])).toBe(0);
    expect(String(log.mock.calls[0]![0])).toMatch(/^.+ \d+\.\d+\.\d+\n\nUsage:\n {2}mainfast-owners lint/);
    log.mockRestore();
  });
});
