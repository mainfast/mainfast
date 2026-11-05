import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOutputs } from '@mainfast/shared/actions-io';
import { mockFetch, type MockRoute } from '@mainfast/shared/mockfetch';
import { resetPlanCache } from '@mainfast/shared/plan';
import { COMMENT_MARKER, PRODUCT } from '../src/brand.js';
import { acmeRoutes, file, tree } from './fixtures/api.js';

const HEAD = 'a'.repeat(40);
const R = '/repos/acme/app';
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPlanCache();
});

const prEvent = (o: { assoc?: string; headRepo?: string } = {}) => ({
  pull_request: {
    number: 5,
    author_association: o.assoc ?? 'MEMBER',
    base: { ref: 'main', sha: 'b'.repeat(40), repo: { full_name: 'acme/app' } },
    head: { sha: HEAD, repo: { full_name: o.headRepo ?? 'acme/app' } },
  },
  repository: { default_branch: 'main', private: false, owner: { login: 'acme', type: 'Organization' } },
});

interface World {
  fetch: ReturnType<typeof mockFetch>;
  outputs: () => Record<string, string>;
  summary: () => string;
  stdout: () => string;
}

/** Fake runner: event payload, env, a workspace whose checkout would change the result (it must be ignored), mocked GitHub. */
async function runAction(o: { routes?: Record<string, MockRoute>; event?: object; eventName?: string; inputs?: Record<string, string> } = {}): Promise<World> {
  const fetch = mockFetch(
    acmeRoutes({
      // base branch: CODEOWNERS owns web/ only; config ignores docs/
      [`GET ${R}/contents/.github/CODEOWNERS?ref=main`]: file('/web/ @alice\n/.github/ @alice\n'),
      [`GET ${R}/contents/.mainfast.yml?ref=main`]: file('owners:\n  ignore: ["docs/**"]\n'),
      [`GET ${R}/pulls/5/files`]: { body: [{ filename: 'web/a.ts', status: 'modified' }, { filename: 'api/b.ts', status: 'added' }, { filename: 'docs/c.md', status: 'added' }] },
      [`GET ${R}/issues/5/comments`]: { body: [] },
      [`POST ${R}/issues/5/comments`]: { status: 201, body: { id: 1 } },
      [`GET ${R}/git/trees/main`]: tree(['.github/CODEOWNERS', 'web/a.ts', 'api/b.ts']),
      ...o.routes,
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const ws = mkdtempSync(join(tmpdir(), 'owners-ws-'));
  // A checkout that would make everything pass: the action must never read it.
  mkdirSync(join(ws, '.github'), { recursive: true });
  writeFileSync(join(ws, '.github/CODEOWNERS'), '* @alice\n');
  writeFileSync(join(ws, '.mainfast.yml'), 'owners:\n  failOn: never\n  requireOwners: false\n');
  const ev = join(ws, 'event.json');
  writeFileSync(ev, JSON.stringify(o.event ?? prEvent()));
  const out = join(ws, 'out');
  const summary = join(ws, 'sum');
  writeFileSync(out, '');
  writeFileSync(summary, '');
  Object.assign(process.env, {
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_EVENT_NAME: o.eventName ?? 'pull_request',
    GITHUB_EVENT_PATH: ev,
    GITHUB_WORKSPACE: ws,
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: summary,
    INPUT_TOKEN: 't',
  });
  for (const [k, v] of Object.entries(o.inputs ?? {})) process.env[`INPUT_${k.toUpperCase()}`] = v;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const writes: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => (writes.push(String(s)), true));
  const { run } = await import('../src/action.js');
  await run();
  return { fetch, outputs: () => parseOutputs(readFileSync(out, 'utf8')), summary: () => readFileSync(summary, 'utf8'), stdout: () => writes.join('') };
}

const posts = (w: World) => w.fetch.calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');

describe('action, pull_request', () => {
  it('reads CODEOWNERS and .mainfast.yml from the base through the API, comments, fails', async () => {
    const w = await runAction();
    const post = posts(w)[0]!;
    expect(post.path).toBe(`${R}/issues/5/comments`);
    expect(post.body.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(post.body.body).toContain('- `api/b.ts`');
    expect(post.body.body).not.toContain('docs/c.md'); // base config's ignore applied
    expect(w.outputs().unowned).toBe('api/b.ts');
    expect(w.fetch.calls.some((c) => c.path.startsWith('/search/'))).toBe(false); // no dormancy on PRs
    expect(w.fetch.calls.some((c) => c.path.includes('/git/trees/'))).toBe(false); // CODEOWNERS not edited: no tree needed
    expect(w.fetch.calls.some((c) => c.path.startsWith('/orgs/'))).toBe(false); // no org-token
    expect(process.exitCode).toBe(1);
  });

  it('lints the PR\'s CODEOWNERS at the head commit and annotates it', async () => {
    const w = await runAction({
      routes: {
        [`GET ${R}/pulls/5/files`]: { body: [{ filename: '.github/CODEOWNERS', status: 'modified' }, { filename: 'api/b.ts', status: 'added' }] },
        [`GET ${R}/contents/.github/CODEOWNERS?ref=${HEAD}`]: file('/web/ @alice\n/.github/ @alice\n/api/ @ghost\n/gone/ @alice\n'),
        [`GET ${R}/git/trees/${HEAD}`]: tree(['.github/CODEOWNERS', 'web/a.ts', 'api/b.ts']),
        [`GET ${R}/codeowners/errors?ref=${HEAD}`]: { body: { errors: [] } },
      },
    });
    const report = JSON.parse(w.outputs().report!);
    expect(report.proposed).toEqual({ path: '.github/CODEOWNERS', ref: HEAD });
    const proposed = report.findings.filter((f: { scope: string }) => f.scope === 'proposed').map((f: { code: string }) => f.code).sort();
    expect(proposed).toEqual(['pattern-matches-nothing', 'rule-without-valid-owner', 'unknown-user']);
    expect(w.stdout()).toMatch(/::error file=\.github\/CODEOWNERS,line=3,title=.*unknown-user::/);
    expect(posts(w)[0]!.body.body).toContain("#### This PR's CODEOWNERS");
  });

  it('a fork PR gets public lookups only, even with an org-token', async () => {
    const w = await runAction({ event: prEvent({ headRepo: 'mallory/app', assoc: 'CONTRIBUTOR' }), inputs: { 'org-token': 'org' } });
    expect(w.fetch.calls.filter((c) => /^\/orgs\/|\/collaborators\//.test(c.path))).toEqual([]);
    expect(JSON.parse(w.outputs().report!).orgChecks).toBe('untrusted-pr');
  });

  it('with org-token on a member PR: membership and teams are checked', async () => {
    const w = await runAction({ inputs: { 'org-token': 'org' }, routes: { [`GET ${R}/contents/.github/CODEOWNERS?ref=main`]: file('/web/ @alice @acme/gone\n') } });
    expect(w.fetch.calls.some((c) => c.path === '/orgs/acme/teams?per_page=1')).toBe(true);
    expect(JSON.parse(w.outputs().report!).findings.map((f: { code: string }) => f.code)).toContain('team-not-found');
  });

  it('ignores a forged marker in another user\'s comment; updates its own (comment-author input)', async () => {
    const forged = await runAction({ routes: { [`GET ${R}/issues/5/comments`]: { body: [{ id: 9, body: `${COMMENT_MARKER}\nplanted`, user: { login: 'mallory' } }] } } });
    expect(posts(forged).map((c) => c.method)).toEqual(['POST']);
    const own = await runAction({
      inputs: { 'comment-author': 'owners-app[bot]' },
      routes: {
        [`GET ${R}/issues/5/comments`]: { body: [{ id: 9, body: `${COMMENT_MARKER}\nplanted`, user: { login: 'mallory' } }, { id: 10, body: `${COMMENT_MARKER}\nold`, user: { login: 'owners-app[bot]' } }] },
        [`PATCH ${R}/issues/comments/10`]: { body: {} },
      },
    });
    expect(posts(own).map((c) => `${c.method} ${c.path}`)).toEqual([`PATCH ${R}/issues/comments/10`]);
  });

  it('a read-only token: warning annotation, the result still stands', async () => {
    const w = await runAction({ routes: { [`POST ${R}/issues/5/comments`]: { status: 403, body: { message: 'Resource not accessible by integration' } } } });
    expect(w.stdout()).toContain('could not comment on the PR (403)');
    expect(process.exitCode).toBe(1);
  });
});

describe('action, scheduled audit', () => {
  const audit = (o: Parameters<typeof runAction>[0] = {}) =>
    runAction({ eventName: 'schedule', event: { repository: { default_branch: 'main', private: false, owner: { login: 'acme', type: 'Organization' } } }, ...o });

  it('audits the default branch through the API with dormancy (180 days) and one org note', async () => {
    const w = await audit({ routes: { [`GET ${R}/contents/.github/CODEOWNERS?ref=main`]: file('* @dave @acme/platform\n') } });
    const report = JSON.parse(w.outputs().report!);
    expect(report.mode).toBe('audit');
    expect(report.dormancy).toMatchObject({ days: 180, searches: 1 });
    expect(report.findings.map((f: { code: string }) => f.code)).toEqual(['github-error', 'dormant-owner']);
    expect(w.summary()).toContain('needs a token with Organization → Members: read');
    expect(w.fetch.calls.some((c) => c.path.startsWith('/orgs/'))).toBe(false);
    expect(posts(w)).toEqual([]); // no PR comment in an audit
  });

  it('dormant-days: 0 turns dormancy off', async () => {
    const w = await audit({ inputs: { 'dormant-days': '0' } });
    expect(w.fetch.calls.some((c) => c.path.startsWith('/search/'))).toBe(false);
  });

  it('applies extends: from another repository', async () => {
    const w = await audit({
      routes: {
        [`GET ${R}/contents/.mainfast.yml?ref=main`]: file('extends: acme/policy\n'),
        'GET /repos/acme/policy/contents/.mainfast.yml': file('owners:\n  dormantDays: 0\n'),
      },
    });
    expect(JSON.parse(w.outputs().report!).dormancy.days).toBe(0);
  });

  it('rejects a bad input instead of guessing', async () => {
    await expect(audit({ inputs: { 'dormant-days': 'soon' } })).rejects.toThrow(/dormant-days/);
  });

  it('adds the plan notice on a large private repository without a key; the result is unchanged', async () => {
    const now = new Date().toISOString();
    const w = await audit({
      event: { repository: { default_branch: 'main', private: true, owner: { login: 'acme', type: 'Organization' } } },
      routes: { [`GET ${R}/pulls?state=all&sort=created&direction=desc`]: { body: ['a', 'b', 'c', 'd', 'e', 'f'].map((login) => ({ created_at: now, user: { login, type: 'User' } })) } },
    });
    expect(w.summary()).toContain('6 active contributors');
    expect(w.summary()).toContain(`${PRODUCT} ran in full and this notice never changes its result.`);
    expect(w.outputs().ok).toBe('false');
  });
});

describe('test isolation', () => {
  it('the global fetch is a guard that throws (no test reaches the network)', async () => {
    await expect(fetch('http://api.test/x')).rejects.toThrow(/tried to reach the network/);
  });
});
