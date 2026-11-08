// What every command shares: finding the repository, safe names, the JSON envelope.
import { execFileSync } from "node:child_process";
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
export const SCHEMA = 1;

/** A problem with the request or the environment: exit code 2. */
export class CliError extends Error {}

export interface Result {
  exitCode: number;
  /** The JSON answer, also what the MCP tools return. */
  json: Record<string, unknown>;
  /** The same answer for a person. */
  text: string;
}

export function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The top of the working tree containing `dir`. Nothing here reads or writes outside it. */
export function repoRoot(dir: string): string {
  const root = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new CliError(`not inside a git repository: ${dir}`);
  return root;
}

/** `owner/name` of the GitHub origin remote, if that is what it is. */
export function githubRepo(root: string): string | undefined {
  const url = git(root, ["remote", "get-url", "origin"]);
  const m = url && /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** A ref given by a caller goes to git as an argument, so it must not read as an option. */
export function safeRef(name: string, value: string): string {
  if (!/^[\w./~^@{}+-]+$/.test(value) || value.startsWith("-")) throw new CliError(`${name}: not a valid git ref: ${value}`);
  return value;
}

/** The base branch to compare with: the option, else origin's default, origin/main, main, master. */
export function mainRef(root: string, given?: string): string {
  if (given) return safeRef("main", given);
  const head = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head;
  for (const r of ["origin/main", "origin/master", "main", "master"]) if (git(root, ["rev-parse", "--verify", "--quiet", `${r}^{commit}`])) return r;
  throw new CliError("could not find the main branch; pass --main");
}

/** GITHUB_TOKEN, else GH_TOKEN. The value never leaves this process's children. */
export function githubToken(env: NodeJS.ProcessEnv = process.env): { name: string; value: string } | undefined {
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const value = env[name];
    if (value) return { name, value };
  }
  return undefined;
}

export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
    const value = env[name];
    if (value) out = out.split(value).join("[token]");
  }
  return out;
}
