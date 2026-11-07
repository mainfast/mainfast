# Changelog

## 0.1.0 (unreleased)

First release of Mainfast Intact, Migrations, Rollcall, Owners and Evidence.

Rollcall:

- A path-filtered required check is no longer also reported as `stopped-reporting`.
- `protection-drift` no longer fires when only one layer pins a check to an app, which GitHub does by itself in classic branch protection.
- `merged-while-pending` now catches a check that was running when the PR merged and finished later. Before, it only fired if the check was still unfinished when the audit ran. If that check later failed, it's reported here rather than as `merged-with-failure`.
- Branches protected only by rulesets no longer get a note saying classic required checks are unknown.

Intact:

- A blobless partial clone now gives the same result as a full clone. A blob that cannot be fetched is reported as an error, where it used to read as a missing file.
- The Action is report-only by default (`fail-on: off`): findings appear as annotations and a neutral check run, and the job passes. Set `fail-on: error` to block on dropped changes, or `warning` to also block on evil merges and partial drops. The CLI still defaults to `warning`.
- Warnings below the `fail-on` level no longer show as "intact" with a success check run.
- Dropped version bumps and changes to generated files are warnings, not errors. Lockfiles, CI workflows and Docker image files stay errors.
- Back-merges that reached main through a pull request are no longer reported with their sides swapped.
