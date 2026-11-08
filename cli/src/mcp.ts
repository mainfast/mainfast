// `mcp`: the same commands as tools, over stdio. stdout belongs to the protocol: nothing here prints,
// and the product CLIs run in child processes.
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT_SLUGS, SUITE } from "@mainfast/shared/brand";
import { AUDIT_CHECKS, AUDIT_NEEDS, runAudit, runCheck } from "./commands.ts";
import { CliError, redact, repoRoot, SCHEMA, VERSION, type Result } from "./common.ts";
import { runDoctor } from "./doctor.ts";
import { runInit } from "./init.ts";

const repoPath = { type: "string", description: "A path inside the repository. It must be in the server's working directory or one of the client's roots. Default: the working directory." };
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const TOOLS = [
  {
    name: "init",
    description: `WRITES FILES in the repository: the workflow of each chosen check under .github/workflows and a starter ${SUITE.configFile}. Never replaces a file that has different content unless force is true. Does not commit, push or change branch protection. Pass dry_run: true to see what it would do without writing.`,
    inputSchema: {
      type: "object",
      properties: {
        repo_path: repoPath,
        checks: { type: "array", items: { type: "string", enum: [...PRODUCT_SLUGS] }, description: "Default: all five." },
        dry_run: { type: "boolean", description: "Show what would change without writing anything. Default: false." },
        force: { type: "boolean", description: "Replace files that have different content. Default: false." },
      },
      additionalProperties: false,
    },
    // force can replace a file, so this is not non-destructive even though the default is.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "doctor",
    description: "Reads only. Which checks are installed in the repository, whether the config parses, whether a token is set (never its value), and what is missing.",
    inputSchema: { type: "object", properties: { repo_path: repoPath }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "check",
    description: "Reads only. Runs Mainfast Intact locally on the merge commits in this branch: did a merge silently drop main's changes or add an unrelated edit? Run it before pushing a merge. ok is false when a finding is at or above fail_on.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: repoPath,
        commit: { type: "string", description: "One merge commit. Default: every merge commit in main..HEAD." },
        range: { type: "string", description: "A range, A..B." },
        main: { type: "string", description: "The main branch. Default: from the config or origin." },
        fail_on: { type: "string", enum: ["error", "warning", "notice"], description: "Lowest level that fails the check (ok false). Default: warning." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "audit",
    description: `Reads only; posts nothing to GitHub. Runs one check now. ${AUDIT_CHECKS.map((c) => `${c}: ${AUDIT_NEEDS[c]}`).join(" ")}`,
    inputSchema: {
      type: "object",
      properties: {
        repo_path: repoPath,
        check: { type: "string", enum: [...AUDIT_CHECKS] },
        main: { type: "string", description: "The main branch, for migrations and evidence." },
        pr: { type: "integer", description: "For evidence: evaluate this pull request through the API." },
        offline: { type: "boolean", description: "For owners: run the offline lint even when a token is set." },
      },
      required: ["check"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const;

const inside = (base: string, path: string) => path === base || path.startsWith(base.endsWith(sep) ? base : base + sep);

/** Where a tool may work: the server's own repository or directory, and the client's file roots. */
export function allowedBases(cwd: string, roots: readonly string[]): string[] {
  let own = realpathSync(cwd);
  try {
    own = realpathSync(repoRoot(cwd));
  } catch {
    /* not in a repository: the directory itself */
  }
  const out = [own];
  for (const uri of roots) {
    try {
      out.push(realpathSync(fileURLToPath(uri)));
    } catch {
      /* not a file root, or gone */
    }
  }
  return out;
}

/** A tool's repo_path comes from the model, so it must resolve inside what the user opened. */
export function checkRepoPath(given: string | undefined, cwd: string, roots: readonly string[]): string {
  if (given === undefined) return cwd;
  const bases = allowedBases(cwd, roots);
  let real: string;
  try {
    real = realpathSync(resolve(cwd, given));
  } catch {
    throw new CliError(`repo_path does not exist: ${given}`);
  }
  // The repository's top is checked too: init writes there, and it can sit above a root.
  const top = realpathSync(repoRoot(real));
  if (!bases.some((b) => inside(b, real)) || !bases.some((b) => inside(b, top))) throw new CliError(`repo_path is outside the working directory and the client's roots: ${given}`);
  return real;
}

async function call(name: string, a: Record<string, unknown>, roots: () => Promise<string[]>): Promise<Result> {
  const given = str(a.repo_path);
  const dir = checkRepoPath(given, process.cwd(), given === undefined ? [] : await roots());
  switch (name) {
    case "init":
      return runInit({ dir, checks: Array.isArray(a.checks) ? a.checks.map(String) : undefined, dryRun: a.dry_run === true, force: a.force === true });
    case "doctor":
      return runDoctor(dir);
    case "check":
      return runCheck({ dir, commit: str(a.commit), range: str(a.range), main: str(a.main), failOn: str(a.fail_on) });
    case "audit":
      return runAudit({ dir, check: String(a.check), main: str(a.main), pr: typeof a.pr === "number" ? a.pr : undefined, offline: a.offline === true });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function runMcp(): Promise<void> {
  const server = new Server({ name: SUITE.githubOrg, version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] as never }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const r = await call(req.params.name, req.params.arguments ?? {}, async () => {
        if (!server.getClientCapabilities()?.roots) return [];
        try {
          return (await server.listRoots(undefined, { timeout: 5_000 })).roots.map((x) => x.uri);
        } catch {
          return [];
        }
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(r.json, null, 2) }], structuredContent: r.json };
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : String(e));
      return { content: [{ type: "text" as const, text: JSON.stringify({ schema: SCHEMA, command: req.params.name, ok: false, error: message }) }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}
