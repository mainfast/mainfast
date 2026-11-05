// Prisma: migrations/<YYYYMMDDHHMMSS>_name/migration.sql, applied in name order.
import type { Tree } from '../git.js';
import type { Finding, Framework } from '../types.js';
import { basename, compareDigits, dirname, groupBy, outOfOrder, uniq, type Versioned } from './common.js';

const SQL = /(^|\/)migrations\/(\d{14})_[^/]+\/migration\.sql$/;

function list(tree: Tree, root: string): Versioned[] {
  return tree
    .under(root)
    .filter((f) => SQL.test(f) && dirname(dirname(f)) === root)
    .map((f) => ({ version: basename(dirname(f)).slice(0, 14), path: dirname(f) }));
}

export const prisma: Framework = {
  id: 'prisma',
  detect(files) {
    return uniq(files.filter((f) => SQL.test(f)).map((f) => dirname(dirname(f))));
  },
  inspect(tree, root) {
    const findings: Finding[] = [];
    for (const [ts, dirs] of groupBy(list(tree, root), (v) => v.version)) {
      if (dirs.length > 1)
        findings.push({
          framework: 'prisma',
          root,
          code: 'duplicate-timestamp',
          severity: 'error',
          message: `${dirs.length} migrations share timestamp ${ts}: ${dirs.map((d) => basename(d.path)).join(', ')}`,
          files: dirs.map((d) => d.path),
          hint: 'Rename one directory to a fresh timestamp.',
          key: `prisma:${root}:dup:${dirs.map((d) => d.path).sort().join(',')}`,
        });
    }
    return findings;
  },
  compare(ctx) {
    return outOfOrder(
      'prisma',
      ctx,
      list,
      compareDigits,
      'Databases that already ran main\'s migrations apply it out of order, and `prisma migrate dev` reports drift.',
      'Regenerate the branch migration on top of main (delete it, merge main, run `prisma migrate dev`), or rename its directory to a timestamp after main\'s latest.',
    );
  },
};
