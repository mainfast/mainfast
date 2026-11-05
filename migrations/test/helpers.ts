import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const created: string[] = [];

/** A throwaway git repository on disk, with helpers to commit files on branches. */
export class TempRepo {
  readonly dir: string;
  constructor(opts: { bare?: boolean; dir?: string } = {}) {
    this.dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'mainfast-migrations-'));
    created.push(this.dir);
    if (!opts.dir) {
      this.git('init', '-q', ...(opts.bare ? ['--bare'] : []), '-b', 'main');
      this.git('config', 'user.email', 'test@example.com');
      this.git('config', 'user.name', 'Test');
      this.git('config', 'commit.gpgsign', 'false');
    }
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }

  /** Writes files (null deletes) and commits them. */
  commit(files: Record<string, string | null>, message = 'change'): string {
    for (const [p, content] of Object.entries(files)) {
      const full = join(this.dir, p);
      if (content === null) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  branch(name: string, from = 'main'): void {
    this.git('checkout', '-q', '-B', name, from);
  }

  checkout(name: string): void {
    this.git('checkout', '-q', name);
  }
}

export function cleanup(): void {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
}

/**
 * The classic migration-ledger race: `base` is committed on main, then `branchFiles` land
 * on a feature branch and `mainFiles` land on main after it forked.
 */
export function race(
  base: Record<string, string>,
  mainFiles: Record<string, string | null>,
  branchFiles: Record<string, string | null>,
): TempRepo {
  const r = new TempRepo();
  r.commit(base, 'base');
  r.branch('feature');
  r.commit(branchFiles, 'branch migration');
  r.checkout('main');
  r.commit(mainFiles, 'main migration');
  return r;
}

export const alembicRev = (rev: string, down: string | null | string[], extra = '') =>
  `"""msg\n\nRevision ID: ${rev}\nRevises: ${down}\n"""\nfrom alembic import op\n\nrevision: str = '${rev}'\ndown_revision: str | None = ${
    down === null ? 'None' : Array.isArray(down) ? `(${down.map((d) => `'${d}'`).join(', ')})` : `'${down}'`
  }\nbranch_labels = None\ndepends_on = None\n${extra}\n\ndef upgrade() -> None:\n    pass\n`;

export const djangoMig = (deps: Array<[string, string]>, extra = '') =>
  `from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n${extra}\n    dependencies = [\n${deps
    .map(([a, n]) => `        ("${a}", "${n}"),`)
    .join('\n')}\n    ]\n\n    operations = []\n`;

export const drizzleJournal = (entries: Array<[number, number, string]>) =>
  JSON.stringify(
    { version: '7', dialect: 'postgresql', entries: entries.map(([idx, when, tag]) => ({ idx, version: '7', when, tag, breakpoints: true })) },
    null,
    2,
  );

export const snapshot = (id: string, prevId: string) => JSON.stringify({ id, prevId, version: '7', dialect: 'postgresql', tables: {} });

const AV = 'alembic/versions';

/**
 * origin (bare) with main and two open PRs published as refs/pull/<n>/head the
 * way GitHub does; a clone plays the Actions workspace.
 */
export function world(cfg: { main?: string; pr1?: string } = {}) {
  const origin = new TempRepo({ bare: true });
  const dev = new TempRepo();
  dev.git('remote', 'add', 'origin', origin.dir);
  dev.commit({ 'alembic/env.py': '', [`${AV}/a1.py`]: alembicRev('a1', null), ...(cfg.main ? { '.mainfast.yml': cfg.main } : {}) }, 'base');
  dev.git('push', '-q', 'origin', 'main');
  dev.branch('pr1');
  dev.commit({ [`${AV}/b1.py`]: alembicRev('b1', 'a1'), ...(cfg.pr1 ? { '.mainfast.yml': cfg.pr1 } : {}) }, 'pr1 adds b1 on a1');
  dev.git('push', '-q', 'origin', 'pr1:refs/pull/1/head');
  dev.branch('pr2', 'main');
  dev.commit({ 'README.md': 'docs' }, 'pr2 docs only');
  dev.git('push', '-q', 'origin', 'pr2:refs/pull/2/head');
  dev.checkout('main');
  dev.commit({ [`${AV}/m2.py`]: alembicRev('m2', 'a1') }, 'main adds m2 on a1');
  dev.git('push', '-q', 'origin', 'main');

  const ws = new TempRepo({ dir: mkdtempSync(join(tmpdir(), 'mainfast-ws-')) });
  new TempRepo().git('clone', '-q', origin.dir, ws.dir);
  return { origin, ws, dev };
}

