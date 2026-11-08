import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOutputs } from '@mainfast/shared/actions-io';
import { mockFetch, type MockRoute } from '@mainfast/shared/mockfetch';
import { resetPlanCache } from '@mainfast/shared/plan';
import { ISSUE_MARKER, PRODUCT } from '../src/brand.js';

const routesJson = JSON.parse(readFileSync(new URL('./fixtures/acme-web.routes.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const fixtureRoutes = Object.fromEntries(Object.entries(routesJson).map(([k, body]) => [k, { body } as MockRoute]));
const file = (text: string) => ({ body: { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') } });
const MAIN_SHA = 'f'.repeat(40);

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPlanCache();
});

interface World {
  fetch: ReturnType<typeof mockFetch>;
  out: string;
  summary: string;
  ws: string;
  written: () => string;
}

/** Fake runner: event payload, env, a workspace and a mocked GitHub. */
async function runAction(o: { routes?: Record<string, MockRoute>; event?: object; eventName?: string; inputs?: Record<string, string>; workspaceConfig?: string } = {}): Promise<World> {
  const fetch = mockFetch({
    ...fixtureRoutes,
    'GET /repos/acme/web/contents/.mainfast.yml': file('rollcall:\n  ignore: ["ci/circleci: build"]\n  openPulls: 0\n'),
    'POST /repos/acme/web/check-runs': { status: 201, body: { id: 1 } },
    'GET /repos/acme/web/issues': { body: [] },
    'POST /repos/acme/web/issues': { status: 201, body: { id: 5, number: 42, html_url: 'https://github.com/acme/web/issues/42' } },
    ...o.routes,
  });
  vi.stubGlobal('fetch', fetch);
  const ws = mkdtempSync(join(tmpdir(), 'rollcall-ws-'));
  // A checkout that would switch everything off: the action must not read it.
  mkdirSync(join(ws, '.github/workflows'), { recursive: true });
  writeFileSync(join(ws, '.mainfast.yml'), o.workspaceConfig ?? 'rollcall:\n  failOn: never\n  issueOn: never\n  ignore: [build, test, lint, e2e, typecheck]\n');
  const ev = join(ws, 'event.json');
  writeFileSync(ev, JSON.stringify(o.event ?? { repository: { default_branch: 'main', private: false } }));
  const out = join(ws, 'out');
  const summary = join(ws, 'sum');
  writeFileSync(out, '');
  writeFileSync(summary, '');
  Object.assign(process.env, {
    GITHUB_REPOSITORY: 'acme/web',
    GITHUB_EVENT_NAME: o.eventName ?? 'schedule',
    GITHUB_EVENT_PATH: ev,
    GITHUB_WORKSPACE: ws,
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_SHA: 'deadbeef',
    GITHUB_RUN_ID: '9',
    INPUT_TOKEN: 't',
    ...Object.fromEntries(Object.entries(o.inputs ?? {}).map(([k, v]) => [`INPUT_${k.replace(/ /g, '_').toUpperCase()}`, v])),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => (chunks.push(String(c)), true));
  const { run } = await import('../src/action.js');
  await run();
  return { fetch, out, summary, ws, written: () => chunks.join('') };
}

const posts = (w: World, path: string) => w.fetch.calls.filter((c) => (c.method === 'POST' || c.method === 'PATCH') && c.path.startsWith(path));

describe('action: scheduled audit', () => {
  it('reads config and workflows from the default branch through the API, never from the checkout', async () => {
    const w = await runAction();
    const contents = w.fetch.calls.filter((c) => c.path.includes('/contents/'));
    expect(contents.map((c) => c.path)).toEqual([
      '/repos/acme/web/contents/.mainfast.yml?ref=main',
      '/repos/acme/web/contents/.github/workflows?ref=main',
      '/repos/acme/web/contents/.github/workflows/ci.yml?ref=main',
      '/repos/acme/web/contents/.github/workflows/e2e.yml?ref=main',
    ]);
    const report = JSON.parse(parseOutputs(readFileSync(w.out, 'utf8')).report!);
    // the API config ignores circleci; the checkout's config (ignore everything, never fail) was not used
    expect(report.required.map((r: { context: string }) => r.context).sort()).toEqual(['build', 'e2e', 'lint', 'test', 'typecheck']);
    expect(process.exitCode).toBe(1);
  });

  it('posts the check run on the audited branch head and opens one tracking issue', async () => {
    const w = await runAction();
    const run = posts(w, '/repos/acme/web/check-runs')[0]!;
    expect(run.body).toMatchObject({ head_sha: MAIN_SHA, conclusion: 'failure', status: 'completed', details_url: 'https://github.com/acme/web/actions/runs/9' });
    const issue = posts(w, '/repos/acme/web/issues');
    expect(issue).toHaveLength(1);
    expect(issue[0]!.method).toBe('POST');
    expect(issue[0]!.body.title).toBe(`${PRODUCT}: required checks do not protect main`);
    expect(issue[0]!.body.body.startsWith(`${ISSUE_MARKER}\n`)).toBe(true);
    expect(issue[0]!.body.body).toContain('matrix-name-mismatch');
    const outs = parseOutputs(readFileSync(w.out, 'utf8'));
    expect(outs).toMatchObject({ ok: 'false', conclusion: 'failure', issue: '42' });
    expect(readFileSync(w.summary, 'utf8')).toContain(PRODUCT);
  });

  it('a workflow_dispatch from a feature branch still audits (and reads policy from) main', async () => {
    const w = await runAction({ eventName: 'workflow_dispatch', event: { ref: 'refs/heads/feature/x', repository: { default_branch: 'main', private: false } } });
    expect(w.fetch.calls.some((c) => c.path.includes('ref=feature'))).toBe(false);
    expect(posts(w, '/repos/acme/web/check-runs')[0]!.body.head_sha).toBe(MAIN_SHA);
  });

  it('updates its own tracking issue, ignores a marker pasted into someone else’s, honors comment-author', async () => {
    const issues = [
      { id: 1, number: 7, title: 'x', body: `${ISSUE_MARKER}\nplanted`, user: { login: 'mallory' } },
      { id: 2, number: 8, title: 'pr', body: `${ISSUE_MARKER}\nold`, user: { login: 'rollcall-bot' }, pull_request: {} },
      { id: 3, number: 9, title: 'old', body: `${ISSUE_MARKER}\nold`, user: { login: 'rollcall-bot' } },
    ];
    const w = await runAction({ routes: { 'GET /repos/acme/web/issues': { body: issues } }, inputs: { 'comment-author': 'rollcall-bot' } });
    const writes = posts(w, '/repos/acme/web/issues');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /repos/acme/web/issues/9']);
    expect(w.fetch.calls.some((c) => c.path === '/user')).toBe(false); // comment-author skips GET /user
  });

  it('without comment-author, only an issue by github-actions[bot] (GITHUB_TOKEN cannot read /user) counts', async () => {
    const issues = [{ id: 1, number: 7, title: 'x', body: `${ISSUE_MARKER}\nplanted`, user: { login: 'mallory' } }];
    const w = await runAction({ routes: { 'GET /repos/acme/web/issues': { body: issues } } });
    expect(w.fetch.calls.some((c) => c.path === '/user')).toBe(true);
    expect(posts(w, '/repos/acme/web/issues').map((c) => c.method)).toEqual(['POST']);
  });

  it('closes its tracking issue once the audit is clean', async () => {
    const issues = [{ id: 3, number: 9, title: 'old', body: `${ISSUE_MARKER}\nold`, user: { login: 'github-actions[bot]' } }];
    const w = await runAction({
      routes: {
        'GET /repos/acme/web/issues': { body: issues },
        'GET /repos/acme/web/contents/.mainfast.yml': file('rollcall:\n  ignore: [test, lint, e2e, typecheck, "ci/circleci: build"]\n  failOn: error\n  openPulls: 0\n'),
        'GET /repos/acme/web/rulesets': { body: [] },
      },
    });
    const close = posts(w, '/repos/acme/web/issues')[0]!;
    expect(close).toMatchObject({ method: 'PATCH', path: '/repos/acme/web/issues/9' });
    expect(close.body).toMatchObject({ state: 'closed', state_reason: 'completed' });
    expect(close.body.body.startsWith(ISSUE_MARKER)).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('keeps going with a warning when it may not write issues or check runs', async () => {
    const denied = { status: 403, body: { message: 'Resource not accessible by integration' } };
    const w = await runAction({ routes: { 'GET /repos/acme/web/issues': denied, 'POST /repos/acme/web/check-runs': denied } });
    expect(w.written()).toContain('could not read or write the tracking issue (403; needs issues: write');
    expect(w.written()).toContain('could not create the check run (403; needs checks: write)');
    expect(readFileSync(w.summary, 'utf8')).toContain('matrix-name-mismatch');
    expect(process.exitCode).toBe(1);
  });

  it('issue: false posts no issue; a push to another branch audits nothing', async () => {
    const a = await runAction({ inputs: { issue: 'false' } });
    expect(a.fetch.calls.some((c) => c.path.includes('/issues'))).toBe(false);
    vi.restoreAllMocks();
    const b = await runAction({ eventName: 'push', event: { ref: 'refs/heads/dev', repository: { default_branch: 'main', private: false } } });
    expect(b.fetch.calls.some((c) => c.path.includes('/pulls'))).toBe(false);
    expect(posts(b, '/repos/acme/web/check-runs')).toEqual([]);
  });

  it('adds the plan notice on a large private repository without a key; the result is unchanged', async () => {
    const now = new Date().toISOString();
    const w = await runAction({
      event: { repository: { default_branch: 'main', private: true } },
      routes: {
        'GET /repos/acme/web/pulls?state=all&sort=created&direction=desc': { body: ['a', 'b', 'c', 'd', 'e', 'f'].map((login) => ({ created_at: now, user: { login, type: 'User' } })) },
      },
    });
    const summary = readFileSync(w.summary, 'utf8');
    expect(summary).toContain('6 active contributors');
    expect(summary).toContain(`${PRODUCT} ran in full and this notice never changes its result.`);
    expect(posts(w, '/repos/acme/web/check-runs')[0]!.body.conclusion).toBe('failure');
  });

  it('applies extends: from another repository', async () => {
    const w = await runAction({
      routes: {
        'GET /repos/acme/web/contents/.mainfast.yml': file('extends: acme/policy\nrollcall:\n  openPulls: 0\n'),
        'GET /repos/acme/policy/contents/.mainfast.yml': file('rollcall:\n  ignore: [e2e]\n'),
      },
    });
    const report = JSON.parse(parseOutputs(readFileSync(w.out, 'utf8')).report!);
    expect(report.required.map((r: { context: string }) => r.context)).not.toContain('e2e');
  });
});

describe('test isolation', () => {
  it('the global fetch is a guard that throws (no test reaches the network)', async () => {
    await expect(fetch('http://api.test/x')).rejects.toThrow(/tried to reach the network/);
  });
});
