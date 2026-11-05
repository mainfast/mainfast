// Offline mode and Action enrichment from a local checkout.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeCoverage, parseCoverage } from "./analyze/coverage.ts";
import { CONFIG_FILE } from "./constants.ts";
import { diffFiles, hasCommit, listCommits, readGitAiNotes, revParse, showFile, git } from "./diff/git.ts";
import type { CoverageReport, PrSnapshot } from "./types.ts";

export function loadCoverage(paths: string[], cwd: string): { report?: CoverageReport; missing: string[] } {
  const reports: CoverageReport[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      missing.push(p);
      continue;
    }
    reports.push(parseCoverage(readFileSync(abs, "utf8"), p));
  }
  return { report: mergeCoverage(reports), missing };
}

export interface LocalOptions {
  base: string;
  head?: string;
  title?: string;
  body?: string;
  branch?: string;
  labels?: string[];
  author?: string;
  notes?: boolean;
}

/** Build a snapshot from git alone. Check results are absent, so check-based flags do not fire. */
export function localSnapshot(cwd: string, o: LocalOptions): PrSnapshot {
  const headSha = revParse(cwd, o.head ?? "HEAD");
  const baseSha = revParse(cwd, o.base);
  const commits = listCommits(cwd, baseSha, headSha);
  const branch = o.branch ?? (git(cwd, ["rev-parse", "--abbrev-ref", o.head ?? "HEAD"], { allowFail: true }).trim() || "HEAD");
  return {
    repo: "local/local",
    pr: {
      number: 0,
      title: o.title ?? commits[0]?.message.split("\n")[0] ?? "",
      body: o.body ?? "",
      authorLogin: o.author ?? "",
      authorType: "User",
      headRef: branch,
      headSha,
      baseRef: o.base,
      baseSha,
      labels: o.labels ?? [],
    },
    commits,
    files: diffFiles(cwd, baseSha, headSha),
    gitAiNotes: o.notes === false ? undefined : readGitAiNotes(cwd, commits.map((c) => c.sha)),
  };
}

/** Policy text as it is on the base commit, so a PR cannot loosen its own gate. */
export function localPolicyText(cwd: string, baseRev: string): string | undefined {
  return showFile(cwd, baseRev, CONFIG_FILE) ?? showFile(cwd, baseRev, ".mainfast.yaml");
}

/**
 * When the Action runs in a full checkout (fetch-depth: 0) that contains both shas, replace the API
 * file list (whose patches GitHub truncates) with a local diff and read git-ai notes.
 */
export function enrichFromLocal(snap: PrSnapshot, cwd: string): { snap: PrSnapshot; used: boolean } {
  if (!existsSync(resolve(cwd, ".git")) && !git(cwd, ["rev-parse", "--git-dir"], { allowFail: true })) return { snap, used: false };
  if (!hasCommit(cwd, snap.pr.headSha) || !hasCommit(cwd, snap.pr.baseSha)) return { snap, used: false };
  const files = diffFiles(cwd, snap.pr.baseSha, snap.pr.headSha);
  const gitAiNotes = readGitAiNotes(
    cwd,
    snap.commits.map((c) => c.sha),
    { fetch: true },
  );
  return { snap: { ...snap, files, gitAiNotes: { ...snap.gitAiNotes, ...gitAiNotes } }, used: true };
}
