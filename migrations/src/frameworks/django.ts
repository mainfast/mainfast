// Django: <app>/migrations/NNNN_name.py, each listing `dependencies`. Two branches
// that both add 0005_* on top of 0004 leave the app with two leaf nodes and
// `migrate` stops with "Conflicting migrations detected; multiple leaf nodes".
import type { Tree } from '../git.js';
import type { Finding, Framework } from '../types.js';
import { basename, dirname, groupBy, pyStrings, uniq } from './common.js';

export interface DjangoMigration {
  path: string;
  app: string;
  name: string;
  number: string;
  deps: Array<[string, string]>;
  replaces: Array<[string, string]>;
}

function tuplesIn(block: string | undefined): Array<[string, string]> {
  if (!block) return [];
  const out: Array<[string, string]> = [];
  for (const m of block.matchAll(/\(\s*(['"][^'"]*['"])\s*,\s*(['"][^'"]*['"])\s*,?\s*\)/g)) {
    const [a, b] = [pyStrings(m[1]!)[0], pyStrings(m[2]!)[0]];
    if (a !== undefined && b !== undefined) out.push([a, b]);
  }
  return out;
}

function listBlock(text: string, name: string): string | undefined {
  const start = text.search(new RegExp(`^\\s*${name}\\s*=\\s*\\[`, 'm'));
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = text.indexOf('[', start); i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

export function parseDjango(path: string, text: string, app: string): DjangoMigration {
  const name = basename(path).replace(/\.py$/, '');
  return {
    path,
    app,
    name,
    number: name.slice(0, 4),
    deps: tuplesIn(listBlock(text, 'dependencies')),
    replaces: tuplesIn(listBlock(text, 'replaces')),
  };
}

const MIGRATION_FILE = /(^|\/)migrations\/\d{4}_[^/]+\.py$/;

function appLabel(root: string): string {
  return basename(dirname(root)) || basename(root);
}

function migrations(tree: Tree, root: string): DjangoMigration[] {
  const app = appLabel(root);
  return tree
    .under(root)
    .filter((f) => dirname(f) === root && MIGRATION_FILE.test(f))
    .map((f) => parseDjango(f, tree.read(f) ?? '', app));
}

export const django: Framework = {
  id: 'django',
  detect(files) {
    return uniq(files.filter((f) => MIGRATION_FILE.test(f)).map(dirname)).filter((d) =>
      files.includes(`${d}/__init__.py`) || files.some((f) => f.startsWith(`${d}/0001_`)),
    );
  },
  inspect(tree, root) {
    const migs = migrations(tree, root);
    const app = appLabel(root);
    const findings: Finding[] = [];
    const names = new Set(migs.map((m) => m.name));

    for (const [num, list] of groupBy(migs, (m) => m.number)) {
      if (list.length > 1)
        findings.push({
          framework: 'django',
          root,
          code: 'duplicate-number',
          severity: 'warning',
          message: `app "${app}" has ${list.length} migrations numbered ${num}: ${list.map((m) => m.name).join(', ')}`,
          files: list.map((m) => m.path),
          hint: 'Renumber the branch migration after main\'s latest and point its dependency at it.',
          key: `django:${root}:dupnum:${list.map((m) => m.name).sort().join(',')}`,
        });
    }

    for (const m of migs) {
      for (const [depApp, depName] of m.deps) {
        if (depApp !== app || depName === '__first__' || depName === '__latest__') continue;
        if (!names.has(depName))
          findings.push({
            framework: 'django',
            root,
            code: 'missing-dependency',
            severity: 'error',
            message: `${m.name} depends on ${app}.${depName}, which does not exist`,
            files: [m.path],
            hint: 'Point the dependency at an existing migration.',
            key: `django:${root}:missing:${m.name}:${depName}`,
          });
      }
    }

    // Leaf = not depended on by another migration of the same app. A squashed
    // migration and the ones it replaces stand for each other.
    const dependedOn = new Set<string>();
    for (const m of migs) for (const [a, n] of m.deps) if (a === app) dependedOn.add(n);
    for (const m of migs) {
      if (!m.replaces.length) continue;
      const replaced = m.replaces.filter(([a]) => a === app).map(([, n]) => n);
      if (replaced.some((n) => dependedOn.has(n))) dependedOn.add(m.name);
      if (dependedOn.has(m.name)) replaced.forEach((n) => dependedOn.add(n));
      // originals that the squash replaces are not separate leaves
      replaced.forEach((n) => dependedOn.add(n));
    }
    const leaves = migs.filter((m) => !dependedOn.has(m.name));
    if (leaves.length > 1)
      findings.push({
        framework: 'django',
        root,
        code: 'multiple-leaves',
        severity: 'error',
        message: `app "${app}" has ${leaves.length} leaf migrations (${leaves.map((l) => l.name).join(', ')}); \`migrate\` will stop with "Conflicting migrations detected".`,
        files: leaves.map((l) => l.path),
        hint: `python manage.py makemigrations --merge ${app}  (or renumber the branch migration onto main's leaf)`,
        key: `django:${root}:leaves:${leaves.length}`,
      });
    return findings;
  },
};
