# Mainfast

GitHub checks that stop merges from silently breaking `main`. Five checks, one config
file (`.mainfast.yml`), MIT-licensed. They run today as GitHub Actions in your own
workflows with your own `GITHUB_TOKEN`; a hosted GitHub App comes later
([design note](intact/docs/github-app.md)).

Name: main + steadfast ("hold main fast").

## The five checks

| Check | What it catches | Runs on | Folder |
| --- | --- | --- | --- |
| **Mainfast Intact** | A merge commit that silently dropped main's changes (a conflict "resolved" with `--ours`, a lost hunk) or slipped in an unrelated edit (evil merge) | `pull_request`, `push` | [`intact/`](intact/) |
| **Mainfast Migrations** | Database migrations that would fork or reorder the migration history once merged (Alembic, Django, Prisma, Rails, Flyway, Drizzle); re-checks open PRs when main moves and blocks the stale ones with a commit status | `pull_request`, `push` to main | [`migrations/`](migrations/) |
| **Mainfast Rollcall** | Required checks that do not protect anything: never ran, skipped-as-success, renamed, path-filtered, drifted, merged while pending | weekly schedule, `push` to main (workflows), `branch_protection_rule`, manual after a ruleset edit | [`rollcall/`](rollcall/) |
| **Mainfast Owners** | CODEOWNERS drift: files a PR touches that the base branch's CODEOWNERS does not own, mistakes in a PR's CODEOWNERS edit (before merge), owners who left or lost access, missing teams, dead patterns; weekly audit adds dormant owners | `pull_request`, weekly schedule | [`owners/`](owners/) |
| **Mainfast Evidence** | Agent-written PRs without proof: tests not run (or skipped) on the head commit, deleted or weakened tests, unbacked "tests pass" claims, touched workflows/policy. Gates agent PRs only by default (others pass as "not an agent PR"); fork PRs get a card through `workflow_run` without any PR code being checked out | `pull_request`, `workflow_run` | [`evidence/`](evidence/) |

## Install

Each check is one step in a workflow. Copy the ones you want into `.github/workflows/`
(full examples with comments in each folder's `examples/`). Third-party actions are pinned to
full commit SHAs.

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
```

```yaml
# Mainfast Migrations, pull_request + push to main (permissions: contents read, pull-requests write, statuses write)
# Sets the blocking `mainfast/migrations` status by default; require it in branch protection.
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with: { fetch-depth: 0 }
      - uses: mainfast/migrations@v0

# Mainfast Rollcall, weekly + on workflow/protection changes; no checkout needed
# (permissions: contents read, pull-requests read, statuses read, checks write, issues write)
      - uses: mainfast/rollcall@v0

# Mainfast Owners, pull_request + weekly schedule; no checkout needed (permissions: contents read, pull-requests write)
# Optional org-token (Organization > Members: read) for org membership and team checks.
      - uses: mainfast/owners@v0
        with: { org-token: "${{ secrets.MAINFAST_OWNERS_ORG_TOKEN }}" }

# Mainfast Evidence, two jobs (permissions: contents read, checks write, pull-requests write, statuses read; + actions read on workflow_run)
# pull_request job (same-repo PRs): checkout of the PR head for a local diff, then the action.
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with: { fetch-depth: 0, ref: "${{ github.event.pull_request.head.sha }}" }
      - uses: mainfast/evidence@v0
# workflow_run job (after CI; also fork PRs): NO checkout, the diff comes from the API.
      - uses: mainfast/evidence@v0
        with: { local-diff: "false" }
```

Intact also ships a CLI (`mainfast check`) and a Claude Code plugin that runs it before a push.

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

All five checks are **free and open source (MIT)** for:

- **public repositories**, and
- **private repositories with up to 5 active contributors**. Active = opened a pull request
  or pushed in the last 30 days; bots are not counted.

Private organisations above that pay for **Mainfast Pro: $4 per active contributor per
month** (billing through Polar, coming). Pro is a fair-use request, not a lock:

- The code is MIT for everyone, and no feature is switched off without a key.
- On a private repository with more than 5 active contributors and no `MAINFAST_LICENSE`
  key, each Action adds **one polite notice** to the job summary (Intact also to its check
  run). It never fails, blocks or changes a check because of licensing.
- The count uses your workflow's `GITHUB_TOKEN` (PR authors from the pulls list, pushers
  from the repository activity API, else default-branch commit authors), once per run.
  Give the job `pull-requests: read` for an exact count; without it the notice counts
  pushers only. If the API refuses, there is no notice.
- With a key, save it as the `MAINFAST_LICENSE` secret and pass
  `license: ${{ secrets.MAINFAST_LICENSE }}` to each step. The key is checked once per run with
  Polar's public licence-key endpoint (only the key and the organisation id are sent, with a
  3-second timeout); if Polar cannot be reached the key counts as valid. A key Polar reports as
  unknown, revoked or expired is ignored with one log line, as if no key were set.
- **Optional free key.** A free key from the pricing page (a $0 Polar checkout) gets you
  release and security notices by email and lets us know you use Mainfast; no feature needs it
  and nothing changes without it. Pass it the same way; the job summary then says
  "Registered (free key)". It is not a Pro key, so a larger private repository still gets the notice.

What Pro pays for, as it lands:

| Pro feature | Status |
| --- | --- |
| **`extends:` org-wide shared config**: one policy file in another repository (or path) that every repository's `.mainfast.yml` builds on | In Mainfast Intact, Rollcall and Owners now (works for everyone in the open-source Action; the notice covers fairness). Migrations and Evidence accept the key and will apply it in their release passes |
| **Alerts**: Slack and email when a check catches a drop on main, a stale migration ledger or an unprotected required check | Planned (needs the hosted side) |
| **Hosted GitHub App**: no workflow files, config from the base branch, cached results per merge commit, org dashboard | Planned ([design](intact/docs/github-app.md)) |
| **Support**: issues answered within one business day | With the first paid plan |

Reading policy from the base branch is not a Pro feature: it is the default for every
check, because a check a PR can switch off is not a check.

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
scripts/sync-brand.mjs     rewrites action.yml / package.json / plugin.json / examples / LICENSE
test/                      suite tests: brand drift, schema vs parsers
```

```bash
npm install
npm run all            # brand check, typecheck, every package's tests + suite tests, build
npm run brand:sync     # after editing brand.json
npm run lint:actions   # actionlint on every example workflow
```

Licences: [`LICENSES.md`](LICENSES.md).
