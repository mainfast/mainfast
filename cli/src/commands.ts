// `check` and `audit`, thin wrappers over the product CLIs. All of them read only: audit never asks a
// product to comment, label, post a status or write a snapshot.
import { CliError, githubRepo, githubToken, mainRef, repoRoot, safeRef, SCHEMA, type Result } from "./common.ts";
import { parseReport, runProduct } from "./products.ts";

export const AUDIT_CHECKS = ["rollcall", "owners", "migrations", "evidence"] as const;
export type AuditCheck = (typeof AUDIT_CHECKS)[number];

export const AUDIT_NEEDS: Record<AuditCheck, string> = {
  rollcall: "A GitHub origin remote. A private repository also needs GITHUB_TOKEN or GH_TOKEN, and reading branch protection needs Administration: read. No checkout needed.",
  owners: "Nothing for the offline lint. With a GitHub origin remote and a token it runs the full audit, which also checks that each owner exists and has write access.",
  migrations: "A checkout with the main branch fetched. No token needed.",
  evidence: "A checkout with the main branch fetched; this local run skips the evidence that comes from CI checks. To evaluate a pull request: a GitHub origin remote and a token.",
};

export interface CheckOptions {
  dir: string;
  commit?: string;
  range?: string;
  main?: string;
  failOn?: string;
  /** The product's own text output instead of a JSON report. */
  text?: boolean;
}

function assemble(command: string, extra: Record<string, unknown>, r: { code: number; stdout: string; stderr: string }, text: boolean): Result {
  if (text) {
    if (r.code === 2) throw new CliError(r.stderr.trim() || r.stdout.trim() || "exit code 2");
    return { exitCode: r.code, json: {}, text: r.stdout.trimEnd() };
  }
  const { report, error } = parseReport(r);
  if (error !== undefined) throw new CliError(error);
  const failed = r.code !== 0;
  return { exitCode: r.code, json: { schema: SCHEMA, command, ok: !failed, ...extra, exit_code: r.code, report }, text: "" };
}

export async function runCheck(o: CheckOptions): Promise<Result> {
  const root = repoRoot(o.dir);
  const args = o.text ? ["check"] : ["check", "--json"];
  if (o.commit) args.push(safeRef("commit", o.commit));
  if (o.range) args.push("--range", safeRef("range", o.range));
  if (o.main) args.push("--main", safeRef("main", o.main));
  if (o.failOn) args.push("--fail-on", o.failOn);
  return assemble("check", { repo: root }, await runProduct(root, "intact", args), Boolean(o.text));
}

export interface AuditOptions {
  dir: string;
  check: string;
  main?: string;
  pr?: number;
  offline?: boolean;
  text?: boolean;
}

function auditArgs(root: string, o: AuditOptions): string[] {
  const repo = githubRepo(root);
  const needRepo = () => {
    if (!repo) throw new CliError(`audit ${o.check}: no GitHub origin remote. Needs: ${AUDIT_NEEDS[o.check as AuditCheck]}`);
    return repo;
  };
  switch (o.check as AuditCheck) {
    case "rollcall":
      return ["audit", "--github-repo", needRepo(), "--format", "json"];
    case "owners":
      if (o.offline || !repo || !githubToken()) return ["lint", "--repo", root, "--format", "json"];
      return ["audit", "--github-repo", repo, "--format", "json"];
    case "migrations":
      return ["check", "--repo", root, "--main", mainRef(root, o.main), "--format", "json"];
    case "evidence":
      if (o.pr !== undefined) {
        if (!Number.isInteger(o.pr) || o.pr <= 0) throw new CliError("--pr: expected a pull request number");
        return ["pr", "--repo", needRepo(), "--pr", String(o.pr), "--json"];
      }
      return ["local", "--base", mainRef(root, o.main), "--repo", root, "--json"];
    default:
      throw new CliError(`unknown check: ${o.check} (expected one of ${AUDIT_CHECKS.join(", ")})`);
  }
}

export async function runAudit(o: AuditOptions): Promise<Result> {
  const root = repoRoot(o.dir);
  const args = auditArgs(root, o);
  const asked = o.text ? args.map((a) => (a === "json" ? "text" : a)).filter((a) => a !== "--json") : args;
  return assemble("audit", { repo: root, check: o.check, needs: AUDIT_NEEDS[o.check as AuditCheck] }, await runProduct(root, o.check, asked), Boolean(o.text));
}
