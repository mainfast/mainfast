# Mainfast Intact

Proves that a merge commit did not silently drop changes from main.

When you merge `origin/main` into a feature branch, a conflict resolved by
"taking ours", or a hand-merge that loses a line, reverts main's work without a
trace. GitHub's PR diff compares the branch against main and never shows what
the merge commit itself did. `mainfast check` re-runs each merge and reports:

- **dropped**: a hunk main added (or removed) since the merge base that the
  merge commit no longer carries, with the main commit that introduced it
- **partially-dropped**: part of such a hunk is gone
- **evil**: the merge commit contains changes found in neither parent and
  outside any conflict

Part of the [Mainfast suite](../README.md). Free and MIT for public repositories and for
private ones with up to 5 active contributors; see [Free and Pro](../README.md#free-and-pro).

## Install

Requires Node 20+ and git (any version; 2.36+ is fastest).

```bash
cd mainfast && npm ci && npm run build -w intact     # npm workspaces at the suite root
ln -s "$PWD/intact/dist/cli.cjs" ~/.local/bin/mainfast
```

## Use

```bash
mainfast check                       # every merge commit in <main>..HEAD
mainfast check HEAD                  # one merge commit
mainfast check --range origin/main..feature
mainfast check --json                # machine-readable
mainfast check --fail-on error       # warnings do not fail
```

Exit codes: `0` intact, `1` findings at `--fail-on` level or above (default
`warning` for the CLI; the Action defaults to `off`), `2` could not analyse.

```
FAIL  d3be58f Merge branch 'main' into feat
      findings, via remerge-diff
      conflicted: config.txt
    ERROR dropped (main)  config.txt:5  [conflicted file]
          the merge drops main's change (+1/-1 lines)
          introduced by 3c9c1c1 "Raise timeout to 30" (Ana Main <ana@example.com>)
          main added:
            + timeout = 30
          main removed:
            - timeout = 10
          merge has:
              timeout = 10 # per tenant
    WARN  evil  app.txt:2
          the merge adds 1 line found in neither parent
          merge commit d3be58f "Merge branch 'main' into feat" (Dev <dev@example.com>)
          + DEBUG = True
```

### Config: `.mainfast.yml`, section `intact:`

One file for the whole suite ([reference](../docs/config.md),
[schema](../schema/mainfast.schema.json)). Intact reads its `intact:` section and ignores the
other products' sections; an unknown top-level key is an error.

```yaml
version: 1
intact:
  main_branch: main            # default: origin/HEAD, then main, master
  use_default_ignores: false   # default: lockfiles are checked (see below)
  ignore:                      # gitignore-style globs
    - "dist/"
    - "packages/generated-proto/**"
  severity:                    # first match wins: error, warning, notice, off
    "docs/**": notice
    "migrations/**": error
```

Default levels: `dropped (main)` error, `partially-dropped (main)` warning,
`evil` warning, any drop of the branch's own change notice (taking main's side
over your own change is usually deliberate).

The Action reads `.mainfast.yml` as committed at the **base** of the change (the pull
request's base commit, or the main branch for a push), so a pull request cannot ignore its
own dropped change. The CLI reads your working tree. Full example:
[`examples/.mainfast.yml`](examples/.mainfast.yml).

### Lockfiles are checked by default

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum` and the other
lockfiles are analysed like any file. A merge that takes the branch's lockfile wholesale
(`git checkout --ours package-lock.json`) can silently undo main's dependency bump, and that
bump is often a security fix. The finding names the main commit that made it.

The usual fix is to regenerate rather than hand-merge: take main's lockfile, re-run the
package manager, commit. If your repository already enforces a fresh lockfile elsewhere (a
CI step that fails on a stale one), you can stop Intact reporting them:

```yaml
intact:
  use_default_ignores: true          # all the well-known lockfiles
  # or name your own instead:
  # ignore: ["**/package-lock.json", "**/go.sum"]
  # or keep them reported but non-failing:
  # severity: { "**/*.lock": notice, "**/package-lock.json": notice }
```

The human report folds repeated lockfile hunks into one line per file.

### Dropped changes reported as warnings

A dropped main change is normally an error. Two kinds are reported as warnings instead,
because they are usually harmless, and the finding says which one applied:

- **Version bumps:** the change only differs in `x.y.z` version numbers or full commit ids.
- **Generated files:** snapshots, `baselines/` folders, files with `linguist-generated` in
  `.gitattributes`, or a generated-code header such as `@generated` or `DO NOT EDIT`.

Lockfiles, `.github/` and Docker image files stay errors. If every line of a dropped change
appears elsewhere in the merge, the finding notes it may have been moved, but it stays an
error, because the merge author wrote those lines. A dropped version bump can still be a
security fix, so to raise these to errors on paths you care about, add a `severity` entry:

```yaml
intact:
  severity: { "eng/Versions.props": error }
```

### Shared org config: `extends:` (Pro)

Put one policy in a repository the whole org can read and build on it everywhere:

```yaml
# .mainfast.yml in each repository
extends: acme/.github:mainfast/base.yml@main   # or acme/policies, or ./config/mainfast.yml
intact:
  ignore: ["gen/"]                             # added to the shared ignores
```

Lists add up, mappings merge with the local keys first (local `severity` patterns win),
scalars from the local file win; one level only. Another repository is read through the
contents API at the given ref (default: its default branch) with the `config-token` input
(default: `token`; `GITHUB_TOKEN` cannot read other private repositories). A `./path` is read
at the same commit as `.mainfast.yml`. `extends` is a Pro feature: it works for everyone in
the open-source Action, and the plan notice covers fairness.

### GitHub Action

[`examples/mainfast-intact.yml`](examples/mainfast-intact.yml):

```yaml
on: [pull_request, push]
permissions: { contents: read, checks: write }
jobs:
  intact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with: { fetch-depth: 0 }
      - uses: mainfast/intact@v0
        # with:
        #   license: ${{ secrets.MAINFAST_LICENSE }}   # Pro, private repos over 5 active contributors
```

- `pull_request`: checks merge commits in `base.sha..head.sha`.
- `push`: checks `before..after`; a new branch checks `<main>..after`.
- Needs only `GITHUB_TOKEN`. With `checks: write` it posts a check run with
  annotations; without it (fork PRs) it writes the job summary and
  workflow-command annotations instead.
- **Report-only by default.** Findings appear as annotations and a neutral check run, and
  the job passes. Many flagged merges are harmless (code rewritten or moved in the same
  file), so read a few before you block on them. `fail-on: error` fails the job on changes
  dropped outright. `fail-on: warning` also fails it on evil merges, partial drops, and
  dropped version bumps and generated files. A merge that could not be analysed fails
  either way, and so does a `fail-on` value Intact doesn't recognise.
- Inputs: `fail-on` (`off` by default), `main-branch`, `config` (a file from the checkout instead of the
  base's `.mainfast.yml`), `config-token` (reads a private `extends:` repository),
  `check-run` (`auto`/`false`), `working-directory`, `license`. Outputs: `status`
  (whether anything reached `fail-on`), `findings` (the count, whatever `fail-on` is),
  `report` (JSON path).
- On a private repository with more than 5 active contributors and no `license`, the job
  summary and the check run get one notice about Pro. The result never changes.
- A shallow checkout is unshallowed automatically; `fetch-depth: 0` is faster.

## How it works

For each two-parent merge commit `M = merge(P1, P2)`:

1. **What did the merge itself change?** Diff the automatic merge against `M`.
   - git >= 2.36: `git show --remerge-diff M` (no objects written)
   - fallback: `git merge-tree --write-tree P1 P2` (git >= 2.38), then `git diff <tree> M`
   - fallback for older git: a temporary worktree and `git merge --no-commit`

   No difference means **clean**. Differences only inside conflict-marker
   regions are a **conflict resolution**. Force a strategy with
   `--strategy` or `MAINFAST_FORCE_STRATEGY`.
2. **Dropped changes.** For each parent, take every hunk of
   `diff(merge-base, parent)` in files the merge changed, and look at the same
   region of `M` (through `diff(parent, M)`). Untouched lines survived. For a
   touched region compare the hunk's *delta tokens* (what it added that was
   not there before, and what it removed) between the parent's and `M`'s
   version of that region, with two lines of context. All added tokens gone,
   or all removed tokens back, is **dropped**; 20% or more is
   **partially dropped**. Tokens rather than lines, so `timeout = 30` surviving
   as `timeout = 30  # per tenant` is fine, but `timeout = 30` back to
   `timeout = 10` is not.
3. **Attribution.** `git blame` on the parent finds the commit in
   `merge-base..parent` that wrote the lines; for pure deletions, a
   newest-first scan of that range for the commit that removed them.
4. **Evil changes.** Blocks of the remerge diff outside conflict regions that
   the drops do not explain: added lines present in neither parent's version of
   the file, removals of lines the automatic merge kept.
5. **Main side.** The parent reachable from the main branch is "main"; when
   `M` is already on main (a PR merge), the first parent is.

Only the merge commit is judged. A later commit on the branch that changes
main's line again is ordinary history and is not flagged.

## Limitations

- **Octopus merges** (3+ parents) are reported as unsupported and skipped.
- **Heuristic, not proof.** Token matching can miss a drop when the same
  tokens appear in the two-line context window, and can flag a resolution that
  rewrote main's change in different words (partially-dropped warnings).
- **Criss-cross merges** measure side changes from the first merge base, while
  git's automatic merge uses a virtual base; expect extra notes there.
- **Semantic conflict fix-ups** (updating a call site main renamed, inside the
  merge commit) are evil merges by definition and are reported as warnings.
- **Lockfiles and generated files** produce one finding per hunk when a
  resolution took one side wholesale. Regenerate, or ignore them (see
  [Lockfiles are checked by default](#lockfiles-are-checked-by-default)).
- **Binary files** are only checked for "reverted to the merge-base blob".
- Rename detection uses git's default similarity (50%); a rename plus a heavy
  rewrite on one side looks like delete + add.
- Paths containing newlines or tabs are not supported.
- The Action needs full history (`fetch-depth: 0`), or it unshallows.

## Development

```bash
npm run all            # typecheck, tests, build (from intact/, or `npm run all` at the suite root)
npm run brand:sync     # at the suite root, after editing ../brand.json
```

Bundles: `dist/index.cjs` (the Action), `dist/cli.cjs` (the CLI), `dist/lib.cjs` (the
library). Shared code (GitHub client, Actions I/O, globs, config loader, plan gate) is in
[`../packages/shared`](../packages/shared).

Tests build real throwaway git repositories in temp dirs (`test/scenarios.test.ts`).
Design note for the hosted App: [`docs/github-app.md`](docs/github-app.md).

## Report a problem

Found a bug or a false positive? [Open an issue](https://github.com/mainfast/mainfast/issues) in the main Mainfast repository. Anyone can, free, with no key. Issues are public, so leave out private code and secrets.
