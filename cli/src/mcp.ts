// `mcp`: the same commands as tools, over stdio. stdout belongs to the protocol: nothing here prints,
// and the product CLIs run in child processes.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT_SLUGS, SUITE } from "@mainfast/shared/brand";
import { AUDIT_CHECKS, AUDIT_NEEDS, runAudit, runCheck } from "./commands.ts";
import { redact, SCHEMA, VERSION, type Result } from "./common.ts";
import { runDoctor } from "./doctor.ts";
import { runInit } from "./init.ts";

const repoPath = { type: "string", description: "A path inside the repository. Default: the server's working directory." };
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const TOOLS = [
  {
    name: "init",
    description: `WRITES FILES in the repository: the workflow of each chosen check under .github/workflows and a starter ${SUITE.configFile}. Never replaces a file with other content unless force is true. Does not commit, push or change branch protection. Pass dry_run: true to see what it would do without writing.`,
    inputSchema: {
      type: "object",
      properties: {
        repo_path: repoPath,
        checks: { type: "array", items: { type: "string", enum: [...PRODUCT_SLUGS] }, description: "Default: all five." },
        dry_run: { type: "boolean", description: "Report only, write nothing. Default: false." },
        force: { type: "boolean", description: "Replace files that have other content. Default: false." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "doctor",
    description: "Reads only. Which checks are installed in the repository, whether the config parses, whether a token is set (never its value), and what is missing.",
    inputSchema: { type: "object", properties: { repo_path: repoPath }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "check",
    description: "Reads only. Runs Mainfast Intact locally on the merge commits in this branch: did a merge silently drop main's changes or add an unrelated edit? Run it before pushing a merge. ok is false when there are findings.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: repoPath,
        commit: { type: "string", description: "One merge commit. Default: every merge commit in main..HEAD." },
        range: { type: "string", description: "A range, A..B." },
        main: { type: "string", description: "The main branch. Default: from the config or origin." },
        fail_on: { type: "string", enum: ["error", "warning", "notice"], description: "Lowest level that counts as a finding. Default: warning." },
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
        offline: { type: "boolean", description: "For owners: lint offline even with a token." },
      },
      required: ["check"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const;

async function call(name: string, a: Record<string, unknown>): Promise<Result> {
  const dir = str(a.repo_path) ?? process.cwd();
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
      const r = await call(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text" as const, text: JSON.stringify(r.json, null, 2) }], structuredContent: r.json };
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : String(e));
      return { content: [{ type: "text" as const, text: JSON.stringify({ schema: SCHEMA, command: req.params.name, ok: false, error: message }) }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}
