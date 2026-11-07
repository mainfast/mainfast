// analyzeTrees runs without git: the hosted App feeds it trees read through the API.
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { analyzeTrees } from '../src/engine.js';
import { Tree, type Blob } from '../src/git.js';

const alembic = (rev: string, down: string) => `revision = '${rev}'\ndown_revision = '${down}'\n`;

function tree(label: string, files: Record<string, string>, blobs: Map<string, string>): Tree {
  const entries = new Map<string, Blob>();
  for (const [path, text] of Object.entries(files)) {
    const sha = `sha-${text}`;
    blobs.set(sha, text);
    entries.set(path, { sha });
  }
  return new Tree('', entries, label, (sha) => blobs.get(sha)!);
}

describe('analyzeTrees', () => {
  it('finds a forked Alembic history from trees with a custom blob reader, without git', () => {
    const blobs = new Map<string, string>();
    const root = { 'alembic/versions/a.py': "revision = 'a'\ndown_revision = None\n" };
    const base = tree('base', root, blobs);
    const main = tree('main', { ...root, 'alembic/versions/b.py': alembic('b', 'a') }, blobs);
    const head = tree('head', { ...root, 'alembic/versions/c.py': alembic('c', 'a') }, blobs);
    const r = analyzeTrees({ main, head, base, mainRef: 'main', headRef: '#1', mainSha: 'm', headSha: 'h', baseSha: 'b', config: parseConfig(undefined) });
    expect(r.roots.map((x) => x.framework)).toEqual(['alembic']);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === 'error')).toBe(true);
  });
});
