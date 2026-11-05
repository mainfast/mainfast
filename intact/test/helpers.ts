import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../src/cli.ts";

// Keep the developer's git config (signing, hooks, rerere, aliases) out of the tests.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

export interface Repo {
  dir: string;
  git(...args: string[]): string;
  /** Run git, allowing a non-zero exit. */
  tryGit(...args: string[]): { status: number; stdout: string; stderr: string };
  write(path: string, content: string): void;
  rm(path: string): void;
  commit(message: string, author?: string): string;
  head(): string;
  cleanup(): void;
}

const dirs: string[] = [];

export function makeRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "mainfast-test-"));
  dirs.push(dir);
  let clock = 1_700_000_000;
  const env = (author = "Dev") => ({
    ...process.env,
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: `${author.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: `${author.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    GIT_AUTHOR_DATE: `${clock} +0000`,
    GIT_COMMITTER_DATE: `${clock} +0000`,
  });
  let currentAuthor = "Dev";
  const run = (args: string[]) => {
    clock += 60;
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: env(currentAuthor) });
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  const repo: Repo = {
    dir,
    git(...args) {
      const r = run(args);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}${r.stdout}`);
      return r.stdout;
    },
    tryGit: (...args) => run(args),
    write(path, content) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    rm(path) {
      rmSync(join(dir, path));
    },
    commit(message, author = "Dev") {
      currentAuthor = author;
      repo.git("add", "-A");
      repo.git("commit", "-q", "-m", message);
      currentAuthor = "Dev";
      return repo.head();
    },
    head: () => repo.git("rev-parse", "HEAD").trim(),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  repo.git("init", "-q", "-b", "main");
  repo.git("config", "commit.gpgsign", "false");
  repo.git("config", "merge.conflictstyle", "merge");
  return repo;
}

export function cleanupAll(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Merge `branch` into the current branch; on conflict run `resolve` then commit. */
export function mergeInto(repo: Repo, branch: string, resolve?: () => void, message = `Merge ${branch}`): string {
  const r = repo.tryGit("merge", "--no-ff", "--no-edit", "-m", message, branch);
  if (r.status !== 0) {
    if (!resolve) throw new Error(`unexpected conflict merging ${branch}: ${r.stdout}${r.stderr}`);
    resolve();
    repo.git("add", "-A");
    repo.git("commit", "-q", "--no-edit", "-m", message);
  }
  return repo.head();
}

export function lines(...ls: string[]): string {
  return ls.join("\n") + "\n";
}

/** Run the CLI in-process. */
export async function cli(dir: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd: dir, stdout: (s) => (out += s), stderr: (s) => (err += s) }, {});
  return { code, out, err };
}

/** A ten-line file whose line `n` (1-based) is replaced by `value`. */
export function tenLines(over: Record<number, string> = {}): string {
  const out: string[] = [];
  for (let i = 1; i <= 10; i++) out.push(over[i] ?? `line ${i} of the config module`);
  return out.join("\n") + "\n";
}
