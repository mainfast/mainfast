// CLI: `local` (offline, git only), `pr` (GitHub API, or a recorded fixture), `explain` (flag list).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_FLAGS, parsePolicy } from "./config.ts";
import { CLI_NAME, CONFIG_FILE, PRODUCT_NAME } from "./constants.ts";
import { evaluate, type EvidenceReport } from "./evaluate.ts";
import { FORK_COVERAGE_NOTE } from "./analyze/coverage.ts";
import { FLAG_FIXES } from "./fixes.ts";
import type { FlagId } from "./types.ts";
import { RestClient } from "./github/api.ts";
import { collectSnapshot, fetchPolicyText } from "./github/collect.ts";
import { mockFetch } from "./github/mockFetch.ts";
import { publish } from "./github/publish.ts";
import { loadCoverage, localPolicyText, localSnapshot } from "./local.ts";
import { renderCard, renderText } from "./render.ts";

const HELP = `${PRODUCT_NAME} — proof, not review, for agent-written pull requests.

Usage:
  ${CLI_NAME} local --base <ref> [--head <ref>] [--repo <dir>] [--body-file <f>] [--title <t>]
                    [--branch <name>] [--label <l>]... [--author <login>] [--coverage <file>]...
                    [--config <file>] [--all] [--format text|markdown] [--json]
      Offline: diff, tests weakening, claims, secrets, provenance from git (incl. git-ai notes).
      Check-based evidence is not evaluated. Policy is read from <base>:${CONFIG_FILE} unless --config.

  ${CLI_NAME} pr --repo <owner/name> --pr <n> [--token <t>] [--api-url <url>] [--fixture <routes.json>]
                 [--coverage <file>]... [--post [--comment-author <login>]]
                 [--format text|markdown] [--json]
      Full evaluation through the GitHub REST API (token from --token or GITHUB_TOKEN).
      --fixture serves recorded payloads instead of calling GitHub. --post writes the check run
      and sticky comment (default: print only); only a comment written by --comment-author
      (default: the token's own login, else github-actions[bot]) is ever edited.

  ${CLI_NAME} flags
      List every flag, its default severity and the one-line fix.

  --format text      plain text (default when stdout is a terminal)
  --format markdown  the evidence card as posted on the PR (default when piped)

Exit codes: 0 pass/warn, 1 evidence failed, 2 usage error, 3 pending.`;

function serialize(r: EvidenceReport): string {
  return JSON.stringify(r, (_k, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v), 2);
}

function exitFor(r: EvidenceReport): number {
  return r.conclusion === "failure" ? 1 : r.conclusion === "pending" ? 3 : 0;
}

export interface Io {
  out(s: string): void;
  err(s: string): void;
  /** stdout is a terminal: the default --format is then text. */
  isTTY?: boolean;
}

const stdio: Io = { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s), isTTY: process.stdout.isTTY === true };

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    io.out(`${HELP}\n`);
    return cmd ? 0 : 2;
  }
  if (cmd === "flags") {
    for (const [id, sev] of Object.entries(DEFAULT_FLAGS) as Array<[FlagId, string]>) io.out(`${id.padEnd(28)} ${sev.padEnd(5)} ${FLAG_FIXES[id].replace(/`/g, "")}\n`);
    return 0;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      base: { type: "string" },
      head: { type: "string" },
      repo: { type: "string" },
      pr: { type: "string" },
      token: { type: "string" },
      "api-url": { type: "string" },
      fixture: { type: "string" },
      "body-file": { type: "string" },
      title: { type: "string" },
      branch: { type: "string" },
      label: { type: "string", multiple: true },
      author: { type: "string" },
      coverage: { type: "string", multiple: true },
      config: { type: "string" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      post: { type: "boolean" },
      format: { type: "string" },
      "comment-author": { type: "string" },
    },
    allowPositionals: false,
  });
  const format = values.format ?? (io.isTTY ? "text" : "markdown");
  if (format !== "text" && format !== "markdown") {
    io.err(`--format: expected text or markdown, got "${format}"\n`);
    return 2;
  }
  const emit = (r: EvidenceReport) => {
    io.out(values.json ? `${serialize(r)}\n` : format === "text" ? `${renderText(r)}\n` : `${renderCard(r, { marker: false })}\n`);
    return exitFor(r);
  };

  if (cmd === "local") {
    if (!values.base) {
      io.err("local: --base is required\n");
      return 2;
    }
    const cwd = resolve(values.repo ?? ".");
    const loaded = parsePolicy(values.config ? readFileSync(values.config, "utf8") : localPolicyText(cwd, values.base));
    if (values.all) loaded.policy.applyTo = "all";
    const snap = localSnapshot(cwd, {
      base: values.base,
      head: values.head,
      title: values.title,
      body: values["body-file"] ? readFileSync(values["body-file"], "utf8") : undefined,
      branch: values.branch,
      labels: values.label,
      author: values.author,
    });
    const cov = loadCoverage(loaded.policy.coverage.files, cwd, values.coverage ?? []);
    for (const m of cov.missing) io.err(`warning: coverage file not found: ${m}\n`);
    for (const r of cov.refused) io.err(`warning: coverage file not read: ${r.reason}\n`);
    return emit(evaluate({ ...snap, coverage: cov.report }, loaded.policy, loaded.warnings));
  }

  if (cmd === "pr") {
    const prNum = Number(values.pr);
    if (!values.repo || !/^[^/]+\/[^/]+$/.test(values.repo) || !prNum) {
      io.err("pr: --repo owner/name and --pr <number> are required\n");
      return 2;
    }
    const fetchImpl = values.fixture ? mockFetch(JSON.parse(readFileSync(values.fixture, "utf8")) as Record<string, unknown>).fetch : undefined;
    const api = new RestClient(values.token ?? process.env.GITHUB_TOKEN, { baseUrl: values["api-url"], fetch: fetchImpl });
    const [owner, repo] = values.repo.split("/") as [string, string];
    const pull = await api.getPull(owner, repo, prNum);
    const loaded = parsePolicy(values.config ? readFileSync(values.config, "utf8") : await fetchPolicyText(api, owner, repo, pull.base.sha));
    if (values.all) loaded.policy.applyTo = "all";
    let snap = await collectSnapshot(api, values.repo, prNum, loaded.policy, { pull });
    // Fail closed: a missing head repo (deleted fork) counts as a fork.
    if (!pull.head.repo?.full_name || pull.head.repo.full_name.toLowerCase() !== values.repo.toLowerCase()) {
      snap = { ...snap, coverageUnavailable: FORK_COVERAGE_NOTE };
    } else {
      const cov = loadCoverage(loaded.policy.coverage.files, process.cwd(), values.coverage ?? []);
      for (const r of cov.refused) io.err(`warning: coverage file not read: ${r.reason}\n`);
      if (cov.report) snap = { ...snap, coverage: cov.report };
    }
    const report = evaluate(snap, loaded.policy, loaded.warnings);
    if (values.post) {
      const res = await publish(api, report, { commentAuthor: values["comment-author"] });
      io.err(`posted check run ${res.checkRunId}; comment ${res.commentAction}\n`);
    }
    return emit(report);
  }

  io.err(`unknown command: ${cmd}\n\n${HELP}\n`);
  return 2;
}

const isMain = typeof require !== "undefined" && require.main === module;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}
