import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_OUT_OF_ORDER, parseConfig } from '../src/config.js';
import { analyze } from '../src/engine.js';
import { toMarkdown } from '../src/report.js';
import { parseAlembic } from '../src/frameworks/alembic.js';
import { compareFlyway, normaliseVersion } from '../src/frameworks/flyway.js';
import { alembicRev, cleanup, djangoMig, drizzleJournal, race, snapshot, TempRepo } from './helpers.js';

afterAll(cleanup);

const codes = (r: ReturnType<typeof analyze>) => r.findings.map((f) => `${f.framework}:${f.code}:${f.severity}`).sort();

describe('alembic', () => {
  const V = 'alembic/versions';
  const base = { 'alembic/env.py': '# env', [`${V}/a1_init.py`]: alembicRev('a1', null) };

  it('flags two heads when main and the branch both build on the same revision', () => {
    const r = race(base, { [`${V}/m2_main.py`]: alembicRev('m2', 'a1') }, { [`${V}/b2_branch.py`]: alembicRev('b2', 'a1') });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.roots).toEqual([{ framework: 'alembic', root: V, touched: true }]);
    expect(codes(rep)).toEqual(['alembic:multiple-heads:error']);
    expect(rep.findings[0]!.hint).toContain('alembic merge');
    expect(rep.findings[0]!.files.sort()).toEqual([`${V}/b2_branch.py`, `${V}/m2_main.py`]);
    expect(rep.ok).toBe(false);
  });

  it('is clean when the branch re-parents onto main\'s head', () => {
    const r = race(base, { [`${V}/m2_main.py`]: alembicRev('m2', 'a1') }, { [`${V}/b2_branch.py`]: alembicRev('b2', 'm2') });
    // the branch's file points at m2, which only exists on main: fine after the merge
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.findings).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('accepts a merge revision with a tuple down_revision', () => {
    const r = race(
      base,
      { [`${V}/m2_main.py`]: alembicRev('m2', 'a1') },
      { [`${V}/b2_branch.py`]: alembicRev('b2', 'a1'), [`${V}/b3_merge.py`]: alembicRev('b3', ['m2', 'b2']) },
    );
    expect(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }).findings).toEqual([]);
  });

  it('flags a missing parent when main deleted the revision the branch builds on', () => {
    const r = race(
      { ...base, [`${V}/a2_x.py`]: alembicRev('a2', 'a1') },
      { [`${V}/a2_x.py`]: null, [`${V}/m2_squash.py`]: alembicRev('m2', 'a1') },
      { [`${V}/b3_branch.py`]: alembicRev('b3', 'a2') },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['alembic:missing-parent:error', 'alembic:multiple-heads:error']);
  });

  it('does not blame the PR for heads main already has', () => {
    const r = new TempRepo();
    r.commit({ ...base, [`${V}/x.py`]: alembicRev('x', 'a1'), [`${V}/y.py`]: alembicRev('y', 'a1') });
    r.branch('feature');
    r.commit({ 'README.md': 'docs only' });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.findings).toEqual([]);
    expect(rep.preExisting.map((f) => f.code)).toEqual(['multiple-heads']);
    expect(rep.roots[0]!.touched).toBe(false);
  });

  it('parses multi-line tuples and the Revision ID header', () => {
    const t = `"""x\n\nRevision ID: abc\n"""\ndown_revision = (\n    "p1",\n    "p2",\n)\n`;
    expect(parseAlembic('v/abc.py', t)).toMatchObject({ revision: 'abc', parents: ['p1', 'p2'] });
  });
});

describe('django', () => {
  // authentik: 0017 depends on 0016, which a squash replaces.
  it('resolves a dependency on a migration that a squash replaces', () => {
    const M2 = 'core/migrations';
    const squash = `${djangoMig([['core', '0011_a']])}\nreplaces = [('core', '0012_b'), ('core', '0016_c')]\n`;
    const files = {
      [`${M2}/__init__.py`]: '',
      [`${M2}/0011_a.py`]: djangoMig([]),
      [`${M2}/0012_b_squashed_0016_c.py`]: squash,
      [`${M2}/0017_d.py`]: djangoMig([['core', '0016_c']]),
    };
    const r = race(files, { 'main.txt': 'm' }, { 'branch.txt': 'b' });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.preExisting.map((f) => f.code)).toEqual([]);
  });

  it('still reports a dependency on a migration nothing provides', () => {
    const M2 = 'core/migrations';
    const files = { [`${M2}/__init__.py`]: '', [`${M2}/0001_a.py`]: djangoMig([]), [`${M2}/0002_b.py`]: djangoMig([['core', '0099_gone']]) };
    const r = race(files, { 'main.txt': 'm' }, { 'branch.txt': 'b' });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.preExisting.map((f) => f.code)).toContain('missing-dependency');
  });

  // saleor/checkout: fix_empty_data_in_lines.py sits between numbered migrations.
  it('counts migrations with no number in their file name', () => {
    const M2 = 'checkout/migrations';
    const files = {
      [`${M2}/__init__.py`]: '',
      [`${M2}/0001_a.py`]: djangoMig([]),
      [`${M2}/fix_lines.py`]: djangoMig([['checkout', '0001_a']]),
      [`${M2}/fix_other.py`]: djangoMig([['checkout', 'fix_lines']]),
      [`${M2}/0002_b.py`]: djangoMig([['checkout', 'fix_other']]),
      [`${M2}/_helpers.py`]: 'x = 1\n',
    };
    const r = race(files, { 'main.txt': 'm' }, { 'branch.txt': 'b' });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.preExisting.map((f) => f.code)).toEqual([]);
  });

  // authentik: authentik/providers/saml has label "authentik_providers_saml", so dependencies do not use the folder name.
  describe('with a custom app label', () => {
    const L = 'authentik/providers/saml/migrations';
    const label = 'authentik_providers_saml';
    const ledger = {
      [`${L}/__init__.py`]: '',
      [`${L}/0001_initial.py`]: djangoMig([]),
      [`${L}/0002_price.py`]: djangoMig([[label, '0001_initial']]),
      [`${L}/0003_more.py`]: djangoMig([[label, '0002_price'], ['other', '0001_initial']]),
    };
    const app = { 'authentik/providers/saml/apps.py': `class SamlConfig(AppConfig):\n    name = "authentik.providers.saml"\n    label = "${label}"\n` };

    for (const [how, files] of [['from apps.py', { ...ledger, ...app }], ['from the dependencies, with no apps.py', ledger]] as const) {
      it(`does not read every migration as a leaf: label ${how}`, () => {
        const r = race(files, { 'main.txt': 'm' }, { [`${L}/0004_branch.py`]: djangoMig([[label, '0003_more']]) });
        expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toEqual([]);
      });

      it(`still reports two leaves: label ${how}`, () => {
        const r = race(files, { [`${L}/0004_main.py`]: djangoMig([[label, '0003_more']]) }, { [`${L}/0004_branch.py`]: djangoMig([[label, '0003_more']]) });
        expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toContain('django:multiple-leaves:error');
      });
    }
  });

  const M = 'shop/migrations';
  const base = {
    [`${M}/__init__.py`]: '',
    [`${M}/0001_initial.py`]: djangoMig([]),
    [`${M}/0002_price.py`]: djangoMig([['shop', '0001_initial']]),
  };

  it('flags duplicate numbers and multiple leaf nodes', () => {
    const r = race(
      base,
      { [`${M}/0003_main.py`]: djangoMig([['shop', '0002_price']]) },
      { [`${M}/0003_branch.py`]: djangoMig([['shop', '0002_price']]) },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['django:duplicate-number:warning', 'django:multiple-leaves:error']);
    expect(rep.findings.find((f) => f.code === 'multiple-leaves')!.hint).toContain('makemigrations --merge shop');
  });

  it('is clean once the branch renumbers onto main\'s leaf', () => {
    const r = race(
      base,
      { [`${M}/0003_main.py`]: djangoMig([['shop', '0002_price']]) },
      { [`${M}/0004_branch.py`]: djangoMig([['shop', '0003_main']]) },
    );
    expect(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }).findings).toEqual([]);
  });

  it('accepts a merge migration and treats squashed originals as one node', () => {
    const r = race(
      base,
      { [`${M}/0003_main.py`]: djangoMig([['shop', '0002_price']]) },
      {
        [`${M}/0003_branch.py`]: djangoMig([['shop', '0002_price']]),
        [`${M}/0004_merge.py`]: djangoMig([['shop', '0003_main'], ['shop', '0003_branch']]),
        [`${M}/0001_squashed_0002.py`]: djangoMig([], '    replaces = [("shop", "0001_initial"), ("shop", "0002_price")]'),
      },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['django:duplicate-number:warning', 'django:duplicate-number:warning']);
    expect(rep.ok).toBe(true);
  });

  it('flags a dependency on a migration main removed', () => {
    const r = race(base, { [`${M}/0002_price.py`]: null }, { [`${M}/0003_branch.py`]: djangoMig([['shop', '0002_price']]) });
    expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toContain('django:missing-dependency:error');
  });
});

describe('prisma', () => {
  const M = 'prisma/migrations';
  const base = { 'prisma/schema.prisma': '', [`${M}/migration_lock.toml`]: 'provider = "postgresql"', [`${M}/20260101000000_init/migration.sql`]: 'create table a();' };

  it('flags a branch migration older than main\'s latest', () => {
    const r = race(
      base,
      { [`${M}/20260301000000_main/migration.sql`]: 'alter table a add b int;' },
      { [`${M}/20260201000000_branch/migration.sql`]: 'alter table a add c int;' },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['prisma:out-of-order:error']);
    expect(rep.findings[0]!.files).toEqual([`${M}/20260201000000_branch`, `${M}/20260301000000_main`]);
  });

  it('passes when the branch migration is newer, and honors outOfOrder from .mainfast.yml on main', () => {
    const ok = race(base, { [`${M}/20260201000000_main/migration.sql`]: 'x' }, { [`${M}/20260301000000_branch/migration.sql`]: 'y' });
    expect(analyze({ repo: ok.dir, mainRef: 'main', headRef: 'feature' }).findings).toEqual([]);

    const warn = race(
      { ...base, '.mainfast.yml': 'migrations:\n  outOfOrder: warning\n' },
      { [`${M}/20260301000000_main/migration.sql`]: 'x' },
      { [`${M}/20260201000000_branch/migration.sql`]: 'y', '.mainfast.yml': 'migrations:\n  outOfOrder: off\n' },
    );
    const rep = analyze({ repo: warn.dir, mainRef: 'main', headRef: 'feature' });
    // config comes from main, so the branch's attempt to switch the check off is ignored
    expect(codes(rep)).toEqual(['prisma:out-of-order:warning']);
    expect(rep.ok).toBe(true);
  });

  it('flags duplicate timestamps', () => {
    const r = race(base, { [`${M}/20260301000000_a/migration.sql`]: 'x' }, { [`${M}/20260301000000_b/migration.sql`]: 'y' });
    expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toEqual([
      'prisma:duplicate-timestamp:error',
      'prisma:out-of-order:error',
    ]);
  });
});

describe('rails', () => {
  const M = 'db/migrate';
  const base = { [`${M}/20260101000000_create_users.rb`]: 'class CreateUsers < ActiveRecord::Migration[7.1]; end' };

  it('flags a branch migration older than main\'s latest', () => {
    const r = race(base, { [`${M}/20260301000000_add_email.rb`]: 'x' }, { [`${M}/20260201000000_add_name.rb`]: 'y' });
    // Rails runs an older pending migration anyway: a warning by default, so the PR still passes
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['rails:out-of-order:warning']);
    expect(rep.ok).toBe(true);
  });

  it('flags duplicate versions and duplicate names', () => {
    const r = race(
      base,
      { [`${M}/20260301000000_add_email.rb`]: 'x' },
      { [`${M}/20260301000000_add_phone.rb`]: 'y', [`${M}/20260401000000_add_email.rb`]: 'z' },
    );
    expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toEqual([
      'rails:duplicate-name:error',
      'rails:duplicate-version:error',
      'rails:out-of-order:warning',
    ]);
  });

  it('finds multi-database migrate dirs', () => {
    const r = race(
      { ...base, 'db/analytics_migrate/20260101000000_init.rb': 'a' },
      { 'db/analytics_migrate/20260301000000_m.rb': 'b' },
      { 'db/analytics_migrate/20260201000000_b.rb': 'c' },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.roots.map((x) => x.root).sort()).toEqual(['db/analytics_migrate', 'db/migrate']);
    expect(rep.findings.map((f) => f.root)).toEqual(['db/analytics_migrate']);
  });
});

describe('flyway', () => {
  const M = 'src/main/resources/db/migration';
  const base = { [`${M}/V1__init.sql`]: 'create table a();', [`${M}/V2__b.sql`]: 'x' };

  it('flags the same version added on both sides', () => {
    const r = race(base, { [`${M}/V3__main.sql`]: 'm' }, { [`${M}/V3__branch.sql`]: 'b' });
    expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toEqual([
      'flyway:duplicate-version:error',
      'flyway:out-of-order:warning',
    ]);
  });

  it('compares versions numerically by segment', () => {
    const r = race(base, { [`${M}/V2_10__main.sql`]: 'm' }, { [`${M}/V2.9__branch.sql`]: 'b' });
    expect(codes(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }))).toEqual(['flyway:out-of-order:warning']);
    const ok = race(base, { [`${M}/V2.9__main.sql`]: 'm' }, { [`${M}/V2.10__branch.sql`]: 'b' });
    expect(analyze({ repo: ok.dir, mainRef: 'main', headRef: 'feature' }).findings).toEqual([]);
    expect(normaliseVersion('1_1')).toBe('1.1');
    expect(normaliseVersion('3.0')).toBe('3');
    expect(compareFlyway('1.10', '1.9')).toBe(1);
  });
});

describe('drizzle', () => {
  const D = 'packages/db/migrations';
  const base = {
    [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users']]),
    [`${D}/0000_init.sql`]: 'a',
    [`${D}/0001_users.sql`]: 'b',
    [`${D}/meta/0000_snapshot.json`]: snapshot('s0', '00000000-0000-0000-0000-000000000000'),
    [`${D}/meta/0001_snapshot.json`]: snapshot('s1', 's0'),
  };

  it('flags the journal fork: same idx on both sides', () => {
    const r = race(
      base,
      {
        [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users'], [2, 300, '0002_main_orders']]),
        [`${D}/0002_main_orders.sql`]: 'm',
        [`${D}/meta/0002_snapshot.json`]: snapshot('sm', 's1'),
      },
      {
        [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users'], [2, 250, '0002_branch_tags']]),
        [`${D}/0002_branch_tags.sql`]: 'b',
        [`${D}/meta/0002_snapshot.json`]: snapshot('sb', 's1'),
      },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.roots).toEqual([{ framework: 'drizzle', root: D, touched: true }]);
    expect(codes(rep)).toEqual(['drizzle:duplicate-idx:error', 'drizzle:journal-fork:error', 'drizzle:when-out-of-order:warning']);
    expect(rep.findings.find((f) => f.code === 'journal-fork')!.message).toContain('0002_main_orders');
  });

  it('flags a branch journal that dropped main\'s entries during a bad sync', () => {
    const r = new TempRepo();
    r.commit(base);
    r.commit({
      [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users'], [2, 300, '0002_main']]),
      [`${D}/0002_main.sql`]: 'm',
      [`${D}/meta/0002_snapshot.json`]: snapshot('sm', 's1'),
    });
    r.branch('feature');
    // the branch "resolved" the journal by keeping its own side only
    r.commit({
      [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users'], [2, 400, '0002_branch']]),
      [`${D}/0002_branch.sql`]: 'b',
      [`${D}/meta/0003_snapshot.json`]: snapshot('sb', 's1'),
    });
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(codes(rep)).toEqual(['drizzle:snapshot-fork:error', 'drizzle:sql-not-in-journal:error']);
  });

  it('is clean when the branch appended after main\'s entries', () => {
    const r = race(
      base,
      { 'README.md': 'main moved, no migrations' },
      {
        [`${D}/meta/_journal.json`]: drizzleJournal([[0, 100, '0000_init'], [1, 200, '0001_users'], [2, 300, '0002_b']]),
        [`${D}/0002_b.sql`]: 'b',
        [`${D}/meta/0002_snapshot.json`]: snapshot('sb', 's1'),
      },
    );
    expect(analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' }).findings).toEqual([]);
  });
});

describe('outOfOrder severity per framework', () => {
  const P = 'prisma/migrations';
  const R = 'db/migrate';
  const F = 'db/migration';
  const D = 'drizzle';
  // One repo with three ordered ledgers (and a Drizzle journal fork): each side adds one migration after the fork.
  const base = {
    [`${P}/20260101000000_init/migration.sql`]: 'a',
    [`${R}/20260101000000_init.rb`]: 'a',
    [`${F}/V1__init.sql`]: 'a',
    [`${D}/0000_init.sql`]: 'a',
    [`${D}/meta/_journal.json`]: drizzleJournal([[0, 1, '0000_init']]),
  };
  const onMain = {
    [`${P}/20260301000000_main/migration.sql`]: 'm',
    [`${R}/20260301000000_main.rb`]: 'm',
    [`${F}/V3__main.sql`]: 'm',
    [`${D}/0001_main.sql`]: 'm',
    [`${D}/meta/_journal.json`]: drizzleJournal([[0, 1, '0000_init'], [1, 3, '0001_main']]),
  };
  const onBranch = {
    [`${P}/20260201000000_branch/migration.sql`]: 'b',
    [`${R}/20260201000000_branch.rb`]: 'b',
    [`${F}/V2__branch.sql`]: 'b',
    [`${D}/0001_branch.sql`]: 'b',
    [`${D}/meta/_journal.json`]: drizzleJournal([[0, 1, '0000_init'], [1, 2, '0001_branch']]),
  };
  const ordering = (cfg?: string) => {
    const r = race(cfg ? { ...base, '.mainfast.yml': cfg } : base, onMain, onBranch);
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    return Object.fromEntries(
      rep.findings.filter((f) => f.code === 'out-of-order' || f.code === 'journal-fork').map((f) => [f.framework, f.severity]),
    );
  };

  it('defaults: Rails and Flyway warning, Prisma and Drizzle error', () => {
    expect(ordering()).toEqual({ prisma: 'error', rails: 'warning', flyway: 'warning', drizzle: 'error' });
    expect(DEFAULT_OUT_OF_ORDER).toEqual({ alembic: 'error', django: 'error', prisma: 'error', rails: 'warning', flyway: 'warning', drizzle: 'error' });
  });

  it('one value applies to every framework', () => {
    expect(ordering('migrations:\n  outOfOrder: error\n')).toEqual({ prisma: 'error', rails: 'error', flyway: 'error', drizzle: 'error' });
    expect(ordering('migrations:\n  outOfOrder: off\n')).toEqual({});
  });

  it('a map sets the frameworks it names; the rest keep their default', () => {
    expect(ordering('migrations:\n  outOfOrder:\n    rails: error\n    prisma: off\n')).toEqual({ rails: 'error', flyway: 'warning', drizzle: 'error' });
  });

  it('rejects unknown frameworks and severities in the map', () => {
    expect(() => parseConfig('migrations:\n  outOfOrder: { knex: error }\n')).toThrow(/outOfOrder: unknown framework knex/);
    expect(() => parseConfig('migrations:\n  outOfOrder: { rails: notice }\n')).toThrow(/outOfOrder.rails: expected error, warning or off/);
    expect(() => parseConfig('migrations:\n  outOfOrder: loud\n')).toThrow(/outOfOrder: expected error, warning, off or a map/);
    expect(parseConfig('migrations:\n  outOfOrder: warning\n').outOfOrder.alembic).toBe('warning');
  });
});

describe('detection and config', () => {
  it('finds several frameworks in one repo and honors ignore + explicit paths', () => {
    const r = race(
      {
        'api/alembic/env.py': '',
        'api/alembic/versions/a.py': alembicRev('a', null),
        'legacy/db/migrate/20200101000000_x.rb': 'x',
        'custom/sql/V1__init.sql': 'x',
        '.mainfast.yml': 'migrations:\n  ignore: ["legacy/**"]\n  paths:\n    flyway: [custom/sql]\n',
      },
      { 'api/alembic/versions/m.py': alembicRev('m', 'a'), 'legacy/db/migrate/20200301000000_m.rb': 'm' },
      { 'api/alembic/versions/b.py': alembicRev('b', 'a'), 'legacy/db/migrate/20200201000000_b.rb': 'b' },
    );
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feature' });
    expect(rep.roots.map((x) => `${x.framework}:${x.root}`).sort()).toEqual(['alembic:api/alembic/versions', 'flyway:custom/sql']);
    expect(codes(rep)).toEqual(['alembic:multiple-heads:error']);
  });

  it('rejects unknown frameworks in config', () => {
    const r = new TempRepo();
    r.commit({ '.mainfast.yml': 'migrations:\n  frameworks: [knex]\n' });
    expect(() => analyze({ repo: r.dir, mainRef: 'main', headRef: 'main' })).toThrow(/unknown knex/);
  });

  it('explains a missing merge-base', () => {
    const r = new TempRepo();
    r.commit({ a: '1' });
    r.git('checkout', '-q', '--orphan', 'other');
    r.commit({ b: '2' });
    expect(() => analyze({ repo: r.dir, mainRef: 'main', headRef: 'other' })).toThrow(/fetch-depth: 0/);
  });
});

describe('hostile text in the report', () => {
  it('escapes file names, branch names and revision ids before they reach Markdown', () => {
    const M = 'db/migrate';
    const evil = '20260201000000_x_--_<img_src=x>_@alice_[a](b)';
    const r = race({ [`${M}/20260101000000_init.rb`]: 'a' }, { [`${M}/20260301000000_main.rb`]: 'm' }, { [`${M}/${evil}.rb`]: 'b' });
    r.git('branch', '-m', 'feature', 'feat<!--x');
    const rep = analyze({ repo: r.dir, mainRef: 'main', headRef: 'feat<!--x' });
    expect(rep.findings.map((f) => f.code)).toEqual(['out-of-order']);
    const md = toMarkdown(rep);
    const table = md.split('\n').filter((l) => l.startsWith('| warning'));
    expect(table).toHaveLength(1);
    expect(table[0]).not.toContain('<img');
    expect(table[0]).not.toMatch(/(?<!\\)\[a\]/);
    expect(table[0]).toContain('@​alice');
    expect(table[0]!.split(/(?<!\\)\|/).length).toBe(7); // 5 cells, not split by the file name
    expect(md).toContain('`feat<!--x`'); // the branch name stays inside a code span
  });
});
