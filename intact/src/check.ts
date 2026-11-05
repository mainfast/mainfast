import { analyzeMerge } from "./analyze.ts";
import type { Strategy } from "./automerge.ts";
import { BRAND } from "./brand.ts";
import { LEVELS, loadConfig, type Config, type Level } from "./config.ts";
import { Git } from "./git.ts";
import type { CheckReport, MergeReport } from "./types.ts";
import { VERSION } from "./version.ts";

export interface CheckOptions {
  cwd: string;
  /** A single commit to check. */
  commit?: string;
  /** A revision range `A..B`; every merge commit in it is checked. */
  range?: string;
  /** Overrides config main_branch. */
  mainBranch?: string;
  configPath?: string;
  config?: Config;
  strategy?: Strategy;
}

export function repoRoot(cwd: string): string {
  return new Git(cwd).out(["rev-parse", "--show-toplevel"]).trim();
}

/** Resolve the main branch ref: explicit name (remote first), origin/HEAD, then common names. */
export function resolveMainRef(git: Git, name?: string): { ref: string; sha: string } | undefined {
  const candidates: string[] = [];
  if (name) {
    candidates.push(name.startsWith("origin/") || name.startsWith("refs/") ? name : `origin/${name}`, name);
  } else {
    const head = git.run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { okStatus: [0, 1, 128] });
    if (head.status === 0 && head.stdout.trim()) candidates.push(head.stdout.trim());
    candidates.push("origin/main", "origin/master", "main", "master");
  }
  for (const ref of candidates) {
    const sha = git.resolve(ref);
    if (sha) return { ref, sha };
  }
  return undefined;
}

export function listMerges(git: Git, range: string): string[] {
  return git.out(["rev-list", "--min-parents=2", "--reverse", "--topo-order", range]).split("\n").filter(Boolean);
}

export function runCheck(opts: CheckOptions): CheckReport {
  const root = repoRoot(opts.cwd);
  const git = new Git(root);
  const config = opts.config ?? loadConfig(root, opts.configPath);
  const main = resolveMainRef(git, opts.mainBranch ?? config.mainBranch);

  let range: string | undefined;
  let shas: string[];
  if (opts.commit) {
    const sha = git.resolve(opts.commit);
    if (!sha) throw new Error(`unknown revision: ${opts.commit}`);
    shas = [sha];
  } else {
    if (opts.range) range = opts.range;
    else {
      if (!main) throw new Error("cannot find the main branch (tried origin/HEAD, origin/main, origin/master, main, master); pass --main, --range or a commit");
      range = `${main.ref}..HEAD`;
    }
    shas = listMerges(git, range);
  }

  const merges: MergeReport[] = shas.map((sha) =>
    analyzeMerge(git, sha, { config, mainSha: main?.sha, strategy: opts.strategy }),
  );
  return {
    tool: BRAND.productName,
    version: VERSION,
    repo: root,
    range,
    mainRef: main?.ref,
    merges,
    summary: summarize(merges),
  };
}

export function summarize(merges: MergeReport[]): CheckReport["summary"] {
  const findings = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  for (const m of merges) for (const f of m.findings) findings[f.level]++;
  return {
    merges: merges.length,
    clean: merges.filter((m) => m.status === "clean").length,
    conflictResolution: merges.filter((m) => m.status === "conflict-resolution").length,
    withFindings: merges.filter((m) => m.status === "findings").length,
    unsupported: merges.filter((m) => m.status === "unsupported").length,
    errors: merges.filter((m) => m.status === "error").length,
    findings,
  };
}

/** 0 clean, 1 findings at error/warning level, 2 an analysis error. */
export function exitCodeFor(report: CheckReport, failOn: Level = "warning"): number {
  if (report.summary.errors > 0) return 2;
  const order: Level[] = ["error", "warning", "notice"];
  const limit = order.indexOf(failOn);
  const failing = order.slice(0, limit + 1).some((l) => report.summary.findings[l] > 0);
  return failing ? 1 : 0;
}
