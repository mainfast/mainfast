// Local git access for offline mode (CLI `local`) and for the Action when the workspace is a full
// checkout: diff, commits and git-ai notes (refs/notes/ai) without any API call.
import { execFileSync } from "node:child_process";
import type { CommitInfo, FileChange } from "../types.ts";
import { parseGitDiff } from "./patch.ts";

export const GIT_AI_NOTES_REF = "refs/notes/ai";

export function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
  } catch (err) {
    if (opts.allowFail) return "";
    const e = err as { stderr?: Buffer | string; message: string };
    throw new Error(`git ${args.join(" ")} failed: ${String(e.stderr ?? e.message).trim()}`);
  }
}

export function revParse(cwd: string, ref: string): string {
  return git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

export function hasCommit(cwd: string, sha: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Three-dot diff (merge-base..head), which is what a GitHub PR shows. */
export function diffFiles(cwd: string, base: string, head: string): FileChange[] {
  const out = git(cwd, ["diff", "-M", "--no-color", "--no-ext-diff", "--unified=3", `${base}...${head}`]);
  return parseGitDiff(out);
}

export function listCommits(cwd: string, base: string, head: string): CommitInfo[] {
  const sep = "\x1e";
  const fs = "\x1f";
  const out = git(cwd, ["log", "--reverse", `--format=%H${fs}%an${fs}%ae${fs}%cn${fs}%ce${fs}%B${sep}`, `${base}..${head}`]);
  return out
    .split(sep)
    .map((s) => s.replace(/^\n/, ""))
    .filter((s) => s.trim())
    .map((s) => {
      const [sha, an, ae, cn, ce, ...rest] = s.split(fs);
      return {
        sha: sha!,
        authorName: an ?? "",
        authorEmail: ae ?? "",
        committerName: cn,
        committerEmail: ce,
        message: rest.join(fs).trim(),
      };
    });
}

/** Best effort: fetch git-ai notes from origin, then read the note for every commit. */
export function readGitAiNotes(cwd: string, shas: string[], opts: { fetch?: boolean } = {}): Record<string, string> {
  if (opts.fetch) git(cwd, ["fetch", "--quiet", "origin", `+${GIT_AI_NOTES_REF}:${GIT_AI_NOTES_REF}`], { allowFail: true });
  const notes: Record<string, string> = {};
  for (const sha of shas) {
    const n = git(cwd, ["notes", `--ref=${GIT_AI_NOTES_REF}`, "show", sha], { allowFail: true });
    if (n.trim()) notes[sha] = n;
  }
  return notes;
}

export function showFile(cwd: string, rev: string, path: string): string | undefined {
  const out = git(cwd, ["show", `${rev}:${path}`], { allowFail: true });
  return out === "" ? undefined : out;
}
