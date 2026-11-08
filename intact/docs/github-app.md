# The Mainfast GitHub App

The [Mainfast GitHub App](https://github.com/apps/mainfast) is the hosted form of the same five
checks. You install it once on GitHub and need no workflow files. It uses the same libraries and
the same `.mainfast.yml` as the Actions, which stay free.

## One App, five check runs

Each check posts its own check run under its own name (`Mainfast Intact`, `Mainfast Migrations`,
`Mainfast Rollcall`, `Mainfast Owners`, `Mainfast Evidence`), so a ruleset can require any of
them. A check with no section in `.mainfast.yml` runs with its defaults; `enabled: false` in a
section turns that check off.

| Check | What the App runs | When |
| --- | --- | --- |
| Intact | Re-runs each merge commit the PR brings in and reports dropped hunks and evil changes | Pull requests, pushes to branches other than the default branch |
| Migrations | Checks the PR head's migrations against main; when main moves, re-checks open PRs and sets a blocking commit status on stale ones | Pull requests, pushes to the default branch |
| Rollcall | Compares the required checks (rulesets and branch protection) with what recent PRs reported | Daily, pushes that change workflows, branch protection and ruleset changes |
| Owners | Unowned paths in the PR; a full CODEOWNERS audit | Pull requests; weekly |
| Evidence | Provenance and test, claim and tampering evidence for agent PRs, re-evaluated when CI finishes | Pull requests, when check suites finish |

Intact skips pushes to the default branch: merges made by GitHub are the automatic result, and
the PR was already checked.

## Permissions

| Permission | Level | Used for |
| --- | --- | --- |
| Checks | write | Check runs and annotations (all checks) |
| Contents | read | Commits, trees, blobs, compare, `.mainfast.yml`, CODEOWNERS, workflows, `extends` targets in the same org |
| Pull requests | write | PR files and commits (read); PR comments and labels (Migrations, Owners, Evidence) |
| Issues | write | Labels, which live on the issue side of a PR (Migrations) |
| Commit statuses | write | The `mainfast/migrations` status (on by default; blocks when required) |
| Administration | read | Branch protection and rulesets (Rollcall) |
| Actions | read | Workflow runs, for Evidence's "tests ran on this commit" |
| Members (org) | read | Owners: org membership and teams (the Action cannot read these with `GITHUB_TOKEN`) |
| Metadata | read | Required by GitHub |

No user OAuth for the checks, and no write access to code. The App's private key creates a
one-hour installation token for each event.

## How it runs

Webhooks go to a Cloudflare Worker. Rollcall, Owners, Evidence and Migrations read everything
through the GitHub API. Intact needs real git: a PR with no merge commit gets a green check
straight away, and otherwise the same analysis as the Action runs in a container on a blobless
partial clone, which is deleted after the job. A merge commit found clean is remembered by its
sha and config, so it is not checked twice.

The service stores no code. It keeps installations, plan state, alert settings and finding
results keyed by commit sha.

## Config

- `.mainfast.yml` is read from the **base branch**, never from the PR head, for every check.
  Same schema ([`schema/mainfast.schema.json`](../../schema/mainfast.schema.json)), same rule:
  an unknown top-level key is a config error. A broken file is reported as a failing
  `Mainfast config` check run rather than silently ignored.
- `extends:` (Pro) is read with the installation token, so an org's shared config in
  `acme/.github` works without extra secrets. One level only.
- For the first 14 days after install, every check reports `neutral` instead of `failure`, so a
  new install never blocks a merge on day one. After that, each check uses its own default.

## Plan and billing

The Actions stay free and never block over licensing. The App is what Pro sells.

- Free: public repositories, and private organisations with up to 5 active contributors
  (opened a PR or pushed in the last 30 days; bots excluded).
- Pro: private organisations above that, $4 per active contributor per month, billed through
  Polar. You buy it from the dashboard.
- Over the limit without a subscription: 14 days in full, with a warning and the date from day 7.
  After that each hosted check fails as "Mainfast Pro needed" and checks nothing, and the dashboard
  shows only the upgrade page. Only a definite answer from Polar that nothing is paid blocks; if
  the plan can't be determined, the checks run normally. After payment, open PRs are re-checked.
- Pro includes: one install, the dashboard, Slack and email alerts, cached results, and answers to
  issues within one business day. `extends:` stays free in the Actions.

## Security

- Every webhook's `X-Hub-Signature-256` signature is verified; anything else is dropped.
- Installation tokens live only for the job and are never logged.
- The container's clone is deleted after the job; logs carry only commit shas and paths.
- Annotations quote at most 12 lines per finding. Evidence never quotes a secret-like string,
  only its location.
