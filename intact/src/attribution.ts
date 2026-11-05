// Which commit on a side introduced a hunk: `git blame` for added lines, a
// newest-first scan of the side's history for pure deletions and whole files.

import { parseDiff } from "./diff.ts";
import type { Git } from "./git.ts";
import type { CommitInfo } from "./types.ts";

export interface Attribution {
  git: Git;
  base: string;
  tip: string;
  cache: Map<string, unknown>;
}

const infoCache = new WeakMap<Git, Map<string, CommitInfo>>();

export function commitInfo(git: Git, rev: string): CommitInfo {
  let cache = infoCache.get(git);
  if (!cache) infoCache.set(git, (cache = new Map()));
  const hit = cache.get(rev);
  if (hit) return hit;
  const out = git.out(["log", "-1", "--no-show-signature", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s", rev]).trim();
  const [sha, short, author, email, date, subject] = out.split("\x1f") as string[];
  const info: CommitInfo = { sha: sha!, short: short!, author: author!, email: email!, date: date!, subject: subject ?? "" };
  cache.set(rev, info);
  cache.set(info.sha, info);
  return info;
}

function sideCommits(a: Attribution): Set<string> {
  const key = "range";
  let set = a.cache.get(key) as Set<string> | undefined;
  if (!set) {
    const range = a.base === "4b825dc642cb6eb9a060e54bf8d69288fbee4904" ? [a.tip] : [`${a.base}..${a.tip}`];
    set = new Set(a.git.out(["rev-list", ...range]).split("\n").filter(Boolean));
    a.cache.set(key, set);
  }
  return set;
}

export interface HunkRef {
  paths: string[];
  kind: "add" | "delete" | "any";
  /** 0-based [from, to) lines in the tip's version of paths[0]. */
  lines?: { from: number; to: number };
  removed?: string[];
}

export function introducingCommit(a: Attribution, ref: HunkRef): CommitInfo | undefined {
  try {
    const sha = ref.kind === "add" && ref.lines ? blame(a, ref.paths[0]!, ref.lines) ?? scan(a, ref) : scan(a, ref);
    return sha ? commitInfo(a.git, sha) : undefined;
  } catch {
    return undefined;
  }
}

function blame(a: Attribution, path: string, lines: { from: number; to: number }): string | undefined {
  if (lines.to <= lines.from) return undefined;
  const r = a.git.run(["blame", "--porcelain", "-L", `${lines.from + 1},${lines.to}`, a.tip, "--", path], { okStatus: [0, 128] });
  if (r.status !== 0) return undefined;
  const inRange = sideCommits(a);
  const counts = new Map<string, number>();
  for (const line of r.stdout.split("\n")) {
    const m = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (m && inRange.has(m[1]!)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  let best: string | undefined;
  let n = 0;
  for (const [sha, c] of counts) if (c > n) { best = sha; n = c; }
  return best;
}

function scan(a: Attribution, ref: HunkRef): string | undefined {
  const range = `${a.base}..${a.tip}`;
  const log = a.git.run(["log", "--format=%H", "-n", "200", range, "--", ...ref.paths], { okStatus: [0, 128] });
  const shas = log.stdout.split("\n").filter(Boolean);
  if (shas.length === 0) return undefined;
  const wanted = (ref.removed ?? []).map((l) => l.trim()).filter(Boolean);
  if (ref.kind === "any" || wanted.length === 0) return shas[0];
  for (const sha of shas.slice(0, 50)) {
    const files = parseDiff(a.git.out(["show", "--format=", "--no-color", "--no-ext-diff", "-M", "-U0", sha, "--", ...ref.paths]));
    const removed = new Set(files.flatMap((f) => f.blocks.flatMap((b) => b.removed.map((l) => l.trim()))));
    if (wanted.every((w) => removed.has(w))) return sha;
  }
  return shas[0];
}
