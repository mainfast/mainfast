import type { Tree } from '../git.js';
import type { CompareContext, Finding, FrameworkId } from '../types.js';

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** One versioned migration in a timestamp- or number-ordered ledger. */
export interface Versioned {
  version: string;
  path: string;
}

/**
 * Shared "older than main's latest" check for ledgers applied in version order
 * (Prisma, Rails, Flyway). A migration the branch adds with a version at or below
 * the newest one main already has will be applied out of order (or rejected) on
 * every database that already ran main's migrations.
 */
export function outOfOrder(
  framework: FrameworkId,
  ctx: CompareContext,
  list: (tree: Tree, root: string) => Versioned[],
  cmp: (a: string, b: string) => number,
  explain: string,
  hint: string,
): Finding[] {
  const severity = ctx.outOfOrder;
  if (severity === 'off') return [];
  const baseSet = new Set(list(ctx.base, ctx.root).map((v) => v.path));
  const mainList = list(ctx.main, ctx.root);
  const mainPaths = new Set(mainList.map((v) => v.path));
  const branchAdded = list(ctx.head, ctx.root).filter((v) => !baseSet.has(v.path) && !mainPaths.has(v.path));
  if (!branchAdded.length || !mainList.length) return [];
  const latest = mainList.reduce((a, b) => (cmp(a.version, b.version) >= 0 ? a : b));
  const stale = branchAdded.filter((v) => cmp(v.version, latest.version) <= 0);
  return stale.map((v) => ({
    framework,
    root: ctx.root,
    code: 'out-of-order',
    severity,
    message: `${basename(v.path)} (version ${v.version}) is not newer than main's latest ${basename(latest.path)} (version ${latest.version}). ${explain}`,
    files: [v.path, latest.path],
    hint,
    key: `${framework}:${ctx.root}:out-of-order:${v.path}`,
  }));
}

export function compareDigits(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Python literal strings in a fragment: 'a', "b". */
export function pyStrings(fragment: string): string[] {
  return [...fragment.matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]!);
}
