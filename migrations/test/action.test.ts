import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.js';
import { COMMENT_MARKER, PRODUCT, STATUS_CONTEXT } from '../src/brand.js';
import { mockFetch, type MockFetch } from '@mainfast/shared/mockfetch';
import { resetPlanCache } from '@mainfast/shared/plan';
import { cleanup, world } from './helpers.js';

afterAll(cleanup);
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPlanCache();
});

function env(event: object, eventName: string, ws: string, inputs: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mainfast-env-'));
  const files = { event: join(dir, 'event.json'), out: join(dir, 'out'), summary: join(dir, 'summary') };
  writeFileSync(files.event, JSON.stringify(event));
  writeFileSync(files.out, '');
  writeFileSync(files.summary, '');
  Object.assign(process.env, {
    GITHUB_EVENT_PATH: files.event,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_WORKSPACE: ws,
    GITHUB_OUTPUT: files.out,
    GITHUB_STEP_SUMMARY: files.summary,
    GITHUB_API_URL: 'http://api.test',
  });
  for (const k of Object.keys(process.env)) if (k.startsWith('INPUT_')) delete process.env[k];
  for (const [k, v] of Object.entries(inputs)) process.env[`INPUT_${k.toUpperCase()}`] = v;
  return files;
}

/** Stubs the global fetch the Action's GitHub client uses; statuses/<sha> is routed to one key. */
function api(routes: Record<string, unknown>): MockFetch {
  const fetch = mockFetch(routes);
  vi.stubGlobal('fetch', (url: string, init: never) =>
    fetch(url.includes('/statuses/') ? url.replace(/\/statuses\/[0-9a-f]+$/, '/statuses') : url, init),
  );
  return fetch;
}

const quiet = () => {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => out.mock.calls.map((c) => String(c[0])).join('');
};

const prEvent = (extra: object = {}) => ({
  pull_request: { number: 1, base: { ref: 'main' }, head: { ref: 'pr1' }, labels: [] },
  repository: { default_branch: 'main', private: false },
  ...extra,
});

const prRoutes = {
  'GET /user': { status: 403, body: { message: 'Resource not accessible by integration' } },
  'GET /repos/acme/app/issues/1/comments': { body: [] },
  'POST /repos/acme/app/issues/1/comments': { status: 201, body: { id: 11 } },
  'POST /repos/acme/app/issues/1/labels': { body: [] },
  'POST /repos/acme/app/statuses': { status: 201, body: {} },
};

describe('action: pull_request', () => {
  it('annotates, writes summary/outputs, comments, labels, sets the blocking status by default and fails', async () => {
    const { ws } = world();
    const files = env(prEvent(), 'pull_request', ws.dir, { token: 't' });
    const fetch = api(prRoutes);
    const written = quiet();
    await run();
    expect(written()).toContain('::error file=alembic/versions/');
    expect(process.exitCode).toBe(1);
    expect(readFileSync(files.summary, 'utf8')).toContain('1 error,');
    expect(readFileSync(files.out, 'utf8')).toMatch(/^ok<<ghadelim_[^\n]+\nfalse\n/);
    const status = fetch.calls.find((c) => c.path.endsWith('/statuses'))!;
    expect(status.body).toMatchObject({ state: 'failure', context: STATUS_CONTEXT });
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path.endsWith('/comments'))!.body.body).toContain(COMMENT_MARKER);
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
  });

  it('a clean PR gets a success status, so a required status is satisfied', async () => {
    const { ws } = world();
    env({ ...prEvent(), pull_request: { number: 2, base: { ref: 'main' }, head: { ref: 'pr2' }, labels: [] } }, 'pull_request', ws.dir, { token: 't' });
    const fetch = api({ 'GET /repos/acme/app/issues/2/comments': { body: [] }, 'POST /repos/acme/app/statuses': { status: 201, body: {} } });
    quiet();
    await run();
    expect(process.exitCode).toBeUndefined();
    expect(fetch.calls.find((c) => c.path.endsWith('/statuses'))!.body).toMatchObject({ state: 'success', context: STATUS_CONTEXT });
  });

  it('status: false sets no commit status', async () => {
    const { ws } = world();
    env(prEvent(), 'pull_request', ws.dir, { token: 't', status: 'false' });
    const fetch = api(prRoutes);
    quiet();
    await run();
    expect(fetch.calls.some((c) => c.path.includes('/statuses'))).toBe(false);
    expect(fetch.calls.some((c) => c.method === 'POST' && c.path.endsWith('/comments'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('reads .mainfast.yml from the base branch: the PR cannot switch its own check off', async () => {
    const { ws } = world({
      main: 'migrations:\n  label: "db: rebase me"\n',
      pr1: 'migrations:\n  frameworks: [rails]\n  label: "pr says ok"\n',
    });
    env(prEvent(), 'pull_request', ws.dir, { token: 't' });
    const fetch = api(prRoutes);
    quiet();
    await run();
    expect(process.exitCode).toBe(1); // the Alembic fork is still found
    expect(fetch.calls.find((c) => c.path.endsWith('/issues/1/labels'))!.body).toEqual({ labels: ['db: rebase me'] });
  });

  it('a read-only token (fork PR) degrades to a warning; the summary still carries the result', async () => {
    const { ws } = world();
    const files = env(prEvent(), 'pull_request', ws.dir, { token: 't' });
    api({ 'GET /repos/acme/app/issues/1/comments': { body: [] }, 'POST /repos/acme/app/issues/1/comments': { status: 403, body: { message: 'Resource not accessible by integration' } } });
    const written = quiet();
    await run();
    expect(written()).toMatch(/::warning::Could not comment, label or set the commit status on the PR \(403\)/);
    expect(readFileSync(files.summary, 'utf8')).toContain('1 error,');
    expect(process.exitCode).toBe(1);
  });

  it('adds the plan notice to the summary on a large private repository without a key, and the result is unchanged', async () => {
    const { ws } = world();
    const files = env(prEvent({ repository: { default_branch: 'main', private: true } }), 'pull_request', ws.dir, { token: 't' });
    const now = new Date().toISOString();
    api({
      ...prRoutes,
      'GET /repos/acme/app/pulls': { body: ['a', 'b', 'c', 'd', 'e', 'f'].map((login) => ({ created_at: now, user: { login, type: 'User' } })) },
    });
    quiet();
    await run();
    const summary = readFileSync(files.summary, 'utf8');
    expect(summary).toContain('6 active contributors');
    expect(summary).toContain(`${PRODUCT} ran in full and this notice never changes its result.`);
    expect(process.exitCode).toBe(1); // from the migration finding, not from the plan
  });
});

describe('test isolation', () => {
  it('the global fetch is a guard that throws (no test reaches the network)', async () => {
    await expect(fetch('http://api.test/x')).rejects.toThrow(/tried to reach the network/);
  });
});

describe('action: push', () => {
  it('push to main re-checks open PRs and sets the blocking status on each head by default', async () => {
    const { ws } = world();
    const files = env({ ref: 'refs/heads/main', repository: { default_branch: 'main', private: false } }, 'push', ws.dir, { token: 't' });
    const fetch = api({
      'GET /repos/acme/app/pulls?state=open&base=main': {
        body: [
          { number: 1, title: 'Add b1', head: { sha: 'x', ref: 'pr1' }, base: { ref: 'main' }, labels: [] },
          { number: 2, title: 'Docs', head: { sha: 'y', ref: 'pr2' }, base: { ref: 'main' }, labels: [] },
        ],
      },
      ...prRoutes,
      'GET /repos/acme/app/issues/2/comments': { body: [] },
    });
    quiet();
    await run();
    expect(fetch.calls.filter((c) => c.path.endsWith('/statuses')).map((c) => [c.body.state, c.body.context])).toEqual([
      ['failure', STATUS_CONTEXT],
      ['success', STATUS_CONTEXT],
    ]);
    expect(readFileSync(files.out, 'utf8')).toMatch(/stale-prs<<ghadelim_[^\n]+\n1\n/);
    expect(process.exitCode).toBeUndefined(); // the push job itself never fails on a stale PR; the status does the blocking
  });

  it('push to a non-main branch does nothing', async () => {
    const { ws } = world();
    env({ ref: 'refs/heads/feature', repository: { default_branch: 'main' } }, 'push', ws.dir, {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run();
    expect(String(log.mock.calls[0]![0])).toContain('nothing to re-check');
    expect(process.exitCode).toBeUndefined();
  });
});
