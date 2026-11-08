// `init`: write the workflows and a starter config. Touches only fixed paths inside the repository,
// never overwrites without force, never pushes and never changes branch protection.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRepoFile, repoPathKind } from "@mainfast/shared/repo-file";
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

/** Workflow files in the repository that already use this check's action. */
export function installedIn(root: string, slug: ProductSlug): string[] {
  const rel = ".github/workflows";
  // Throws on a symlink: .github/workflows must be a real directory inside the repository.
  if (repoPathKind(root, rel) !== "directory") return [];
  const action = product(slug).actionRef.split("@")[0]!;
  return readdirSync(join(root, rel))
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      try {
        return readRepoFile(root, `${rel}/${f}`)?.includes(`uses: ${action}@`) ?? false;
      } catch {
        return false; // a symlink, a directory or an oversized file is not an installed check
      }
    })
    .map((f) => `${rel}/${f}`);
}

function nextSteps(slugs: readonly ProductSlug[]): string[] {
  const steps = ["Review the new files, commit them and open a pull request. Nothing has been pushed."];
  const required = slugs.filter((s) => s !== "rollcall" && s !== "migrations").map((s) => `"${product(s).checkName}"`);
  if (slugs.includes("migrations")) required.push(`"${product("migrations").statusContext ?? "mainfast/migrations"}"`);
  if (required.length) steps.push(`To block merges on findings, make ${required.join(", ")} required in branch protection or a ruleset.`);
  if (slugs.includes("evidence")) steps.push(`Evidence: set workflows: [CI] in ${workflowPath("evidence")} to the name of your test workflow.`);
  if (slugs.includes("rollcall")) steps.push("Rollcall runs weekly and keeps one tracking issue open while it finds problems. After you change a ruleset, run it by hand from the Actions tab.");
  if (slugs.includes("owners")) steps.push("Owners needs a CODEOWNERS file; until you add one, every run reports it as missing.");
  return steps;
}

export function runInit(opts: InitOptions): Result {
  const root = repoRoot(opts.dir);
  const wanted = opts.checks?.length ? opts.checks : PRODUCT_SLUGS;
  for (const c of wanted) if (!PRODUCT_SLUGS.includes(c as ProductSlug)) throw new CliError(`unknown check: ${c} (expected one of ${PRODUCT_SLUGS.join(", ")})`);
  const slugs = [...new Set(wanted)] as ProductSlug[];

  const written: string[] = [];
  const overwritten: string[] = [];
  const unchanged: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const place = (rel: string, content: string): void => {
    const current = readRepoFile(root, rel);
    const abs = join(root, rel);
    const exists = current !== undefined;
    if (current === content) return void unchanged.push(rel);
    if (exists && !opts.force) return void skipped.push({ path: rel, reason: "exists with different content; use --force to replace it" });
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
  if (repoPathKind(root, SUITE.configFileAlt)) skipped.push({ path: SUITE.configFile, reason: `${SUITE.configFileAlt} already exists` });
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
