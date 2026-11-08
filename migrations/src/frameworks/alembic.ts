// Alembic: each script names its `revision` and its parent(s) in `down_revision`.
// A healthy ledger has exactly one head; two branches that each add a revision on
// top of the same parent produce two heads and `alembic upgrade head` fails with
// "Multiple head revisions are present".
import type { Tree } from '../git.js';
import type { Finding, Framework } from '../types.js';
import { basename, dirname, groupBy, pyStrings, uniq } from './common.js';

export interface AlembicRevision {
  path: string;
  revision: string;
  parents: string[];
  branchLabels: boolean;
}

export function parseAlembic(path: string, text: string): AlembicRevision | undefined {
  const rev =
    text.match(/^revision(?:\s*:\s*[^=\n]+)?\s*=\s*['"]([^'"]+)['"]/m)?.[1] ??
    text.match(/^Revision ID:\s*(\S+)/m)?.[1];
  if (!rev) return undefined;
  const downLine = text.match(/^down_revision(?:\s*:\s*[^=\n]+)?\s*=\s*(.+)$/m);
  if (!downLine) return undefined;
  let fragment = downLine[1]!;
  // tuples may span lines: down_revision = (\n 'a',\n 'b'\n)
  if (/^[([]/.test(fragment.trim()) && !/[)\]]/.test(fragment)) {
    const start = text.indexOf(downLine[0]);
    const close = text.slice(start).search(/[)\]]/);
    fragment = text.slice(start, start + close + 1);
  }
  const parents = /^\s*None\b/.test(fragment) ? [] : pyStrings(fragment);
  const branchLabels = /^branch_labels(?:\s*:\s*[^=\n]+)?\s*=\s*(?!None)\S/m.test(text);
  return { path, revision: rev, parents, branchLabels };
}

function revisions(tree: Tree, root: string): AlembicRevision[] {
  const out: AlembicRevision[] = [];
  for (const f of tree.under(root)) {
    if (!f.endsWith('.py') || basename(f) === '__init__.py') continue;
    const r = parseAlembic(f, tree.read(f) ?? '');
    if (r) out.push(r);
  }
  return out;
}

export const alembic: Framework = {
  id: 'alembic',
  detect(files, read) {
    const roots: string[] = [];
    const dirs = uniq(files.filter((f) => /(^|\/)versions\/[^/]+\.py$/.test(f)).map(dirname));
    for (const d of dirs) {
      const parent = dirname(d);
      const hasEnv = files.includes(parent ? `${parent}/env.py` : 'env.py');
      const sample = files.find((f) => dirname(f) === d && f.endsWith('.py') && !f.endsWith('__init__.py'));
      const looksAlembic = sample ? /^down_revision\b/m.test(read(sample) ?? '') : false;
      if (hasEnv || looksAlembic) roots.push(d);
    }
    return roots;
  },
  inspect(tree, root) {
    const revs = revisions(tree, root);
    const findings: Finding[] = [];
    const byId = groupBy(revs, (r) => r.revision);
    for (const [id, list] of byId) {
      if (list.length > 1)
        findings.push({
          framework: 'alembic',
          root,
          code: 'duplicate-revision',
          severity: 'error',
          message: `revision id ${id} is declared by ${list.length} scripts`,
          files: list.map((r) => r.path),
          hint: 'Give one of the scripts a fresh revision id.',
          key: `alembic:${root}:dup:${id}`,
        });
    }
    for (const r of revs) {
      for (const p of r.parents) {
        if (!byId.has(p))
          findings.push({
            framework: 'alembic',
            root,
            code: 'missing-parent',
            severity: 'error',
            message: `${basename(r.path)} (revision ${r.revision}) points at down_revision ${p}, which no script declares`,
            files: [r.path],
            hint: 'The parent was renamed or deleted on one side; point down_revision at an existing revision.',
            key: `alembic:${root}:missing:${r.revision}:${p}`,
          });
      }
    }
    const referenced = new Set(revs.flatMap((r) => r.parents));
    const heads = revs.filter((r) => !referenced.has(r.revision));
    if (heads.length > 1) {
      const labelled = revs.some((r) => r.branchLabels);
      findings.push({
        framework: 'alembic',
        root,
        code: 'multiple-heads',
        severity: labelled ? 'warning' : 'error',
        message:
          `${heads.length} heads: ${heads.map((h) => `${h.revision} (${basename(h.path)})`).join(', ')}. ` +
          '`alembic upgrade head` will refuse to run.' +
          (labelled ? ' Some revisions set branch_labels, so the multiple heads may be intended.' : ''),
        files: heads.map((h) => h.path),
        hint: `alembic merge -m "merge heads" ${heads.map((h) => h.revision).join(' ')}  (or re-parent the branch's revision onto main's head)`,
        // keyed on the count so a PR that adds a third head to a two-head main is still reported
        key: `alembic:${root}:heads:${heads.length}`,
      });
    }
    return findings;
  },
};
