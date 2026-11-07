// The product CLIs run in a child of this same file, so nothing they print can reach an MCP client's
// stdout and a tool call that fails cannot take the server down.
import { execFile } from "node:child_process";
import { main as evidence } from "../../evidence/src/cli.ts";
import { main as intact } from "../../intact/src/cli.ts";
import { main as migrations } from "../../migrations/src/cli.ts";
import { main as owners } from "../../owners/src/cli.ts";
import { main as rollcall } from "../../rollcall/src/cli.ts";
import { githubToken, redact } from "./common.ts";

export const PRODUCT_ARG = "__product";
const TIMEOUT_MS = 10 * 60_000;

/** The child's entry: `mainfast __product <slug> <args...>`. */
export async function runProductInProcess(slug: string, args: string[]): Promise<number> {
  switch (slug) {
    case "intact":
      return intact(args, { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: process.cwd() });
    case "evidence":
      return evidence(args);
    case "migrations":
      return migrations(args);
    case "owners":
      return owners(args);
    case "rollcall":
      return rollcall(args);
    default:
      process.stderr.write(`unknown product: ${slug}\n`);
      return 2;
  }
}

export interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runProduct(root: string, slug: string, args: string[]): Promise<ChildResult> {
  const token = githubToken();
  // Rollcall and Evidence read GITHUB_TOKEN only, so GH_TOKEN is passed on under that name.
  const env = { ...process.env, ...(token ? { GITHUB_TOKEN: token.value } : {}) };
  return new Promise((resolve) => {
    execFile(process.execPath, [process.argv[1]!, PRODUCT_ARG, slug, ...args], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 2) : 0;
      resolve({ code, stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

/** The product's --json output, or the reason there is none. */
export function parseReport(r: ChildResult): { report?: unknown; error?: string } {
  if (r.code === 2 || !r.stdout.trim()) return { error: r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}` };
  try {
    return { report: JSON.parse(r.stdout) };
  } catch {
    return { error: `unreadable output: ${(r.stderr || r.stdout).trim().slice(0, 500)}` };
  }
}
