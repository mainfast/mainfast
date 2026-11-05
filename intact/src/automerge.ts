// "What did the merge commit itself change?" = diff(automatic merge of the parents, M).
//
// Three strategies, picked by git version (or forced for testing):
//   remerge-diff  git >= 2.36   git show --remerge-diff M            (no objects written)
//   merge-tree    git >= 2.38   git merge-tree --write-tree P1 P2   then git diff <tree> M
//   worktree      any git       temporary worktree + git merge --no-commit, then git diff
// All three produce the same thing: per-file diffs from the automatic result (with
// conflict markers left in conflicted files) to M's tree, at full context.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envName } from "./brand.ts";
import { FULL_CONTEXT, filePath, parseDiff, type FileDiff } from "./diff.ts";
import type { Git } from "./git.ts";

export type Strategy = "remerge-diff" | "merge-tree" | "worktree";

export interface AutoMerge {
  strategy: Strategy;
  /** Files where M differs from the automatic merge, full context. */
  files: FileDiff[];
  /** Paths git could not merge automatically (as named in the merge result). */
  conflicted: Set<string>;
}

export function pickStrategy(git: Git, forced?: string): Strategy {
  const f = forced ?? process.env[envName("FORCE_STRATEGY")];
  if (f) {
    if (f !== "remerge-diff" && f !== "merge-tree" && f !== "worktree") {
      throw new Error(`unknown strategy "${f}" (remerge-diff, merge-tree, worktree)`);
    }
    return f;
  }
  if (git.versionAtLeast(2, 36)) return "remerge-diff";
  if (git.versionAtLeast(2, 38)) return "merge-tree"; // unreachable today, kept for clarity
  return "worktree";
}

const DIFF_OPTS = ["--no-color", "--no-ext-diff", "--find-renames", FULL_CONTEXT];

export function autoMergeDiff(git: Git, merge: string, p1: string, p2: string, strategy: Strategy): AutoMerge {
  if (strategy === "remerge-diff") {
    const text = git.out(["show", "--remerge-diff", "--format=", ...DIFF_OPTS, merge]);
    const files = parseDiff(text);
    const conflicted = new Set<string>();
    for (const f of files) if (f.conflictMessages.some((m) => m.startsWith("CONFLICT"))) conflicted.add(filePath(f));
    // remerge-diff only lists conflicted files that the resolution changed (always true
    // for content conflicts, since markers are removed). That is all we need.
    return { strategy, files, conflicted };
  }
  if (strategy === "merge-tree") {
    const r = git.run(["merge-tree", "--write-tree", "-z", "--name-only", "--no-messages", p1, p2], { okStatus: [0, 1] });
    const parts = r.stdout.split("\0").filter((s) => s !== "");
    const tree = parts[0]!;
    const conflicted = new Set(parts.slice(1));
    const files = parseDiff(git.out(["diff", ...DIFF_OPTS, tree, merge]));
    return { strategy, files, conflicted };
  }
  // worktree: works on any git that has `git worktree` (2.5+).
  const dir = mkdtempSync(join(tmpdir(), "mainfast-wt-"));
  const wt = join(dir, "wt");
  try {
    git.run(["worktree", "add", "--detach", "--quiet", wt, p1]);
    const ident = ["-c", "user.name=mainfast", "-c", "user.email=mainfast@localhost"];
    git.run([...ident, "merge", "--no-commit", "--no-ff", "--quiet", p2], { cwd: wt, okStatus: [0, 1] });
    const unmerged = git.run(["diff", "--name-only", "-z", "--diff-filter=U"], { cwd: wt });
    const conflicted = new Set(unmerged.stdout.split("\0").filter(Boolean));
    git.run(["add", "-A"], { cwd: wt });
    const tree = git.run(["write-tree"], { cwd: wt }).stdout.trim();
    git.run(["merge", "--abort"], { cwd: wt, okStatus: [0, 128] });
    const files = parseDiff(git.out(["diff", ...DIFF_OPTS, tree, merge]));
    return { strategy, files, conflicted };
  } finally {
    git.run(["worktree", "remove", "--force", wt], { okStatus: [0, 128] });
    rmSync(dir, { recursive: true, force: true });
    git.run(["worktree", "prune"], { okStatus: [0, 128] });
  }
}
