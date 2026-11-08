import { BRAND } from "./brand.ts";
import { exitCodeFor, repoRoot, runCheck } from "./check.ts";
import { apiClient, loadWorkingTreeConfig } from "./extends.ts";
import { Git } from "./git.ts";
import { LEVELS, type Level } from "./config.ts";
import { formatHuman } from "./report.ts";
import type { Strategy } from "./automerge.ts";
import { VERSION } from "./version.ts";

const USAGE = `${BRAND.productName} ${VERSION}: prove merge commits did not silently drop changes from main.

usage:
  ${BRAND.cliName} check [<merge-commit> | --range A..B] [options]

  With no commit or range, checks every merge commit in <main>..HEAD.

options:
  --range A..B        check every merge commit in the range
  --main <branch>     the main branch (default: config main_branch, origin/HEAD, main, master)
  --config <path>     config file (default: ${BRAND.configFile} at the repo root). An
                      owner/repo extends is read with GITHUB_TOKEN or GH_TOKEN when set
  --json              machine-readable report on stdout
  --fail-on <level>   lowest level that makes the exit code 1: error, warning (default), notice
  --strategy <name>   force remerge-diff, merge-tree or worktree (default: by git version)
  -C <dir>            run in <dir>
  -h, --help          show this help
  -v, --version       print the version

exit codes: 0 clean, 1 findings, 2 error
`;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

class UsageError extends Error {}

interface Parsed {
  command?: string;
  commit?: string;
  range?: string;
  main?: string;
  config?: string;
  json: boolean;
  failOn: Level;
  strategy?: Strategy;
  dir?: string;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { json: false, failOn: "warning", help: false, version: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (): string => {
      const eq = a.indexOf("=");
      if (a.startsWith("--") && eq > 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const flag = a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    switch (flag) {
      case "-h": case "--help": p.help = true; break;
      case "-v": case "--version": p.version = true; break;
      case "--json": p.json = true; break;
      case "--range": p.range = value(); break;
      case "--main": p.main = value(); break;
      case "--config": p.config = value(); break;
      case "-C": p.dir = value(); break;
      case "--fail-on": {
        const v = value() as Level;
        if (!LEVELS.includes(v) || v === "off") throw new UsageError(`--fail-on: expected error, warning or notice`);
        p.failOn = v;
        break;
      }
      case "--strategy": {
        const v = value();
        if (v !== "remerge-diff" && v !== "merge-tree" && v !== "worktree") throw new UsageError(`unknown strategy: ${v} (expected remerge-diff, merge-tree or worktree)`);
        p.strategy = v;
        break;
      }
      default:
        if (a.startsWith("-") && a !== "-") throw new UsageError(`unknown option: ${a}`);
        positional.push(a);
    }
  }
  p.command = positional[0];
  if (positional.length > 2) throw new UsageError(`unexpected argument: ${positional[2]}`);
  const target = positional[1];
  if (target !== undefined) {
    if (p.range) throw new UsageError("give a commit or --range, not both");
    if (target.includes("..")) p.range = target;
    else p.commit = target;
  }
  return p;
}

export async function main(argv: string[], io: Io, env: Record<string, string | undefined> = process.env): Promise<number> {
  let args: Parsed;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.stderr(`${BRAND.cliName}: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.version) { io.stdout(`${VERSION}\n`); return 0; }
  if (args.help || !args.command) { io.stdout(USAGE); return args.help ? 0 : 2; }
  if (args.command !== "check") {
    io.stderr(`${BRAND.cliName}: unknown command "${args.command}"\n\n${USAGE}`);
    return 2;
  }
  try {
    const cwd = args.dir ?? io.cwd;
    const root = repoRoot(cwd);
    const gh = apiClient(env.GITHUB_TOKEN ?? env.GH_TOKEN, env.GITHUB_API_URL);
    const config = await loadWorkingTreeConfig(new Git(root), root, args.config, gh);
    const report = runCheck({
      cwd,
      commit: args.commit,
      range: args.range,
      mainBranch: args.main,
      config,
      strategy: args.strategy,
    });
    io.stdout(args.json ? JSON.stringify(report, null, 2) + "\n" : formatHuman(report));
    return exitCodeFor(report, args.failOn);
  } catch (e) {
    const msg = (e as Error).message;
    if (args.json) io.stdout(JSON.stringify({ tool: BRAND.productName, version: VERSION, error: msg }, null, 2) + "\n");
    io.stderr(`${BRAND.cliName}: ${msg}\n`);
    return 2;
  }
}
