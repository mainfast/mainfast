// Drizzle: <out>/meta/_journal.json lists every migration (idx, when, tag) and
// <out>/meta/*_snapshot.json chains schema snapshots by id/prevId. Two branches
// that each generate a migration write the same next idx and fork the chain;
// git's textual merge of the journal either conflicts or silently keeps one side.
import type { Tree } from '../git.js';
import type { CompareContext, Finding, Framework } from '../types.js';
import { basename, dirname, groupBy, uniq } from './common.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface JournalEntry {
  idx: number;
  version?: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}
interface Journal {
  version?: string;
  dialect?: string;
  entries: JournalEntry[];
}

const ZERO_ID = '00000000-0000-0000-0000-000000000000';

function parseJournal(text: string | undefined): Journal | undefined {
  if (text === undefined) return undefined;
  try {
    const j = JSON.parse(text) as Journal;
    return Array.isArray(j.entries) ? j : undefined;
  } catch {
    return undefined;
  }
}

const journalPath = (root: string) => `${root}/meta/_journal.json`;

/**
 * What a correct merge of the journal looks like if nobody re-indexes: main's
 * entries followed by the branch's new ones with the idx the branch gave them.
 * Inspecting that shows the collision a reviewer has to fix.
 */
export function mergeJournal(base?: string, main?: string, head?: string): string | undefined {
  const b = parseJournal(base);
  const m = parseJournal(main);
  const h = parseJournal(head);
  if (!m || !h) return undefined;
  const baseTags = new Set((b?.entries ?? []).map((e) => e.tag));
  const mainTags = new Set(m.entries.map((e) => e.tag));
  const headAdded = h.entries.filter((e) => !baseTags.has(e.tag) && !mainTags.has(e.tag));
  return JSON.stringify({ ...m, entries: [...m.entries, ...headAdded] }, null, 2);
}

export const drizzle: Framework = {
  id: 'drizzle',
  detect(files) {
    return uniq(files.filter((f) => /(^|\/)meta\/_journal\.json$/.test(f)).map((f) => dirname(dirname(f))));
  },
  mergeFile(path, base, main, head) {
    return path.endsWith('/meta/_journal.json') || path === 'meta/_journal.json' ? mergeJournal(base, main, head) : undefined;
  },
  inspect(tree: Tree, root: string): Finding[] {
    const jp = journalPath(root);
    const findings: Finding[] = [];
    const journal = parseJournal(tree.read(jp));
    if (!journal) {
      findings.push({
        framework: 'drizzle',
        root,
        code: 'journal-unreadable',
        severity: 'error',
        message: `${jp} is missing or is not valid JSON (check for leftover merge conflict markers)`,
        files: [jp],
        hint: 'Resolve the journal: union the entries by tag and re-index idx sequentially.',
        key: `drizzle:${root}:unreadable`,
      });
      return findings;
    }
    const entries = journal.entries;
    for (const [idx, list] of groupBy(entries, (e) => String(e.idx))) {
      if (list.length > 1)
        findings.push({
          framework: 'drizzle',
          root,
          code: 'duplicate-idx',
          severity: 'error',
          message: `journal idx ${idx} is used by ${list.length} entries: ${list.map((e) => e.tag).join(', ')}`,
          files: [jp],
          hint: 'Union the entries by tag, re-index idx 0..n-1 in `when` order, and regenerate the branch snapshot so its prevId is main\'s latest id.',
          key: `drizzle:${root}:dupidx:${list.map((e) => e.tag).sort().join(',')}`,
        });
    }
    const idxs = entries.map((e) => e.idx);
    const contiguous = idxs.every((v, i) => v === i);
    if (!contiguous && new Set(idxs).size === idxs.length)
      findings.push({
        framework: 'drizzle',
        root,
        code: 'idx-not-sequential',
        severity: 'warning',
        message: `journal idx values are not 0..${entries.length - 1} in order: ${idxs.join(', ')}`,
        files: [jp],
        hint: 'Re-index idx sequentially.',
        key: `drizzle:${root}:idxseq`,
      });
    for (let i = 1; i < entries.length; i++) {
      if (entries[i]!.when < entries[i - 1]!.when)
        findings.push({
          framework: 'drizzle',
          root,
          code: 'when-out-of-order',
          severity: 'warning',
          message: `${entries[i]!.tag} has an earlier \`when\` than ${entries[i - 1]!.tag}, the entry before it`,
          files: [jp],
          key: `drizzle:${root}:when:${entries[i]!.tag}`,
        });
    }
    const sqlFiles = tree.under(root).filter((f) => dirname(f) === root && f.endsWith('.sql'));
    const sqlTags = new Set(sqlFiles.map((f) => basename(f).replace(/\.sql$/, '')));
    for (const e of entries)
      if (!sqlTags.has(e.tag))
        findings.push({
          framework: 'drizzle',
          root,
          code: 'entry-without-sql',
          severity: 'error',
          message: `journal entry ${e.tag} has no ${e.tag}.sql`,
          files: [jp],
          key: `drizzle:${root}:nosql:${e.tag}`,
        });
    const tags = new Set(entries.map((e) => e.tag));
    for (const f of sqlFiles) {
      const tag = basename(f).replace(/\.sql$/, '');
      if (!tags.has(tag))
        findings.push({
          framework: 'drizzle',
          root,
          code: 'sql-not-in-journal',
          severity: 'error',
          message: `${basename(f)} is not listed in the journal, so drizzle-kit migrate never applies it`,
          files: [f, jp],
          hint: 'Add the entry back to the journal (a merge kept only one side).',
          key: `drizzle:${root}:orphan:${tag}`,
        });
    }
    // Snapshot chain: exactly one snapshot may claim each prevId.
    const snaps = tree
      .under(`${root}/meta`)
      .filter((f) => f.endsWith('_snapshot.json'))
      .map((f) => {
        try {
          const s = JSON.parse(tree.read(f) ?? '') as { id?: string; prevId?: string };
          return { path: f, id: s.id, prevId: s.prevId };
        } catch {
          return { path: f, id: undefined, prevId: undefined };
        }
      });
    const ids = new Set(snaps.map((s) => s.id).filter(Boolean));
    for (const [prev, list] of groupBy(snaps.filter((s) => s.prevId), (s) => s.prevId!)) {
      if (list.length > 1)
        findings.push({
          framework: 'drizzle',
          root,
          code: 'snapshot-fork',
          severity: 'error',
          message: `${list.length} snapshots claim prevId ${prev}: ${list.map((s) => basename(s.path)).join(', ')}`,
          files: list.map((s) => s.path),
          hint: 'Point the branch snapshot\'s prevId at main\'s latest snapshot id (or regenerate it with drizzle-kit generate after merging main).',
          key: `drizzle:${root}:fork:${prev}:${list.length}`,
        });
    }
    for (const s of snaps)
      if (s.prevId && s.prevId !== ZERO_ID && !ids.has(s.prevId))
        findings.push({
          framework: 'drizzle',
          root,
          code: 'snapshot-missing-parent',
          severity: 'error',
          message: `${basename(s.path)} has prevId ${s.prevId}, which no snapshot declares`,
          files: [s.path],
          key: `drizzle:${root}:snapmissing:${s.path}`,
        });
    return findings;
  },
  compare(ctx: CompareContext): Finding[] {
    const jp = journalPath(ctx.root);
    const b = parseJournal(ctx.base.read(jp));
    const m = parseJournal(ctx.main.read(jp));
    const h = parseJournal(ctx.head.read(jp));
    if (!m || !h) return [];
    const baseTags = new Set((b?.entries ?? []).map((e) => e.tag));
    const mainAdded = m.entries.filter((e) => !baseTags.has(e.tag));
    const headTags = new Set(h.entries.map((e) => e.tag));
    const headAdded = h.entries.filter((e) => !baseTags.has(e.tag) && !m.entries.some((x) => x.tag === e.tag));
    const severity = ctx.outOfOrder;
    if (!mainAdded.length || !headAdded.length || severity === 'off') return [];
    const missingFromHead = mainAdded.filter((e) => !headTags.has(e.tag));
    return [
      {
        framework: 'drizzle',
        root: ctx.root,
        code: 'journal-fork',
        severity,
        message:
          `main added ${plural(mainAdded.length, "migration")} since this branch forked (${missingFromHead.map((e) => e.tag).join(', ')}) ` +
          `and the branch added ${headAdded.length} (${headAdded.map((e) => e.tag).join(', ')}). The branch's snapshot was generated against a schema that is no longer main's.`,
        files: [jp],
        hint: 'Merge main, union the journal entries by tag, re-index idx sequentially, and fix the branch snapshot\'s single prevId (or delete the branch migration and re-run drizzle-kit generate).',
        key: `drizzle:${ctx.root}:journal-fork`,
      },
    ];
  },
};
