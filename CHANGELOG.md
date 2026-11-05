# Changelog

## 0.1.0 (unreleased)

First release of Mainfast Intact, Migrations, Rollcall, Owners and Evidence.

Intact:

- The Action is report-only by default (`fail-on: off`): findings appear as annotations and a neutral check run, and the job passes. Set `fail-on: error` to block. The CLI still defaults to `warning`.
- Warnings below the `fail-on` level no longer show as "intact" with a success check run.
- Dropped version bumps and changes to generated files are warnings, not errors. Lockfiles, CI workflows and Docker image files stay errors.
- Back-merges that reached main through a pull request are no longer reported with their sides swapped.
