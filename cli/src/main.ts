// The `mainfast` command. Exit codes: 0 nothing failed (warnings can still be listed), 1 findings that fail or something missing, 2 error.
import { parseArgs } from "node:util";
import { AUDIT_CHECKS, AUDIT_NEEDS, runAudit, runCheck } from "./commands.ts";
import { CliError, redact, SCHEMA, VERSION, type Result } from "./common.ts";
import { runDoctor } from "./doctor.ts";
import { runInit } from "./init.ts";
import { runMcp } from "./mcp.ts";
import { PRODUCT_ARG, runProductInProcess } from "./products.ts";

const COMMON = "  -C <dir>     run in <dir> (default: the current directory)\n  --json       one JSON object on stdout\n  -h, --help   show this help\n";
const HELP: Record<string, string> = {
  "": `mainfast ${VERSION}: set up and run GitHub checks that stop merges from silently breaking main.

usage: mainfast <command> [options]

  init     write the workflows and a starter config into this repository
  doctor   show which checks are installed, check the config, list what is missing
  check    run Intact on the merge commits in this branch
  audit    run Rollcall, Owners, Migrations or Evidence once; posts nothing
  mcp      serve these commands as MCP tools over stdio

Run mainfast <command> --help for its options. Every command takes --json.
Exit codes: 0 nothing failed (warnings can still be listed), 1 findings that fail or something missing, 2 error.
Token: read from GITHUB_TOKEN or GH_TOKEN, never printed.
`,
  init: `usage: mainfast init [--checks intact,owners,...] [--dry-run] [--force]

Writes .github/workflows/mainfast-<check>.yml for each check and a starter config. Leaves a file
that already has different content alone unless you pass --force. Does not commit, push or change
branch protection.

  --checks <a,b>  intact, migrations, rollcall, owners, evidence (default: all)
  --dry-run       show what would change without writing anything
  --force         replace files that have different content
${COMMON}`,
  doctor: `usage: mainfast doctor\n\nShows which checks are installed, whether the config parses and whether a token is set. Exits 1 if no\ncheck is installed or the config does not parse.\n\n${COMMON}`,
  check: `usage: mainfast check [<merge-commit>] [--range A..B] [--main <branch>] [--fail-on error|warning|notice]

Runs Intact locally. With no commit or range, checks every merge commit in <main>..HEAD.
Exit codes: 0 nothing failed (warnings can still be listed), 1 findings that fail, 2 error.

  <merge-commit>      check this one merge commit
  --range A..B        check every merge commit in the range
  --main <branch>     the main branch (default: from the config, else origin's default branch)
  --fail-on <level>   lowest level that fails: error, warning (default) or notice
${COMMON}`,
  audit: `usage: mainfast audit <${AUDIT_CHECKS.join("|")}> [--main <branch>] [--pr <n>] [--offline]

Runs one check once and prints the result. Posts nothing to GitHub.

What each check needs:
${AUDIT_CHECKS.map((c) => `  ${c}: ${AUDIT_NEEDS[c]}`).join("\n")}

  --main <branch>  the main branch (migrations and evidence)
  --pr <n>         evidence: evaluate this pull request through the GitHub API
  --offline        owners: run the offline lint even when a token is set
${COMMON}`,
  mcp: `usage: mainfast mcp\n\nAn MCP server over stdio, with the tools init, doctor, check and audit.\n`,
};

function emit(r: Result, json: boolean): number {
  process.stdout.write(`${redact(json ? JSON.stringify(r.json, null, 2) : r.text)}\n`);
  return r.exitCode;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === PRODUCT_ARG) return runProductInProcess(rest[0] ?? "", rest.slice(1));
  if (command === "-v" || command === "--version") return process.stdout.write(`${VERSION}\n`), 0;
  if (!command || command === "-h" || command === "--help") return process.stdout.write(HELP[""]!), command ? 0 : 2;
  if (!Object.hasOwn(HELP, command) || command === "") {
    process.stderr.write(`mainfast: unknown command: ${command}\n\n${HELP[""]}`);
    return 2;
  }

  let json = rest.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        C: { type: "string", short: "C" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        checks: { type: "string" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
        range: { type: "string" },
        main: { type: "string" },
        "fail-on": { type: "string" },
        pr: { type: "string" },
        offline: { type: "boolean" },
      },
    });
    json = values.json ?? false;
    if (values.help) return process.stdout.write(HELP[command]!), 0;
    const dir = values.C ?? process.cwd();
    const tooMany = (n: number) => {
      if (positionals.length > n) throw new CliError(`unexpected argument: ${positionals[n]}`);
    };
    switch (command) {
      case "init":
        tooMany(0);
        return emit(runInit({ dir, checks: values.checks?.split(",").map((s) => s.trim()).filter(Boolean), dryRun: values["dry-run"], force: values.force }), json);
      case "doctor":
        tooMany(0);
        return emit(runDoctor(dir), json);
      case "check":
        tooMany(1);
        return emit(await runCheck({ dir, commit: positionals[0], range: values.range, main: values.main, failOn: values["fail-on"], text: !json }), json);
      case "audit": {
        tooMany(1);
        if (!positionals[0]) throw new CliError(`audit needs a check name: ${AUDIT_CHECKS.join(", ")}`);
        return emit(await runAudit({ dir, check: positionals[0], main: values.main, pr: values.pr === undefined ? undefined : Number(values.pr), offline: values.offline, text: !json }), json);
      }
      case "mcp":
        tooMany(0);
        await runMcp();
        return -1;
      default:
        return 2;
    }
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : String(e));
    process.stderr.write(`mainfast: ${message}\n`);
    if (json) process.stdout.write(`${JSON.stringify({ schema: SCHEMA, command, ok: false, error: message }, null, 2)}\n`);
    return 2;
  }
}
