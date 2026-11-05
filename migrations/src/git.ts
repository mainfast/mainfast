// Read-only git access by ref: ls-tree and cat-file, never a checkout, so the
// tool can compare main and any PR head without touching the working tree.
import { execFileSync } from 'node:child_process';

export function git(repo: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function tryGit(repo: string, args: string[]): string | undefined {
  try {
    return git(repo, args).trim();
  } catch {
    return undefined;
  }
}

export function revParse(repo: string, ref: string): string {
  const sha = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!sha) throw new Error(`git: cannot resolve "${ref}" in ${repo}`);
  return sha;
}

export function mergeBase(repo: string, a: string, b: string): string | undefined {
  return tryGit(repo, ['merge-base', a, b]) || undefined;
}

/** A source of file contents for one path. */
export type Blob = { sha: string } | { content: string };

/**
 * A snapshot of the repository at one ref (or a synthesised merge of several):
 * path -> blob. Content is read lazily through `git cat-file`.
 */
export class Tree {
  private readonly cache = new Map<string, string>();
  constructor(
    public readonly repo: string,
    public readonly entries: Map<string, Blob>,
    public readonly label: string,
  ) {}

  static atRef(repo: string, ref: string, label = ref): Tree {
    const out = git(repo, ['ls-tree', '-r', '-z', '--full-tree', ref]);
    const entries = new Map<string, Blob>();
    for (const rec of out.split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      const [, type, sha] = rec.slice(0, tab).split(' ');
      if (type === 'blob' && sha) entries.set(rec.slice(tab + 1), { sha });
    }
    return new Tree(repo, entries, label);
  }

  files(): string[] {
    return [...this.entries.keys()];
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  read(path: string): string | undefined {
    const blob = this.entries.get(path);
    if (!blob) return undefined;
    if ('content' in blob) return blob.content;
    let text = this.cache.get(blob.sha);
    if (text === undefined) {
      text = git(this.repo, ['cat-file', 'blob', blob.sha]);
      this.cache.set(blob.sha, text);
    }
    return text;
  }

  /** Files directly or recursively under `dir` ("" means the whole tree). */
  under(dir: string): string[] {
    if (!dir) return this.files();
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return this.files().filter((f) => f.startsWith(prefix));
  }
}

function sameBlob(a: Blob | undefined, b: Blob | undefined): boolean {
  if (!a || !b) return a === b;
  if ('sha' in a && 'sha' in b) return a.sha === b.sha;
  if ('content' in a && 'content' in b) return a.content === b.content;
  return false;
}

/**
 * Hook for ledger files both sides edit (a drizzle journal): returns the content
 * a correct merge would have, or undefined to fall back to the default rule.
 */
export type MergeFile = (path: string, base?: string, main?: string, head?: string) => string | undefined;

/**
 * What main would look like after this PR merged, restricted to `dir`:
 * main's files, plus the branch's additions and edits, minus the branch's
 * deletions. Real three-way content merges are left to `mergeFile`; otherwise a
 * path edited on the branch takes the branch's version.
 */
export function mergedTree(base: Tree, main: Tree, head: Tree, dir: string, mergeFile?: MergeFile): Tree {
  const entries = new Map<string, Blob>();
  const paths = new Set([...base.under(dir), ...main.under(dir), ...head.under(dir)]);
  for (const p of paths) {
    const b = base.entries.get(p);
    const m = main.entries.get(p);
    const h = head.entries.get(p);
    const headChanged = !sameBlob(b, h);
    const mainChanged = !sameBlob(b, m);
    if (headChanged && mainChanged && mergeFile) {
      const merged = mergeFile(p, base.read(p), main.read(p), head.read(p));
      if (merged !== undefined) {
        entries.set(p, { content: merged });
        continue;
      }
    }
    const pick = headChanged ? h : m;
    if (!pick) continue;
    entries.set(p, 'sha' in pick ? pick : { content: pick.content });
  }
  // Blobs from different trees all live in the same repository object store.
  const t = new Tree(main.repo, entries, `merge(${main.label}, ${head.label})`);
  return t;
}

/** Paths under `dir` that `to` has and `from` does not. */
export function addedPaths(from: Tree, to: Tree, dir: string): string[] {
  return to.under(dir).filter((p) => !from.has(p));
}
