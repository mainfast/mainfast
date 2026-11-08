# Changelog

## 0.1.3 (2026-11-08)

- The plan notice says where to find the Pro key, and offers the hosted App as the way to pay without a key.

## 0.1.2 (2026-11-08)

- `mainfast` CLI: clearer help, error and report text, American spelling, real plurals.

## 0.1.1 (2026-11-08)

First release of Mainfast Intact, Migrations, Rollcall, Owners and Evidence.

- `mainfast`: one command for people and agents, `npx mainfast init|doctor|check|audit`, with `--json`, and `mainfast mcp`, an MCP server over stdio with the same tools.
- Evidence: coverage paths from `.mainfast.yml` are read only from inside the repository, not through a symlink or `..`. The `coverage-files` input and `--coverage` are unchanged.

Rollcall:

- A path-filtered required check is no longer also reported as `stopped-reporting`.
- `protection-drift` no longer fires when only one layer pins a check to an app, which GitHub does by itself in classic branch protection.
- `merged-while-pending` now catches a check that was running when the PR merged and finished later. Before, it only fired if the check was still unfinished when the audit ran. If that check later failed, it's reported here rather than as `merged-with-failure`.
- Branches protected only by rulesets no longer get a note saying classic required checks are unknown.
- A job named only by an expression (`name: ${{ matrix.x }}`) no longer counts as producing every required check, which blamed it for checks it has nothing to do with.
- `stopped-reporting` and `renamed` no longer count open PRs that simply have not run a check yet. Open PRs count only when nothing has merged for 7 days, as a warning.
- `renamed` now needs a similar name; any job added since no longer qualifies.
- `ruleset-not-enforced` only reports rulesets that target the audited branch.
- `not-on-pull-request` no longer fires on `workflow_call` reusable workflows.
- `${{ matrix.x }}` in a job name now resolves to the values the matrix lists, so `Check ${{ matrix.file }}` is no longer taken to produce `Check all requirements`.
- `conditional-job` no longer fires when the condition always holds on a PR into this repository (the event name, the repository, empty dispatch inputs).
- `path-filtered` and `not-on-pull-request` no longer fire when another job covers PRs into this branch, or for two filtered workflows that report on every sampled PR. `ambiguous-name` no longer fires when one job runs only in the merge queue and the other never does.
- `merged-with-failure` ignores a failure only when every failing source arrived after the merge, and lists those in the report's notes.
- Open PRs only count as `stopped-reporting` when the branch itself has stopped moving, so a mirrored repository does not read as blocked.

Migrations:

- Django apps with a custom `AppConfig.label` no longer read as having every migration as a leaf. The label comes from `apps.py`, or else from the migrations' own dependencies.
- Django dependencies on a migration that a squash replaces now resolve to the squash. Migrations with no number in their file name now count.

Owners:

- Logins ending in a hyphen, which GitHub allows for older accounts, are no longer reported as `invalid-line`.

Intact:

- A blobless partial clone now gives the same result as a full clone. A blob that cannot be fetched is reported as an error, where it used to read as a missing file.
- The Action is report-only by default (`fail-on: off`): findings appear as annotations and a neutral check run, and the job passes. Set `fail-on: error` to block on dropped changes, or `warning` to also block on evil merges and partial drops. The CLI still defaults to `warning`.
- Warnings below the `fail-on` level no longer show as "intact" with a success check run.
- Dropped version bumps and changes to generated files are warnings, not errors. Lockfiles, CI workflows and Docker image files stay errors.
- Back-merges that reached main through a pull request are no longer reported with their sides swapped.
