# Changelog

## 0.1.0 (unreleased)

First release of Mainfast Intact, Migrations, Rollcall, Owners and Evidence.

Rollcall:

- A path-filtered required check is no longer also reported as `stopped-reporting`.
- `protection-drift` no longer fires when only one layer pins a check to an app, which GitHub does by itself in classic branch protection.

Intact:

- Dropped version bumps and changes to generated files are warnings, not errors. Lockfiles, CI workflows and Docker image files stay errors.
- Back-merges that reached main through a pull request are no longer reported with their sides swapped.
