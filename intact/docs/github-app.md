# Hosted GitHub App: design note (whole Mainfast suite)

Status: built, in the private `mainfast/app` repository. The Actions stay free; the App is the hosted
form of the same
libraries, so installs need no workflow file. All names come from the
suite's `brand.json`. This note lives in `intact/docs/` because Intact is the first product
to move; it covers all five.

## One App, five check runs

One App, **Mainfast**, Mergify-style: one install, one `.mainfast.yml`, one bill. Each product
posts its own check run under its own name (`Mainfast Intact`, `Mainfast Migrations`,
`Mainfast Rollcall`, `Mainfast Owners`, `Mainfast Evidence`), so a ruleset can require any
subset. A product with no section in `.mainfast.yml` runs with its defaults; a section with
`enabled: false` (App-only key, to be added to the schema) turns it off.

| Product | What the App runs | Trigger |
| --- | --- | --- |
| Intact | Re-run each merge commit the PR brings in; report dropped hunks and evil changes | `pull_request`, `push` to non-default branches |
| Migrations | Migration ledger of PR head vs main; re-check open PRs when main moves, blocking commit status on stale ones | `pull_request`, `push` to default branch |
| Rollcall | Required checks (rulesets + protection) vs check runs of recent merged PRs | daily per repo, `push` touching `.github/workflows/**`, `branch_protection_rule`, `repository_ruleset` |
| Owners | Unowned paths in the PR; full CODEOWNERS drift audit | `pull_request`; weekly per repo |
| Evidence | Provenance + test/claim/tamper evidence for agent PRs, re-evaluated when CI finishes | `pull_request`, `check_suite` / `workflow_run` completed |

## Webhooks

| Event | Actions | Used by |
| --- | --- | --- |
| `pull_request` | `opened`, `synchronize`, `reopened`, `edited`, `labeled`, `ready_for_review` | Intact, Migrations, Owners, Evidence |
| `push` | all | Intact (non-default branches), Migrations (default branch: re-check open PRs), Rollcall (workflow changes) |
| `check_suite` | `completed`, `rerequested` | Evidence (CI finished), every product (re-run all) |
| `check_run` | `rerequested` | every product ("Re-run") |
| `branch_protection_rule`, `repository_ruleset` | all | Rollcall |
| `installation`, `installation_repositories` | all | bookkeeping, plan count, welcome check |

Pushes to the default branch are skipped by Intact: PR merges made by GitHub are the
automatic result by construction, and the PR was already checked.

## Permissions

| Permission | Level | Used for |
| --- | --- | --- |
| Checks | write | Check runs and annotations (all) |
| Contents | read | Commits, trees, blobs, compare, `.mainfast.yml`, CODEOWNERS, workflows, `extends` targets in the same org |
| Pull requests | write | PR files and commits (read); sticky comments and labels (Migrations, Owners, Evidence) |
| Issues | write | Labels live on the issue side of a PR (Migrations) |
| Commit statuses | write | Migrations' `mainfast/migrations` status (on by default; blocks when required) |
| Administration | read | Branch protection and rulesets (Rollcall) |
| Actions | read | Workflow runs for Evidence's "tests ran on this sha" |
| Members (org) | read | Owners: org membership, teams (the Action cannot do this with `GITHUB_TOKEN`) |
| Metadata | read | Mandatory |

No user OAuth, no write access to code. The App's private key mints a one-hour installation
token per event.

## Where it runs

A Cloudflare Worker receives webhooks (cheap, global, no idle cost) but cannot run `git`.

- **API-only products run in the Worker**: Rollcall, Owners (CODEOWNERS parse + API
  lookups), Evidence (PR files/commits/checks via REST; local-diff mode is not needed), and
  Migrations' fast path (list migration directories at two refs via the trees API).
- **Intact needs a three-way merge.** Fast path in the Worker: list the PR's commits; no
  commit with two parents = green check immediately (most PRs). Otherwise:
  - **A. Stateless (Worker):** for each merge `M = merge(P1, P2)`, `compare` gives the merge
    base and per-file blob shas; files changed on one side only need no merge; files changed
    on both sides get a JS diff3 of the three blobs, then the existing `judgeHunk` /
    `markerRegions` analysis. Limits: 300 files per compare, truncated patches, rate limits,
    criss-cross histories not reproduced exactly, and the JS diff3 must match git's `ort`.
  - **B. Container (Cloudflare Containers, Fly Machines or Cloud Run; scale to zero):** a
    blobless partial clone (`git clone --filter=blob:none --no-checkout`), fetch base and
    head, `mainfast check --range base..head --json`, post the check run, delete the clone.
    Byte-for-byte git's own merge, so results match the CLI and the Action.
  - Recommended: fast path, then cache by `(merge sha, config hash)` in KV (a merge
    commit's result is immutable), then B for anything uncached.

The service stores no code at rest. KV holds results keyed by sha; D1 holds installations,
plan state and alert settings.

## Config

- `.mainfast.yml` from the **base branch**, never the PR head, for every product (the
  Actions already do this for Intact, Migrations and Evidence). Same schema
  (`schema/mainfast.schema.json`), same rule: unknown top-level keys are a config error,
  reported as a failing `Mainfast config` check run rather than silently ignored.
- `extends:` (Pro) is resolved with the installation token, so an org's shared config in
  `acme/.github` works without extra secrets. One level, cached per `(repo, sha)`.
- First 14 days after install: every product reports `neutral` instead of `failure`, so a
  new install never blocks a merge on day one. After that, each product's own default.

## Plan and billing

The Actions stay free and never block for licensing. The App is what Pro sells.

- Free: public repositories, and private organisations with up to 5 active contributors
  (opened a PR or pushed in the last 30 days; bots excluded).
- Pro: private organisations above that, $4 per active contributor per month, billed through
  Polar (seat product; bought from the dashboard, with the installation id in checkout metadata).
- Over the limit without a subscription: 14 days in full, with a warning and the date from day 7.
  After that each hosted check fails as "Mainfast Pro needed" and checks nothing, and the dashboard
  shows only the upgrade page. Only a known "nothing live at Polar" blocks; any doubt runs normally.
  A payment re-checks open PRs.
- Pro adds: one install, the dashboard, Slack and email alerts, cached results, and answers to
  issues within one business day. `extends:` stays free in the Actions.

## Security

- Verify `X-Hub-Signature-256` on every webhook; drop anything else.
- Installation tokens live only for the job; never logged.
- Container clone in tmpfs, deleted after the job; logs carry shas and paths only.
- Annotations quote at most 12 lines per finding; Evidence never quotes a secret-like
  string, only its location.

## Marketplace plan

GitHub Marketplace needs a verified publisher (organisation, verified domain, 2FA) before it
lists paid plans.

1. **Now**: the five Actions on the Actions Marketplace, free, MIT. First users and bug
   reports at zero hosting cost.
2. **App beta**: free for everyone while in beta; listing categories *Code review* and
   *Continuous integration*; one listing, "Mainfast", leading with Intact's one-sentence
   problem: "Your pull request diff never shows what the merge commit itself did."
3. **Reaching installs**: a write-up of a real dropped-fix incident (the
   `git checkout --ours` pattern), a demo repo with a planted evil merge and a forked
   migration ledger, posts on Hacker News, r/git and dev.to, the Claude Code plugin for
   agent-driven merges.
4. **Paid**: Pro at $4 per active contributor per month for private organisations over 5
   active contributors; public repositories and small private teams stay free.

## Open questions

- Rollcall needs Administration: read, which some orgs refuse to grant an App. Offer it as a
  separate opt-in App permission set, or keep Rollcall Action-only?
- Owners needs org Members: read: same question.
- `enabled: false` per section and the `Mainfast config` check run are App-only; add them
  to the schema before the App ships.
