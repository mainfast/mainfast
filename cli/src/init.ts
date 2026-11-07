// `init`: write the workflows and a starter config. Touches only fixed paths inside the repository,
// never overwrites without force, never pushes and never changes branch protection.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { PRODUCT_SLUGS, product, SUITE, type ProductSlug } from "@mainfast/shared/brand";
import { CliError, repoRoot, SCHEMA, type Result } from "./common.ts";
import { STARTER_CONFIG, WORKFLOWS, workflowPath } from "./templates.ts";

export interface InitOptions {
  dir: string;
  checks?: readonly string[];
  dryRun?: boolean;
  force?: boolean;
}

export const hostedAppUrl = () => `https://github.com/apps/${SUITE.githubOrg}`;

/** Refuses a path that passes through a symlink, which could lead outside the repository. */
function assertNoSymlink(root: string, rel: string): void {
  let cur = root;
  for (const part of rel.split("/")) {
    cur = join(cur, part);
    if (existsSync(cur) || isLink(cur)) {
      if (isLink(cur)) throw new CliError(`refusing to write through a symlink: ${cur.slice(root.length + sep.length)}`);
    } else return;
  }
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Workflow files in the repository that already use this check's action. */
export function installedIn(root: string, slug: ProductSlug): string[] {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  const action = product(slug).actionRef.split("@")[0]!;
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      try {
        return readFileSync(join(dir, f), "utf8").includes(`uses: ${action}@`);
      } catch {
        return false;
      }
    })
    .map((f) => `.github/workflows/${f}`);
}

function nextSteps(slugs: readonly ProductSlug[]): string[] {
  const steps = ["Review the new files, commit them and open a pull request. Nothing has been pushed."];
  const required = slugs.filter((s) => s !== "rollcall" && s !== "migrations").map((s) => `"${product(s).checkName}"`);
  if (slugs.includes("migrations")) required.push(`"${product("migrations").statusContext ?? "mainfast/migrations"}"`);
  if (required.length) steps.push(`To let a finding block a merge, require ${required.join(", ")} in branch protection or a ruleset.`);
  if (slugs.includes("evidence")) steps.push(`Evidence: set workflows: [CI] in ${workflowPath("evidence")} to the name of your test workflow.`);
  if (slugs.includes("rollcall")) steps.push("Rollcall runs weekly and files one tracking issue; run it by hand from the Actions tab after a ruleset edit.");
  if (slugs.includes("owners")) steps.push("Owners needs a CODEOWNERS file to judge; without one it reports that.");
  return steps;
}

export function runInit(opts: InitOptions): Result {
  const root = repoRoot(opts.dir);
  const wanted = opts.checks?.length ? opts.checks : PRODUCT_SLUGS;
  for (const c of wanted) if (!PRODUCT_SLUGS.includes(c as ProductSlug)) throw new CliError(`unknown check: ${c}; one of ${PRODUCT_SLUGS.join(", ")}`);
  const slugs = [...new Set(wanted)] as ProductSlug[];

  const written: string[] = [];
  const overwritten: string[] = [];
  const unchanged: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const place = (rel: string, content: string): void => {
    assertNoSymlink(root, rel);
    const abs = join(root, rel);
    const exists = existsSync(abs);
    if (exists && readFileSync(abs, "utf8") === content) return void unchanged.push(rel);
    if (exists && !opts.force) return void skipped.push({ path: rel, reason: "exists with other content; use force to replace it" });
    if (!opts.dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    (exists ? overwritten : written).push(rel);
  };

  for (const slug of slugs) {
    const rel = workflowPath(slug);
    const others = installedIn(root, slug).filter((f) => f !== rel);
    if (others.length) skipped.push({ path: rel, reason: `already installed in ${others.join(", ")}` });
    else place(rel, WORKFLOWS[slug]);
  }
  if (existsSync(join(root, SUITE.configFileAlt))) skipped.push({ path: SUITE.configFile, reason: `${SUITE.configFileAlt} already exists` });
  else place(SUITE.configFile, STARTER_CONFIG);

  const steps = nextSteps(slugs);
  const json = { schema: SCHEMA, command: "init", ok: true, repo: root, dry_run: Boolean(opts.dryRun), checks: slugs, written, overwritten, unchanged, skipped, next_steps: steps, hosted_app: hostedAppUrl() };
  const verb = opts.dryRun ? "would write" : "wrote";
  const lines = [
    ...written.map((f) => `${verb}  ${f}`),
    ...overwritten.map((f) => `${opts.dryRun ? "would replace" : "replaced"}  ${f}`),
    ...unchanged.map((f) => `unchanged  ${f}`),
    ...skipped.map((s) => `skipped  ${s.path}: ${s.reason}`),
    "",
    "Next:",
    ...steps.map((s) => `- ${s}`),
    `- Optional: the hosted GitHub App runs these without workflow files: ${hostedAppUrl()}`,
  ];
  return { exitCode: 0, json, text: lines.join("\n") };
}
