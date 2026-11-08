# Mainfast

Five GitHub checks that stop merges from silently breaking `main`. They share one config file
(`.mainfast.yml`) and are MIT-licensed. Each check runs as a GitHub Action in your own
workflows, with your own `GITHUB_TOKEN`. Mainfast Pro runs the same checks as a hosted GitHub App
([how the App works](intact/docs/github-app.md)).

## The five checks

| Check | What it catches | Runs on | Folder |
| --- | --- | --- | --- |
| **Mainfast Intact** | A merge commit that silently dropped main's changes (a conflict "resolved" with `--ours`, a lost hunk) or slipped in an unrelated edit (evil merge) | `pull_request`, `push` | [`intact/`](intact/) |
| **Mainfast Migrations** | Database migrations that would fork or reorder the migration history once merged (Alembic, Django, Prisma, Rails, Flyway, Drizzle); re-checks open PRs when main moves and blocks the stale ones with a commit status | `pull_request`, `push` to main | [`migrations/`](migrations/) |
| **Mainfast Rollcall** | Required checks that do not protect anything: never ran, skipped but counted as passing, renamed, path-filtered, drifted, merged while pending | weekly schedule, `push` to main that changes workflows, `branch_protection_rule`, by hand after a ruleset edit | [`rollcall/`](rollcall/) |
| **Mainfast Owners** | CODEOWNERS drift: files a PR touches that the base branch's CODEOWNERS does not own, mistakes in a PR's own CODEOWNERS edit (before merge), owners who left or lost access, missing teams, dead patterns. The weekly audit also finds dormant owners | `pull_request`, weekly schedule | [`owners/`](owners/) |
| **Mainfast Evidence** | Agent-written PRs without proof: tests not run (or skipped) on the head commit, deleted or weakened tests, unbacked "tests pass" claims, edits to workflows or `.mainfast.yml`. By default it gates only agent PRs (other PRs pass as "Not an agent PR"). Fork PRs get a card through `workflow_run`, without any PR code being checked out | `pull_request`, `workflow_run` | [`evidence/`](evidence/) |

## Install

Each check is its own workflow. The quickest way to add them is `npx mainfast init`
([see below](#set-up-with-one-command)). To do it by hand, copy the example workflow of each check
you want into `.github/workflows/`. Third-party actions in the examples are pinned to full commit
SHAs.

Intact, for example:

```yaml
# .github/workflows/mainfast-intact.yml
name: Mainfast Intact
on:
  pull_request:
  push:
    branches-ignore: [main]
permissions:
  contents: read
  checks: write
jobs:
  intact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: mainfast/intact@v0
        # Report-only by default. `with: { fail-on: warning }` fails the job on dropped changes and evil merges.
```

The other checks:

| Check | Workflow to copy | Permissions | Notes |
| --- | --- | --- | --- |
| Migrations | [`mainfast-migrations.yml`](migrations/examples/mainfast-migrations.yml) | `contents: read`, `pull-requests: write`, `statuses: write` | Sets the blocking `mainfast/migrations` commit status; require it in branch protection. |
| Rollcall | [`rollcall.yml`](rollcall/examples/rollcall.yml) | `contents: read`, `pull-requests: read`, `statuses: read`, `checks: write`, `issues: write` | No checkout needed. |
| Owners | [`owners.yml`](owners/examples/owners.yml) | `contents: read`, `pull-requests: write` | No checkout needed. An optional `org-token` (Organization > Members: read) adds org membership and team checks. |
| Evidence | [`evidence.yml`](evidence/examples/workflows/evidence.yml) | `contents: read`, `checks: write`, `pull-requests: write`, `statuses: read`, plus `actions: read` in the `workflow_run` job | Two jobs: one for same-repository PRs, and one that runs after your CI, also covers fork PRs and never checks out PR code. |

The examples use the moving tag `@v0`, which follows each new release. To stay on one exact version and choose when to update, replace `@v0` with a full commit SHA.

## Set up with one command

Run this from the repository root (it works the same for you and for a coding agent):

```bash
npx mainfast init
```

It writes the workflow files and a starter `.mainfast.yml`, then lists what is left to do, such as
making a check required. It never overwrites a file unless you pass `--force`, and it does not
commit, push or change branch protection.

| Command | What it does |
| --- | --- |
| `mainfast init [--checks intact,owners] [--dry-run]` | Install the checks in this repository |
| `mainfast doctor` | What is installed, whether the config parses, what is missing |
| `mainfast check` | Run Intact on the merge commits in this branch, before you push |
| `mainfast audit <rollcall\|owners\|migrations\|evidence>` | Run one check locally; it only reads |

Every command takes `--json`. Exit codes: `0` nothing failed (warnings may still be listed), `1` a
finding that fails or something missing, `2` error. The token comes from `GITHUB_TOKEN` or
`GH_TOKEN` and is never printed.

The same commands are available to any MCP client as tools, over stdio:

```json
{
  "mcpServers": {
    "mainfast": { "command": "npx", "args": ["-y", "mainfast", "mcp"] }
  }
}
```

`mainfast init` sets up the Actions. The [hosted GitHub App](https://github.com/apps/mainfast) is
the other option: it needs no workflow files, and you install it on GitHub.

## One config file

Everything lives in `.mainfast.yml` at the repository root, one section per check. Each
check reads only its own section and ignores the others without a warning; an unknown
top-level key is an error, so a typo like `intakt:` never quietly switches a check back to
its defaults. Checks read the file from the base branch, so a pull request cannot loosen
its own check. Reference: [`docs/config.md`](docs/config.md); JSON Schema for editors:
[`schema/mainfast.schema.json`](schema/mainfast.schema.json); a full example:
[`schema/example.mainfast.yml`](schema/example.mainfast.yml).

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mainfast/mainfast/main/schema/mainfast.schema.json
version: 1
extends: acme/.github:mainfast/base.yml@main   # Pro: org-wide shared config (optional)
intact:
  ignore: ["dist/"]
migrations:
  outOfOrder: { rails: warning, prisma: error }
evidence:
  apply_to: agents
```

## Free and Pro

The five GitHub Actions are **free and open source (MIT)** for everyone, at any size:

- No feature needs a key, and org-wide shared config (`extends:`) is included. The Actions never
  fail or block a merge over licensing.
- On a private repository with more than 5 active contributors (opened a pull request or pushed
  in the last 30 days; bots are not counted) and no `MAINFAST_LICENSE` key, each Action adds
  **one notice** to the job summary (Intact also to its check run).
- The count uses your workflow's `GITHUB_TOKEN` (PR authors from the pulls list, pushers
  from the repository activity API, else default-branch commit authors), once per run.
  Give the job `pull-requests: read` for an exact count; without it the notice counts
  pushers only. If the API refuses, there is no notice.
- If you have a key, save it as the `MAINFAST_LICENSE` secret and pass
  `license: ${{ secrets.MAINFAST_LICENSE }}` to each step. The key is checked once per run with
  Polar's public license-key endpoint (only the key and the organization id are sent, with a
  3-second timeout); if Polar cannot be reached the key counts as valid. A key Polar reports as
  unknown, revoked or expired is ignored with one log line, as if no key were set.

**Mainfast Pro is the hosted GitHub App**, at **$4 per active contributor per month**, for private
organizations above 5 active contributors. It is free for public repositories and for private
organizations up to that limit. You buy it from the [dashboard](https://app.mainfast.dev), through Polar.

| Pro includes | |
| --- | --- |
| **One install** | No workflow files; config from the base branch |
| **Dashboard** | Findings and trends per organization and repository |
| **Alerts** | Slack and email for a drop on main, a stale migration ledger, a required check that stopped reporting, or a dormant code owner |
| **Cached results** | A merge commit found clean is not checked twice |
| **Support** | Answers to issues within one business day |

A new install runs in full for 14 days, and from day 7 the checks and dashboard show the date
blocking starts. After that, with no Pro, **every hosted check fails as "Mainfast Pro needed" and
checks nothing, which blocks merges where it is required**, and the dashboard shows only the upgrade
page. Data stays stored while the App is installed and returns on payment, and open pull requests
are re-checked automatically. If the plan can't be determined, the checks run normally.

Reading policy from the base branch is not a Pro feature: it is the default for every
check, because a check a PR can switch off is not a check.

## Report a problem

Found a bug or a false positive, or want something added? [Open an issue](https://github.com/mainfast/mainfast/issues),
for any of the five checks. You don't need a key or a paid plan. Issues are public, so leave out private
code and secrets; report security problems as [SECURITY.md](SECURITY.md) describes.

## Repository layout

npm workspaces, one toolchain (TypeScript 5.9, `@types/node` 22, Vitest 5, esbuild 0.28,
Node 20+; the Actions run on `node24`):

```
brand.json                 every brand string (names, check names, comment markers, action refs)
packages/shared/           @mainfast/shared: GitHub client, Actions I/O, fixture fetch, globs,
                           brand, .mainfast.yml loader + extends, plan gate, Markdown escaping,
                           sticky comments owned by the token's login
intact/ migrations/ rollcall/ owners/ evidence/
  action.yml               runs dist/index.cjs
  dist/index.cjs           the Action (committed, self-contained)
  dist/cli.cjs             the CLI
  dist/lib.cjs             the library
schema/                    .mainfast.yml JSON Schema + full example
docs/config.md             .mainfast.yml reference
scripts/sync-brand.mjs     rewrites action.yml / package.json / examples / LICENSE
test/                      suite tests: brand drift, schema vs parsers
```

```bash
npm install
npm run all            # brand check, typecheck, every package's tests + suite tests, build
npm run brand:sync     # after editing brand.json
npm run lint:actions   # actionlint on every example workflow
```

Licenses: [`LICENSES.md`](LICENSES.md).
