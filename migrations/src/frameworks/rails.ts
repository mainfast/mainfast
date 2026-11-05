// Rails: db/migrate/<YYYYMMDDHHMMSS>_name.rb (and db/<name>_migrate for extra databases).
import type { Tree } from '../git.js';
import type { Finding, Framework } from '../types.js';
import { basename, compareDigits, dirname, groupBy, outOfOrder, uniq, type Versioned } from './common.js';

const FILE = /(^|\/)db\/([^/]*_)?migrate\/(\d+)_([^/]+)\.rb$/;

function list(tree: Tree, root: string): Array<Versioned & { name: string }> {
  return tree
    .under(root)
    .filter((f) => dirname(f) === root && FILE.test(f))
    .map((f) => {
      const m = basename(f).match(/^(\d+)_(.+)\.rb$/)!;
      return { version: m[1]!, name: m[2]!, path: f };
    });
}

export const rails: Framework = {
  id: 'rails',
  detect(files) {
    return uniq(files.filter((f) => FILE.test(f)).map(dirname));
  },
  inspect(tree, root) {
    const findings: Finding[] = [];
    const migs = list(tree, root);
    for (const [v, l] of groupBy(migs, (m) => m.version)) {
      if (l.length > 1)
        findings.push({
          framework: 'rails',
          root,
          code: 'duplicate-version',
          severity: 'error',
          message: `${l.length} migrations share version ${v}; Rails raises DuplicateMigrationVersionError`,
          files: l.map((m) => m.path),
          hint: 'Rename one file to a fresh timestamp (bin/rails generate migration creates one).',
          key: `rails:${root}:dupver:${v}`,
        });
    }
    for (const [n, l] of groupBy(migs, (m) => m.name)) {
      if (l.length > 1)
        findings.push({
          framework: 'rails',
          root,
          code: 'duplicate-name',
          severity: 'error',
          message: `${l.length} migrations are named ${n}; Rails raises DuplicateMigrationNameError`,
          files: l.map((m) => m.path),
          hint: 'Rename the branch migration (file and class).',
          key: `rails:${root}:dupname:${n}`,
        });
    }
    return findings;
  },
  compare(ctx) {
    return outOfOrder(
      'rails',
      ctx,
      list,
      compareDigits,
      '`db:migrate` will still run it on databases that are past it, but schema.rb ends up with a version that hides the gap and environments diverge in order.',
      'Rename the file to a timestamp after main\'s latest and re-run `bin/rails db:migrate` to refresh schema.rb.',
    );
  },
};
