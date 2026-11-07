import { spawnSync } from "node:child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly status: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Config that keeps git output stable and free of user-specific behaviour. */
const BASE_CONFIG = [
  "-c", "core.quotePath=false",
  "-c", "diff.noprefix=false",
  "-c", "diff.mnemonicPrefix=false",
  "-c", "diff.external=",
  "-c", "color.ui=false",
  "-c", "rerere.enabled=false",
];

/** Thin synchronous git runner bound to one repository. */
export class Git {
  private versionCache: [number, number, number] | undefined;
  private readonly firstParentLines = new Map<string, Set<string>>();

  constructor(readonly cwd: string) {}

  /** Run git; throws GitError unless the exit code is in `okStatus`. */
  run(args: string[], opts: { okStatus?: number[]; input?: string; cwd?: string } = {}): GitResult {
    const ok = opts.okStatus ?? [0];
    const res = spawnSync("git", [...BASE_CONFIG, ...args], {
      cwd: opts.cwd ?? this.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512,
      input: opts.input,
      env: { ...process.env, GIT_PAGER: "cat", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
    });
    if (res.error) {
      throw new GitError(`git ${args[0]} failed to start: ${res.error.message}`, args, null, "");
    }
    const status = res.status ?? -1;
    if (!ok.includes(status)) {
      throw new GitError(
        `git ${args.join(" ")} exited ${status}: ${res.stderr.trim()}`,
        args,
        status,
        res.stderr,
      );
    }
    return { stdout: res.stdout, stderr: res.stderr, status };
  }

  out(args: string[]): string {
    return this.run(args).stdout;
  }

  /** Resolve a revision to a full sha, or undefined when it does not exist. */
  resolve(rev: string): string | undefined {
    const r = this.run(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { okStatus: [0, 1, 128] });
    return r.status === 0 ? r.stdout.trim() : undefined;
  }

  parents(sha: string): string[] {
    const line = this.out(["rev-list", "--parents", "-n", "1", sha]).trim();
    return line.split(/\s+/).slice(1);
  }

  mergeBases(a: string, b: string): string[] {
    const r = this.run(["merge-base", "--all", a, b], { okStatus: [0, 1] });
    return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  isAncestor(a: string, b: string): boolean {
    return this.run(["merge-base", "--is-ancestor", a, b], { okStatus: [0, 1] }).status === 0;
  }

  /** Every commit on rev's own line: the first-parent chain, without side branches merged into it. */
  firstParentLine(rev: string): Set<string> {
    let line = this.firstParentLines.get(rev);
    if (!line) {
      line = new Set(this.run(["rev-list", "--first-parent", rev]).stdout.split("\n").filter(Boolean));
      this.firstParentLines.set(rev, line);
    }
    return line;
  }

  /** File content at rev:path, or undefined when the path does not exist there. */
  show(rev: string, path: string): string | undefined {
    // Ask the tree first: in a partial clone a blob the promisor cannot deliver must be an error,
    // not "this file does not exist", or a failed fetch would read as a deleted file.
    const entry = this.run(["ls-tree", "-z", "--full-tree", rev, "--", path], { okStatus: [0, 128] });
    if (entry.status !== 0 || !entry.stdout) return undefined;
    const [, type, id] = /^\S+ (\S+) (\S+)\t/.exec(entry.stdout) ?? [];
    if (type !== "blob" || !id) return undefined;
    return this.out(["cat-file", "blob", id]);
  }

  blobId(rev: string, path: string): string | undefined {
    const r = this.run(["rev-parse", "--verify", "--quiet", `${rev}:${path}`], { okStatus: [0, 1, 128] });
    return r.status === 0 ? r.stdout.trim() : undefined;
  }

  version(): [number, number, number] {
    if (!this.versionCache) this.versionCache = parseGitVersion(this.out(["--version"]));
    return this.versionCache;
  }

  versionAtLeast(major: number, minor: number): boolean {
    const [ma, mi] = this.version();
    return ma > major || (ma === major && mi >= minor);
  }
}

export function parseGitVersion(text: string): [number, number, number] {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) throw new Error(`cannot parse git version from: ${text.trim()}`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** Split text into lines without a trailing empty element. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
