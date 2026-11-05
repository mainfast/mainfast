import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { audit, similarity } from '../src/audit.js';
import { CHECK_NAME } from '../src/brand.js';
import { main as cli } from '../src/cli.js';
import { collect } from '../src/collect.js';
import { parseConfig } from '../src/config.js';
import { createCheckRun } from '../src/publish.js';
import { codeBlock, toMarkdown, toText } from '../src/report.js';
import { FIXES } from '../src/audit.js';
import { issueBody } from '../src/publish.js';
import { ISSUE_MARKER } from '../src/brand.js';
import { GitHub } from '@mainfast/shared/github';
import { mockFetch, type MockRoute } from '@mainfast/shared/mockfetch';
import type { Snapshot } from '../src/types.js';
import { parseWorkflow, producersOf } from '../src/workflows.js';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const routesJson = JSON.parse(readFileSync(fixture('acme-web.routes.json'), 'utf8')) as Record<string, unknown>;
const routes = (extra: Record<string, MockRoute> = {}) => ({
  ...Object.fromEntries(Object.entries(routesJson).map(([k, body]) => [k, { body }])),
  ...extra,
});
const gh = (fetch: ReturnType<typeof mockFetch>) => new GitHub({ token: 't', userAgent: 'test', fetch });
const now = () => new Date('2026-10-27T00:00:00Z');

async function acme(extra: Record<string, MockRoute> = {}) {
  const fetch = mockFetch(routes(extra));
  const snap = await collect({ gh: gh(fetch), owner: 'acme', repo: 'web', now });
  return { fetch, snap, report: audit(snap) };
}

const summary = (r: ReturnType<typeof audit>) => r.findings.map((f) => `${f.severity} ${f.code}${f.context ? ` ${f.context}` : ''}`).sort();

describe('collect + audit against fixture API responses', () => {
  it('finds every planted problem', async () => {
    const { fetch, report } = await acme();
    expect(fetch.calls.filter((c) => !c.matched)).toEqual([]);
    expect(report.branch).toBe('main');
    expect(report.sampledPulls).toEqual([108, 107, 106, 105, 104, 103, 102, 101]);
    expect(report.required.map((r) => r.context).sort()).toEqual(['build', 'ci/circleci: build', 'e2e', 'lint', 'test', 'typecheck']);
    expect(summary(report)).toEqual([
      'error matrix-name-mismatch test',
      'error never-ran ci/circleci: build',
      'error path-filtered e2e',
      'error renamed lint',
      'error skipped-as-success typecheck',
      'warning conditional-job typecheck',
      'warning merged-without e2e',
      'warning protection-drift',
      'warning protection-drift ci/circleci: build',
      'warning protection-drift e2e',
      'warning protection-drift lint',
      'warning protection-drift typecheck',
      'warning ruleset-not-enforced',
      'warning skips-when-needs-fail typecheck',
    ]);
    expect(report.ok).toBe(false);
  });

  it('explains each finding with evidence and a fix', async () => {
    const { report } = await acme();
    const f = (code: string) => report.findings.find((x) => x.code === code)!;
    expect(f('renamed').message).toContain('`eslint` first appears on exactly those PRs');
    expect(f('renamed').evidence).toEqual([108, 107, 106]);
    expect(f('skipped-as-success').evidence).toEqual([105]);
    expect(f('matrix-name-mismatch').message).toContain('`test (20)`');
    expect(f('path-filtered').message).toContain('web/**');
    expect(f('never-ran').message).toContain('No job in .github/workflows produces this name');
    expect(f('ruleset-not-enforced').message).toContain('`codeql`');
    expect(f('merged-without').evidence).toEqual([107, 105, 103, 101]);
    const typecheck = report.tallies.find((t) => t.context === 'typecheck')!;
    expect(typecheck).toMatchObject({ sampled: 8, passed: 7, skipped: 1, missing: 0, sources: ['ruleset "main protection"'] });
  });

  it('renders a check-run summary and a JSON-safe report', async () => {
    const { report } = await acme();
    const md = toMarkdown(report);
    expect(md).toContain('| `typecheck` | ruleset "main protection" | 7/8 | 1 |');
    expect(md).toContain('5 error(s), 9 warning(s) in 6 required check(s)');
    expect(JSON.parse(JSON.stringify(report)).findings).toHaveLength(14);
  });

  it('keeps going with notes when the token cannot read rulesets or protection', async () => {
    const { report } = await acme({
      'GET /repos/acme/web/rules/branches/main': { status: 403, body: { message: 'Resource not accessible by integration' } },
      'GET /repos/acme/web/rulesets': { status: 403, body: { message: 'Resource not accessible by integration' } },
    });
    expect(report.notes.some((n) => n.includes('rules/branches/main: 403'))).toBe(true);
    expect(report.required.map((r) => r.context)).not.toContain('typecheck');
    expect(report.findings.some((f) => f.code === 'protection-drift')).toBe(false);
  });

  it('says a free-plan private repository was not audited, and does not blame the token', async () => {
    const upgrade = { status: 403, body: { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' } };
    const { report } = await acme({ 'GET /repos/acme/web/rules/branches/main': upgrade, 'GET /repos/acme/web/rulesets': upgrade });
    const note = report.notes.find((n) => n.includes('rules/branches/main: 403'));
    expect(note).toContain('not available on this GitHub plan');
    expect(note).not.toContain('token lacks permission');
    const md = toMarkdown({ ...report, required: [], tallies: [], findings: [] }); // the fixture also has classic protection
    expect(md).toContain('**Not audited:**');
    expect(md).not.toContain('No required status checks found');
    expect(md).not.toContain('report as intended');
  });

  it('falls back to the protection endpoint when "Get a branch" omits the checks', async () => {
    const { report, fetch } = await acme({
      'GET /repos/acme/web/branches/main': { body: { name: 'main', protected: true, protection: { enabled: true } } },
      'GET /repos/acme/web/branches/main/protection/required_status_checks': {
        body: { url: 'x', strict: true, contexts: ['build'], checks: [{ context: 'build', app_id: 15368 }], contexts_url: 'x' },
      },
    });
    expect(fetch.calls.some((c) => c.path.endsWith('/protection/required_status_checks'))).toBe(true);
    expect(report.required.find((r) => r.context === 'build')!.sources.map((s) => s.kind)).toEqual(['classic', 'ruleset']);
  });

  it('follows Link pagination for check runs', async () => {
    const sha = (108).toString(16).padStart(40, '0');
    const page1 = routesJson[`GET /repos/acme/web/commits/${sha}/check-runs`] as { check_runs: unknown[] };
    const { snap } = await acme({
      [`GET /repos/acme/web/commits/${sha}/check-runs?filter=latest&per_page=100`]: {
        body: { total_count: 99, check_runs: page1.check_runs.slice(0, 2) },
        headers: { link: `<https://api.github.com/repos/acme/web/commits/${sha}/check-runs?filter=latest&per_page=100&page=2>; rel="next"` },
      },
      [`GET /repos/acme/web/commits/${sha}/check-runs?filter=latest&per_page=100&page=2`]: { body: { total_count: 99, check_runs: page1.check_runs.slice(2) } },
    });
    expect(snap.pulls[0]!.checkRuns).toHaveLength(page1.check_runs.length);
  });

  it('posts a completed check run with the summary', async () => {
    const { report } = await acme();
    const fetch = mockFetch({ 'POST /repos/acme/web/check-runs': { status: 201, body: { id: 7 } } });
    const id = await createCheckRun(gh(fetch), 'acme', 'web', 'abc', report, 'error');
    expect(id).toBe(7);
    const body = fetch.calls[0]!.body;
    expect(body).toMatchObject({ name: CHECK_NAME, head_sha: 'abc', status: 'completed', conclusion: 'failure' });
    expect(body.output.summary.length).toBeLessThanOrEqual(65535);
    const neutral = await createCheckRun(gh(fetch), 'acme', 'web', 'abc', report, 'never');
    expect(neutral).toBe(7);
    expect(fetch.calls[1]!.body.conclusion).toBe('neutral');
  });
});

function snapshot(partial: Partial<Snapshot>): Snapshot {
  return { repository: 'o/r', branch: 'main', collectedAt: 'now', classic: null, branchRules: [], rulesets: [], pulls: [], workflows: [], ...partial };
}
const run = (name: string, conclusion: any = 'success', appId = 15368) => ({ id: 1, name, head_sha: 's', status: 'completed' as const, conclusion, app: { id: appId, slug: appId === 15368 ? 'github-actions' : 'other-ci' } });

describe('audit rules in isolation', () => {
  it('flags a required check pinned to another app', () => {
    const r = audit(
      snapshot({
        classic: { contexts: ['build'], checks: [{ context: 'build', app_id: 15368 }] },
        pulls: [{ number: 1, title: '', headSha: 's', checkRuns: [run('build', 'success', 4242)], statuses: [] }],
      }),
    );
    expect(summary(r)).toEqual(['error app-mismatch build']);
  });

  it('flags a required job whose workflow only runs on push, or not for PRs into this branch', () => {
    const wf = (on: string) => ({ path: '.github/workflows/x.yml', text: `on: ${on}\njobs:\n  build:\n    runs-on: x\n` });
    const base = { classic: { contexts: ['build'], checks: [] }, pulls: [{ number: 1, title: '', headSha: 's', checkRuns: [run('build')], statuses: [] }] };
    expect(summary(audit(snapshot({ ...base, workflows: [wf('push')] })))).toEqual(['error not-on-pull-request build']);
    expect(summary(audit(snapshot({ ...base, workflows: [wf('{pull_request: {branches: [release/*]}}')] })))).toEqual(['error branch-filtered build']);
    expect(summary(audit(snapshot({ ...base, workflows: [wf('{pull_request: {branches: [main, release/*]}}')] })))).toEqual([]);
  });

  it('accepts a gate job with if: always()', () => {
    const text = `on: pull_request\njobs:\n  a:\n    runs-on: x\n  gate:\n    needs: [a]\n    if: always()\n    runs-on: x\n`;
    const r = audit(
      snapshot({
        classic: { contexts: ['gate'], checks: [] },
        workflows: [{ path: '.github/workflows/g.yml', text }],
        pulls: [{ number: 1, title: '', headSha: 's', checkRuns: [run('gate')], statuses: [] }],
      }),
    );
    expect(r.findings).toEqual([]);
  });

  it('counts commit statuses, and both must pass when a status and a check share a name', () => {
    const r = audit(
      snapshot({
        classic: { contexts: ['ci'], checks: [] },
        pulls: [
          { number: 2, title: '', headSha: 's', checkRuns: [run('ci')], statuses: [{ context: 'ci', state: 'failure' }] },
          { number: 1, title: '', headSha: 's', checkRuns: [], statuses: [{ context: 'ci', state: 'success' }] },
        ],
      }),
    );
    expect(r.tallies[0]).toMatchObject({ passed: 1, failed: 1 });
    expect(summary(r)).toEqual(['warning merged-with-failure ci']);
  });

  it('ignores its own check and configured contexts; with no PRs only static checks run', () => {
    const r = audit(snapshot({ classic: { contexts: [CHECK_NAME, 'legacy'], checks: [] } }), { ignore: ['legacy'] });
    expect(r.required).toEqual([]);
    expect(r.notes).toContain('no merged or open PRs into this branch were found; only static checks ran');
  });

  it('parses workflow job names into check-run patterns', () => {
    const w = parseWorkflow({
      path: 'w.yml',
      text: `on: [pull_request, push]\njobs:\n  t:\n    name: Test on \${{ matrix.os }}\n    strategy: {matrix: {os: [a, b]}}\n  m:\n    strategy: {matrix: {v: [1]}}\n  call:\n    name: Deploy\n    uses: ./.github/workflows/deploy.yml\n`,
    });
    expect(w.prTriggers).toEqual([{ event: 'pull_request' }]);
    expect(w.jobs.map((j) => j.display)).toEqual(['Test on …', 'm (…)', 'Deploy / …']);
    expect(producersOf('Test on ubuntu', [w]).map((j) => j.id)).toEqual(['t']);
    expect(producersOf('m (1)', [w]).map((j) => j.id)).toEqual(['m']);
    expect(producersOf('Deploy / prod', [w]).map((j) => j.id)).toEqual(['call']);
    expect(producersOf('m', [w])).toEqual([]);
    expect(similarity('lint', 'eslint')).toBeGreaterThan(0.6);
  });

  it('validates config', () => {
    expect(parseConfig('rollcall:\n  pulls: 5\n  ignore: [x]\n')).toMatchObject({ pulls: 5, ignore: ['x'] });
    expect(() => parseConfig('rollcall:\n  pulls: 500\n')).toThrow(/1..100/);
  });
});

describe('cli', () => {
  it('audits a saved snapshot offline and exits 1 on errors', async () => {
    const { snap } = await acme();
    const dir = mkdtempSync(join(tmpdir(), 'rollcall-'));
    const file = join(dir, 'snap.json');
    writeFileSync(file, JSON.stringify(snap));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await cli(['audit', '--snapshot', file, '--format', 'json']);
    const out = JSON.parse(String(log.mock.calls[0]![0]));
    log.mockRestore();
    expect(code).toBe(1);
    expect(out.findings).toHaveLength(14);
  });
});

const pr = (number: number, checkRuns: any[], extra: Record<string, unknown> = {}) => ({ number, title: '', headSha: 's', checkRuns, statuses: [], ...extra });
const pendingRun = (name: string, status = 'in_progress') => ({ id: 2, name, head_sha: 's', status, conclusion: null, app: { id: 15368, slug: 'github-actions' } });

describe('merged and open PRs', () => {
  it('samples open PRs too, newest first; skipped on an open PR counts, a failing open PR is not a bypass', async () => {
    const sha = (n: number) => n.toString(16).padStart(40, '0');
    const runs = (n: number, list: Array<[string, string]>) => ({ total_count: list.length, check_runs: list.map(([name, conclusion], i) => ({ id: n * 10 + i, name, head_sha: sha(n), status: 'completed', conclusion, app: { id: 15368, slug: 'github-actions' } })) });
    const open = [
      { number: 120, title: 'Open 120', state: 'open', head: { sha: sha(120) }, merged_at: null, updated_at: '2026-10-20T00:00:00Z' },
      { number: 121, title: 'Open 121', state: 'open', head: { sha: sha(121) }, merged_at: null, updated_at: '2026-10-21T00:00:00Z' },
      { number: 122, title: 'Open 122 (CI not started)', state: 'open', head: { sha: sha(122) }, merged_at: null, updated_at: '2026-10-22T00:00:00Z' },
    ];
    const ok: Array<[string, string]> = [['build', 'success'], ['test (20)', 'success'], ['eslint', 'success'], ['typecheck', 'success']];
    const { snap, report } = await acme({
      'GET /repos/acme/web/pulls?state=open&base=main&sort=updated&direction=desc': { body: open },
      [`GET /repos/acme/web/commits/${sha(120)}/check-runs`]: { body: runs(120, [['build', 'failure'], ['test (20)', 'success'], ['eslint', 'success'], ['typecheck', 'skipped']]) },
      [`GET /repos/acme/web/commits/${sha(121)}/check-runs`]: { body: runs(121, ok) },
      [`GET /repos/acme/web/commits/${sha(122)}/check-runs`]: { body: { total_count: 0, check_runs: [] } },
      [`GET /repos/acme/web/commits/${sha(120)}/status`]: { body: { statuses: [] } },
      [`GET /repos/acme/web/commits/${sha(121)}/status`]: { body: { statuses: [] } },
      [`GET /repos/acme/web/commits/${sha(122)}/status`]: { body: { statuses: [] } },
    });
    expect(snap.pulls.map((p) => p.number)).toEqual([121, 120, 108, 107, 106, 105, 104, 103, 102, 101]);
    expect(report.sampledOpen).toEqual([121, 120]);
    expect(report.sampledPulls).toEqual([108, 107, 106, 105, 104, 103, 102, 101]);
    expect(report.notes).toContain('1 open PR(s) had no check runs or statuses on their head yet and were not counted');
    const f = (code: string, ctx: string) => report.findings.find((x) => x.code === code && x.context === ctx);
    expect(f('skipped-as-success', 'typecheck')!.evidence).toEqual([120, 105]);
    expect(f('merged-with-failure', 'build')).toBeUndefined();
    expect(f('renamed', 'lint')!.evidence).toEqual([121, 120, 108, 107, 106]);
    expect(report.tallies.find((t) => t.context === 'build')).toMatchObject({ sampled: 10, open: 2, failed: 1 });
  });

  it('a check still pending (or stale) at merge time is merged-while-pending, not merged-with-failure', () => {
    const r = audit(
      snapshot({
        classic: { contexts: ['build'], checks: [] },
        pulls: [
          pr(4, [pendingRun('build')]),
          pr(3, [{ ...run('build'), conclusion: 'stale' }]),
          pr(2, [run('build', 'failure')]),
          pr(1, [], { statuses: [{ context: 'build', state: 'pending' }] }),
          pr(5, [pendingRun('build', 'queued')], { state: 'open' }),
        ],
      }),
    );
    expect(summary(r)).toEqual(['warning merged-while-pending build', 'warning merged-with-failure build']);
    const f = (code: string) => r.findings.find((x) => x.code === code)!;
    expect(f('merged-while-pending').evidence).toEqual([4, 3, 1]);
    expect(f('merged-with-failure').evidence).toEqual([2]);
    expect(r.tallies[0]).toMatchObject({ pending: 4, failed: 1, open: 1 });
  });

  it('a check run for another commit is stale evidence and does not count for the head', () => {
    const r = audit(snapshot({ classic: { contexts: ['build'], checks: [] }, pulls: [pr(1, [{ ...run('build'), head_sha: 'other' }])] }));
    expect(r.tallies[0]).toMatchObject({ missing: 1, passed: 0 });
  });

  it('every finding carries a one-line fix', async () => {
    const { report } = await acme();
    for (const f of report.findings) expect(f.hint, f.code).toBeTruthy();
    for (const code of ['never-ran', 'renamed', 'stopped-reporting', 'matrix-name-mismatch', 'skipped-as-success', 'path-filtered', 'branch-filtered', 'not-on-pull-request', 'app-mismatch', 'required-workflow-missing', 'conditional-job', 'skips-when-needs-fail', 'neutral-as-success', 'merged-without', 'merged-with-failure', 'merged-while-pending', 'protection-drift', 'ruleset-not-enforced', 'ambiguous-name', 'workflow-unparsable'])
      expect(FIXES[code], code).toBeTruthy();
  });
});

describe('untrusted text is escaped everywhere it is rendered', () => {
  const evil = 'ci --> <!-- mainfast-rollcall:sticky --> @acme/admins | [x](https://evil.example) `rm`';
  const hostile = () =>
    audit(
      snapshot({
        repository: 'acme/web',
        branch: 'main<img src=x>@root',
        classic: { contexts: [evil, 'lint'], checks: [] },
        branchRules: [{ type: 'required_status_checks', ruleset_id: 9, parameters: { required_status_checks: [{ context: evil }] } }],
        rulesets: [
          { id: 9, name: 'r <!-- @acme/sec', enforcement: 'active' },
          { id: 10, name: '@acme/team trial', enforcement: 'evaluate', rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: '<script>@bob' }] } }] },
        ],
        workflows: [{ path: '.github/workflows/w.yml', text: `on: push\njobs:\n  x:\n    name: "${evil.replace(/"/g, '')}"\n    if: github.actor != '@eve|x'\n    runs-on: x\n` }],
        pulls: [pr(1, [run('elint @carol <b>')])],
        notes: ['GET /x: 403 <!-- @dave'],
      }),
    );

  // Code spans are inert on GitHub (no HTML, no mentions, no links inside), so look at the rest.
  const outsideCode = (md: string) => md.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
  const check = (md: string) => {
    const text = outsideCode(md.replace(new RegExp(`^${ISSUE_MARKER}\\n`), ''));
    // the only HTML comment is our own marker at the very start of the issue body
    expect(text).not.toContain('<!--');
    expect(text).not.toMatch(/<(img|script|b)\b/);
    expect(text).not.toMatch(/@(acme|root|bob|carol|dave|eve)/);
    expect(text).not.toMatch(/(?<!\\)\[x\]\(https/);
  };

  it('in the job / check-run summary and the tracking issue', () => {
    const r = hostile();
    expect(r.findings.length).toBeGreaterThan(0);
    check(toMarkdown(r, { runUrl: 'https://github.com/acme/web/actions/runs/1' }));
    check(issueBody(r));
    const rows = toMarkdown(r).split('\n').filter((l) => l.startsWith('| error') || l.startsWith('| warning'));
    for (const row of rows) expect(row.replace(/\\\|/g, '').split('|').length).toBe(6);
  });

  it('in the check-run JSON block and plain text', () => {
    const block = codeBlock('{"name":"a ```` b"}', 'json');
    expect(block.startsWith('`````json\n')).toBe(true);
    expect(toText(hostile())).not.toMatch(/[\u0000-\u0008\u001b]/);
  });

  it('an unsafe run URL is dropped', () => {
    expect(toMarkdown(hostile(), { runUrl: 'javascript:alert(1)' })).not.toContain('javascript:');
  });
});
