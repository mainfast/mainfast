# `.mainfast.yml` reference

One file at the repository root configures every Mainfast check. JSON Schema:
[`schema/mainfast.schema.json`](../schema/mainfast.schema.json) (point your editor at it with
`# yaml-language-server: $schema=…`); a full example:
[`schema/example.mainfast.yml`](../schema/example.mainfast.yml). `.mainfast.yaml` is read when
`.mainfast.yml` is absent.

## Rules that hold for every check

- **Sections.** Top level holds `version`, `extends` and one section per check: `intact`,
  `migrations`, `rollcall`, `owners`, `evidence`. A check reads only its own section and ignores
  the others without a warning.
- **Unknown top-level keys are errors** in every check, so a typo like `intakt:` is not silently
  ignored. Intact, Migrations, Rollcall and Owners stop with a config error; Evidence reports it
  on the evidence card, as it does for every policy typo.
- **Unknown keys inside a section** are errors for that check only (Evidence shows a warning on
  the card).
- **Read from the base.** The Actions read the file as committed on the base of the change
  (the pull request's base commit, or main), so a pull request cannot loosen its own check.
  A first `.mainfast.yml` takes effect once it is merged. An explicit `config:` input reads a
  file from the checkout instead. Rollcall has no pull request: it reads the file from the
  default branch through the API. Owners reads it through the API from the PR's base branch
  (pull requests) or the default branch (weekly audit), never from a checkout.
- **`enabled`.** Every section takes `enabled: false`, which turns that check off for the
  repository in the hosted GitHub App. The Actions accept the key and ignore it. A broken file
  is reported by the App as a failing `Mainfast config` check run.
- **Globs** follow gitignore rules everywhere: `**` spans directories, `*` and `?` stay in
  one segment, `{a,b}` alternates, a pattern without `/` matches the basename anywhere,
  a leading `/` anchors to the root, a pattern that names a directory covers everything in it.

## Top level

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | `1` | `1` | File format version. |
| `extends` | string | none | **Pro.** Shared config to build on, see below. |

### `extends` (Pro)

```yaml
extends: acme/.github:mainfast/base.yml@main
```

| Form | Reads |
| --- | --- |
| `owner/repo` | `.mainfast.yml` on that repository's default branch |
| `owner/repo:path/to/file.yml` | that file on the default branch |
| `owner/repo@ref` / `owner/repo:path@ref` | at a branch, tag or sha |
| `./path/to/file.yml` | a file in this repository, at the same commit as `.mainfast.yml` |

How the files merge: lists add up (shared entries first, then this file's, no duplicates);
mappings merge key by key with this file's keys first (so `intact.severity` tries the local
patterns first); single values from this file win. One level only: the shared file may not use
`extends` itself.
Another repository is read through the contents API with the action's `config-token`
(default: `token`); `GITHUB_TOKEN` can read only the current repository, so a private shared
repository needs a token that can read it. The CLI uses `GITHUB_TOKEN` or `GH_TOKEN`.

Applied by **Mainfast Intact**, **Mainfast Rollcall** and **Mainfast Owners**. Migrations and
Evidence accept the key but do not apply it yet.

## `intact:`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `main_branch` | string | `origin/HEAD`, then `main`, `master` | Branch whose changes must survive merges. |
| `use_default_ignores` | boolean | **`false`** | `true` ignores the common lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `composer.lock`, `go.sum`). Lockfiles are checked by default: a dropped lockfile bump can be a lost security fix. |
| `ignore` | list of globs | `[]` | Paths never reported. |
| `severity` | map glob → `error` \| `warning` \| `notice` \| `off` | `{}` | Level by path; first match wins. |

## `migrations:`

Read by **Mainfast Migrations**, from main (the base) for both the pull request check and the
re-check after a push to main.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `frameworks` | `auto` or list of `alembic`, `django`, `prisma`, `rails`, `flyway`, `drizzle` | `auto` | Frameworks to run. |
| `paths` | map framework → directory or list | `{}` | Explicit migration directories; replaces autodetect for that framework. |
| `ignore` | glob or list | `[]` | Migration directories to skip. |
| `outOfOrder` | `error` \| `warning` \| `off`, or a map framework → one of those | Rails `warning`, Flyway `warning`, Alembic / Django / Prisma / Drizzle `error` | Severity of an ordering conflict: a branch migration not newer than main's latest (Prisma, Rails, Flyway) or a Drizzle journal fork. One value applies to every framework; a map sets only the frameworks it names, the rest keep their default. Alembic and Django ledgers have no version order: their forks (`multiple-heads`, `multiple-leaves`) are always errors, so their entries currently change nothing. |
| `label` | string | `mainfast: migrations stale` | Label for open PRs that went stale when main moved. |

```yaml
migrations:
  outOfOrder: { rails: error, prisma: off }   # Rails stricter, Prisma off, the rest default
  # outOfOrder: warning                       # or one value for every framework
```

## `rollcall:`

Read from the default branch through the API (never from a checkout), so a `workflow_dispatch`
run on a feature branch audits with the same policy as the scheduled run. `extends:` is applied.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `branch` | string | default branch | Protected branch to audit. |
| `pulls` | integer 1–100 | `20` | Recently merged PRs to sample. |
| `openPulls` | integer 0–100 | `10` | Open PRs to sample as well (heads with nothing reported yet are skipped). |
| `ignore` | list | `[]` | Required check contexts to leave out. |
| `stoppedAfter` | integer 0–100 | `2` | A check missing on this many of the newest sampled PRs in a row has stopped reporting; `0` turns this off. |
| `failOn` | `error` \| `warning` \| `never` | `error` | When the job and the check run fail. |
| `issueOn` | `error` \| `warning` \| `never` | `error` | When the one tracking issue is opened (and closed again once below it). |

## `owners:`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dormantDays` | integer 0–3650 | `180` | Weekly audit: an owner with no PR review in this many days is dormant; `0` turns this off. Never checked on pull requests. |
| `maxSearches` | integer 1–1000 | `100` | Most search API requests per audit for the dormancy check (GitHub allows 30 a minute). A run that hits the cap says so, and the order rotates weekly so later runs cover the rest. |
| `ignore` | list of globs | `[]` | Paths that need no owner. |
| `skipOwners` | list | `[]` | Owners not to validate, written as in CODEOWNERS (e.g. `@org/bots`). |
| `requireOwners` | boolean | `true` | Fail a PR that touches files the base branch's CODEOWNERS does not own. |
| `expandTeams` | boolean | `false` | Check each team member for dormancy too (needs the `org-token` input). |
| `failOn` | `error` \| `warning` \| `never` | `error` | When the job fails. |

## `evidence:`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `apply_to` | `agents` \| `all` | `agents` | Gate only PRs with an agent signal (other PRs get a success check run, "Not an agent PR"), or every PR. |
| `agents` | `use_defaults`, `authors`, `branch_prefixes`, `labels`, `trailers` (regexes), `emails` | built-in catalog | What counts as an agent PR. |
| `flags` | map flag id → `fail` \| `warn` \| `off` | see [`evidence/README.md`](../evidence/README.md#flags) | Per-flag severity (27 flags; `tests_skipped` is a warning by default). |
| `test_checks` | list | built-in regex | Check names that count as tests (`/re/` = regex). |
| `required_checks`, `ignore_checks` | list | `[]` | Extra required checks; checks to ignore. |
| `coverage` | `files`, `min_changed_lines` (0–100) | `[]`, `80` | Changed-line coverage. |
| `diff` | `max_lines`, `max_files`, `exclude` | `1500`, `60`, `[]` | Diff size limits. |
| `paths` | `workflows`, `codeowners`, `lockfiles`, `tests`, `test_config` | built-in | A list replaces that category's defaults. |
| `secrets` | `allow` (regexes) | `[]` | Known fake values. |
| `warn_conclusion` | `success` \| `neutral` | `success` | Conclusion when only warnings fired. |

## Not configuration

The license key is not in `.mainfast.yml` (the file is committed). Pass it as an action
input from a secret: `license: ${{ secrets.MAINFAST_LICENSE }}`.
