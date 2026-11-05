// Flyway: V<version>__<description>.sql, versions compared numerically by segment
// ("1.10" > "1.9", "1_1" == "1.1"). With the default outOfOrder=false Flyway
// refuses a pending migration whose version is below the database's latest.
import type { Tree } from '../git.js';
import type { Finding, Framework } from '../types.js';
import { basename, dirname, groupBy, outOfOrder, uniq, type Versioned } from './common.js';

const FILE = /(^|\/)V(\d+(?:[._]\d+)*)__[^/]+\.sql$/;

export function normaliseVersion(v: string): string {
  const parts = v.split(/[._]/).map((p) => String(BigInt(p)));
  while (parts.length > 1 && parts[parts.length - 1] === '0') parts.pop();
  return parts.join('.');
}

export function compareFlyway(a: string, b: string): number {
  const x = a.split('.').map(BigInt);
  const y = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0n;
    const q = y[i] ?? 0n;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function list(tree: Tree, root: string): Versioned[] {
  return tree
    .under(root)
    .filter((f) => dirname(f) === root && FILE.test(f))
    .map((f) => ({ version: normaliseVersion(basename(f).match(/^V([^_]+(?:_\d+)*)__/)?.[1] ?? '0'), path: f }));
}

export const flyway: Framework = {
  id: 'flyway',
  detect(files) {
    return uniq(files.filter((f) => FILE.test(f)).map(dirname));
  },
  inspect(tree, root) {
    const findings: Finding[] = [];
    for (const [v, l] of groupBy(list(tree, root), (m) => m.version)) {
      if (l.length > 1)
        findings.push({
          framework: 'flyway',
          root,
          code: 'duplicate-version',
          severity: 'error',
          message: `${l.length} migrations resolve to version ${v} (${l.map((m) => basename(m.path)).join(', ')}); Flyway fails with "Found more than one migration with version ${v}"`,
          files: l.map((m) => m.path),
          hint: 'Renumber the branch migration above main\'s latest version.',
          key: `flyway:${root}:dup:${v}`,
        });
    }
    return findings;
  },
  compare(ctx) {
    return outOfOrder(
      'flyway',
      ctx,
      list,
      compareFlyway,
      'With outOfOrder=false (the default) Flyway ignores it on databases that are already past it and `validate` fails.',
      'Renumber the branch migration above main\'s latest version.',
    );
  },
};
