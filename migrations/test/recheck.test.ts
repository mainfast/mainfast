import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CLI_NAME, COMMENT_MARKER, DEFAULT_STALE_LABEL, STATUS_CONTEXT } from '../src/brand.js';
import { product } from '@mainfast/shared/brand';
import { main as cli } from '../src/cli.js';
import { recheckMarkdown, recheckOpenPrs } from '../src/recheck.js';
import { GitHub, type FetchLike } from '@mainfast/shared/github';
import { mockFetch } from '@mainfast/shared/mockfetch';
import { alembicRev, cleanup, TempRepo, world } from './helpers.js';

afterAll(cleanup);
const V = 'alembic/versions';
/** GITHUB_TOKEN cannot read GET /user: comments are then owned by github-actions[bot]. */
const NO_USER = { 'GET /user': { status: 403, body: { message: 'Resource not accessible by integration' } } };

const pulls = [
  { number: 1, title: 'Add b1', head: { sha: 'x', ref: 'pr1' }, base: { ref: 'main' }, labels: [] },
  { number: 2, title: 'Docs', head: { sha: 'y', ref: 'pr2' }, base: { ref: 'main' }, labels: [{ name: DEFAULT_STALE_LABEL }] },
];

/** statuses/<sha> has a variable path; route it to one key. */
const statusRouted = (fetch: FetchLike): FetchLike => async (url, init) =>
  url.includes('/statuses/') ? fetch(url.replace(/\/statuses\/[0-9a-f]+$/, '/statuses'), init) : fetch(url, init);

describe('recheck open PRs on push to main', () => {
  it('comments, labels and sets status on the stale PR; clears the label on the clean one', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      ...NO_USER,
      'GET /repos/acme/app/pulls?state=open&base=main&per_page=100': { body: pulls },
      'GET /repos/acme/app/issues/1/comments': { body: [] },
      'POST /repos/acme/app/issues/1/comments': { status: 201, body: { id: 11 } },
      'POST /repos/acme/app/issues/1/labels': { body: [{ name: DEFAULT_STALE_LABEL }] },
      'GET /repos/acme/app/issues/2/comments': { body: [{ id: 22, body: `${COMMENT_MARKER}\nold stale report`, user: { login: 'github-actions[bot]' } }] },
      'PATCH /repos/acme/app/issues/comments/22': { body: { id: 22 } },
      [`DELETE /repos/acme/app/issues/2/labels/${encodeURIComponent(DEFAULT_STALE_LABEL)}`]: { body: [] },
      'POST /repos/acme/app/statuses': { status: 201, body: {} },
    });
    const gh = new GitHub({ token: 't', userAgent: 'test', fetch: statusRouted(fetch) });
    // no `status` option: the blocking commit status is on by default
    const entries = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main' });

    expect(entries.map((e) => [e.number, e.stale, e.error])).toEqual([
      [1, true, undefined],
      [2, false, undefined],
    ]);
    expect(entries[0]!.report!.findings.map((f) => f.code)).toEqual(['multiple-heads']);
    expect(entries[0]!.published).toEqual({ comment: 'created', label: 'added', status: 'failure' });
    expect(entries[1]!.published).toEqual({ comment: 'resolved', label: 'removed', status: 'success' });

    const post = fetch.calls.find((c) => c.method === 'POST' && c.path.endsWith('/issues/1/comments'))!;
    expect(post.body.body).toContain(COMMENT_MARKER);
    expect(post.body.body).toContain('2 heads');
    const statuses = fetch.calls.filter((c) => c.path.endsWith('/statuses'));
    expect(statuses.map((s) => [s.body.state, s.body.context])).toEqual([
      ['failure', STATUS_CONTEXT],
      ['success', STATUS_CONTEXT],
    ]);
    expect(STATUS_CONTEXT).toBe('mainfast/migrations');
    // each status lands on that PR's head commit
    const heads = fetch.calls.filter((c) => c.path.endsWith('/statuses'));
    expect(heads).toHaveLength(2);
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
    expect(recheckMarkdown(entries, 'main')).toContain('2 open PRs checked, 1 stale.');
  });

  it('status: false sets no commit status (comment and label still happen)', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      ...NO_USER,
      'GET /repos/acme/app/pulls': { body: [pulls[0]] },
      'GET /repos/acme/app/issues/1/comments': { body: [] },
      'POST /repos/acme/app/issues/1/comments': { status: 201, body: { id: 11 } },
      'POST /repos/acme/app/issues/1/labels': { body: [] },
    });
    const gh = new GitHub({ token: 't', userAgent: 'test', fetch });
    const [e] = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main', status: false });
    expect(e!.published).toEqual({ comment: 'created', label: 'added' });
    expect(fetch.calls.some((c) => c.path.includes('/statuses/'))).toBe(false);
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
  });

  it('reads .mainfast.yml from main, not from the PR head', async () => {
    const { ws } = world({
      main: 'migrations:\n  label: "db: rebase me"\n',
      pr1: 'migrations:\n  frameworks: [rails]\n  label: "pr says ok"\n',
    });
    const fetch = mockFetch({
      'GET /repos/acme/app/pulls': { body: [{ ...pulls[0], labels: [] }] },
      'GET /repos/acme/app/issues/1/comments': { body: [] },
      'POST /repos/acme/app/issues/1/comments': { status: 201, body: { id: 11 } },
      'POST /repos/acme/app/issues/1/labels': { body: [] },
      'POST /repos/acme/app/statuses': { status: 201, body: {} },
    });
    const gh = new GitHub({ token: 't', userAgent: 'test', fetch: statusRouted(fetch) });
    const [e] = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main' });
    // the PR's `frameworks: [rails]` would have hidden the Alembic fork; main's policy wins
    expect(e!.stale).toBe(true);
    expect(fetch.calls.find((c) => c.path.endsWith('/issues/1/labels'))!.body).toEqual({ labels: ['db: rebase me'] });
    expect(fetch.calls.find((c) => c.path.endsWith('/statuses'))!.body.state).toBe('failure');
  });

  it('updates the existing comment instead of stacking a new one', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      'GET /repos/acme/app/pulls': { body: [pulls[0]] },
      'GET /repos/acme/app/issues/1/comments': { body: [{ id: 5, body: `${COMMENT_MARKER}\nprevious`, user: { login: 'github-actions[bot]' } }] },
      'PATCH /repos/acme/app/issues/comments/5': { body: {} },
      'POST /repos/acme/app/issues/1/labels': { body: [] },
    });
    const gh = new GitHub({ userAgent: 'test', fetch });
    const [e] = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main', status: false });
    expect(e!.published!.comment).toBe('updated');
    expect(fetch.calls.some((c) => c.method === 'POST' && c.path.includes('/comments'))).toBe(false);
  });

  it('a pasted marker cannot hijack the sticky comment: only our own login\'s comment is edited', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      ...NO_USER,
      'GET /repos/acme/app/pulls': { body: [pulls[0], pulls[1]] },
      // PR 1: someone else pasted our marker; we post our own comment instead of editing theirs
      'GET /repos/acme/app/issues/1/comments': { body: [{ id: 50, body: `${COMMENT_MARKER}\nfake all-clear`, user: { login: 'mallory' } }] },
      'POST /repos/acme/app/issues/1/comments': { status: 201, body: { id: 51 } },
      'POST /repos/acme/app/issues/1/labels': { body: [] },
      // PR 2 (clean): a foreign marker comment is not "resolved" by us either
      'GET /repos/acme/app/issues/2/comments': { body: [{ id: 60, body: `${COMMENT_MARKER}\nstale!`, user: { login: 'mallory' } }] },
      [`DELETE /repos/acme/app/issues/2/labels/${encodeURIComponent(DEFAULT_STALE_LABEL)}`]: { body: [] },
    });
    const gh = new GitHub({ token: 't', userAgent: 'test', fetch });
    const entries = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main', status: false });
    expect(entries.map((e) => e.published?.comment)).toEqual(['created', 'none']);
    expect(fetch.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(fetch.calls.filter((c) => c.path === '/user')).toHaveLength(1); // resolved once per run
  });

  it('comment-author: an App token\'s own comment is found by that login', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      'GET /repos/acme/app/pulls': { body: [pulls[0]] },
      'GET /repos/acme/app/issues/1/comments': {
        body: [
          { id: 70, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]' } },
          { id: 71, body: `${COMMENT_MARKER}\nold`, user: { login: 'mainfast-app[bot]' } },
        ],
      },
      'PATCH /repos/acme/app/issues/comments/71': { body: {} },
      'POST /repos/acme/app/issues/1/labels': { body: [] },
    });
    const gh = new GitHub({ token: 't', userAgent: 'test', fetch });
    const [e] = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main', status: false, commentAuthor: 'mainfast-app[bot]' });
    expect(e!.published!.comment).toBe('updated');
    expect(fetch.calls.some((c) => c.path === '/user')).toBe(false);
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
  });

  it('escapes hostile PR titles and branch names in the summary table', () => {
    const md = recheckMarkdown(
      [{ number: 3, title: 'x --> <!-- mainfast --> | [win](https://evil.example) @alice', stale: false }],
      'main`<b>',
    );
    expect(md).not.toContain('<!--');
    expect(md).toContain('``main`<b>``'); // inside a code span HTML is shown literally
    expect(md).not.toContain('](https');
    expect(md).toContain('@\u200Balice');
    expect(md.split('\n').at(-1)!.split(/(?<!\\)\|/).length).toBe(5); // | PR | Result | Findings | stays 3 cells
  });

  it('records a PR whose head cannot be fetched and keeps going', async () => {
    const { ws } = world();
    const fetch = mockFetch({
      'GET /repos/acme/app/pulls': { body: [{ ...pulls[0], number: 99 }, pulls[1]] },
      'GET /repos/acme/app/issues/2/comments': { body: [] },
      [`DELETE /repos/acme/app/issues/2/labels/${encodeURIComponent(DEFAULT_STALE_LABEL)}`]: { body: [] },
    });
    const gh = new GitHub({ userAgent: 'test', fetch });
    const entries = await recheckOpenPrs({ repoDir: ws.dir, gh, owner: 'acme', repo: 'app', mainBranch: 'main', status: false });
    expect(entries[0]!.error).toMatch(/could not fetch refs\/pull\/99\/head/);
    expect(entries[1]).toMatchObject({ number: 2, stale: false, published: { label: 'removed' } });
  });
});

describe('cli', () => {
  it('help text names the binary from brand.json', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await cli(['--help'])).toBe(0);
    const text = String(log.mock.calls[0]![0]);
    log.mockRestore();
    expect(text).toContain(`${CLI_NAME} check `);
    expect(text).toContain(`${CLI_NAME} recheck `);
    expect(text).toContain('--no-status');
    expect(CLI_NAME).toBe(product('migrations').cliName);
  });

  it('check exits 1 on a broken migration history and prints JSON', async () => {
    const r = new TempRepo();
    r.commit({ 'alembic/env.py': '', [`${V}/a.py`]: alembicRev('a', null) });
    r.branch('feature');
    r.commit({ [`${V}/b.py`]: alembicRev('b', 'a') });
    r.checkout('main');
    r.commit({ [`${V}/m.py`]: alembicRev('m', 'a') });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await cli(['check', '--repo', r.dir, '--main', 'main', '--head', 'feature', '--format', 'json']);
    const out = JSON.parse(log.mock.calls[0]![0] as string);
    log.mockRestore();
    expect(code).toBe(1);
    expect(out.findings[0].code).toBe('multiple-heads');
  });

  it('check exits 0 and accepts --config', async () => {
    const r = new TempRepo();
    r.commit({ 'db/migrate/20260101000000_a.rb': 'a' });
    r.branch('feature');
    r.commit({ 'db/migrate/20260201000000_b.rb': 'b' });
    r.checkout('main');
    r.commit({ 'db/migrate/20260301000000_m.rb': 'm' });
    const cfg = join(r.dir, '..', `cfg-${Date.now()}.yml`);
    writeFileSync(cfg, 'migrations:\n  outOfOrder: off\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await cli(['check', '--repo', r.dir, '--main', 'main', '--head', 'feature', '--config', cfg]);
    const text = String(log.mock.calls[0]![0]);
    log.mockRestore();
    expect(code).toBe(0);
    expect(text).toMatch(/ok$/);
    expect(readFileSync(cfg, 'utf8')).toContain('off');
  });
});
