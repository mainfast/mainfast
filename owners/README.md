# Mainfast Owners

Finds CODEOWNERS drift. On a pull request it lists the changed files that no
working code owner covers, and checks the PR's own CODEOWNERS edit before it is
merged, all in one PR comment. Once a week it audits the whole CODEOWNERS file
against the repository and the GitHub API, including owners who have gone dormant.

Part of the [Mainfast suite](../README.md). MIT-licensed and free for public repositories and for
private ones with up to 5 active contributors; see [Free and Pro](../README.md#free-and-pro).

## Quick start

Add this as `.github/workflows/mainfast-owners.yml`. No checkout step is needed:

```yaml
name: Code owners
on:
  pull_request:
  schedule: [{ cron: "23 6 * * 1" }]   # weekly audit
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: write
jobs:
  owners:
    runs-on: ubuntu-latest
    steps:
      - uses: mainfast/owners@v0
        with:
          org-token: ${{ secrets.MAINFAST_OWNERS_ORG_TOKEN }}   # optional, see "Creating the org-token"
```

Without the `org-token` secret, org membership and team checks are skipped with one note and
everything else still runs. Full examples and every input: [GitHub Action](#github-action).

## PR mode and audit mode

| | Pull request (`pull_request`, `pull_request_target`) | Weekly audit (`schedule`, `workflow_dispatch`) |
|---|---|---|
| CODEOWNERS judged | the **base branch's** file, the one GitHub uses to request reviews | the default branch's file (or `ref:`) |
| Files checked | the PR's changed files | every tracked file |
| Owners looked up | only those deciding a changed file | all of them |
| PR edits CODEOWNERS | the PR's version is **checked separately** (in its own section): syntax GitHub ignores, unknown owners, patterns matching nothing, shadowed lines, GitHub's own errors at the head commit | — |
| Dormant owners | **never** (to save the search API rate limit) | **on**, 180 days by default (`owners.dormantDays`, `0` off) |
| `.mainfast.yml` | from the base branch | from the default branch |
| Output | job summary, annotations, one sticky PR comment | job summary, annotations, outputs; fails at `fail-on` |

Everything is read **through the API at those refs, never from a checkout**, so
no `actions/checkout` step is needed and a PR cannot loosen its own check: a
PR's own `.mainfast.yml` or CODEOWNERS never decides its result.

**Judged with the base.** A PR that adds `tools/` and a CODEOWNERS line for it
still shows `tools/` as unowned: until the line is merged GitHub requests no
review for it. The comment marks such paths "this PR's CODEOWNERS owns it once
merged" and leaves them out of the suggested lines. Exception: a PR that adds
the *first* CODEOWNERS file gets a warning, not an error. In the PR's own
section, a problem already present on the base branch (same line, or same
owner) is shown as "already on the base branch" and is never an error, so a PR
that fixes one line is not blocked by an old one.

**Fork PRs and outside authors.** The author of a PR can read its comment, job
summary and annotations, and could put any `@user` or `@org/team` into
CODEOWNERS to find out what exists in the org. So unless the PR comes from the same repository
**and** its author is an `OWNER`, `MEMBER` or `COLLABORATOR`, owners are checked
for **public account existence only** (`GET /users/{u}`), GitHub's CODEOWNERS
errors are not fetched (they name teams that do not resolve), and one note says
so. The `org-token` is never used for such PRs, and neither is collaborator
permission. The weekly audit checks everything in full.

## Findings

Every finding in the comment and summary carries its fix.

| Code | Severity | Meaning | Fix |
|---|---|---|---|
| `unowned-files` | error on PRs (with `requireOwners`), warning in audits | Files whose deciding line has no owner, or only owners that cannot review. The audit groups them by directory. | Add a CODEOWNERS line for the paths (the comment suggests them), or list them under `owners.ignore`. |
| `unknown-user` | error | `@user` does not exist (deleted or renamed). | Put the current login or a team in its place. |
| `owner-left-org` | error | Not in the org any more and no write access (needs `org-token`; without it this shows as `owner-no-write`). | Remove the owner or replace them with a current member or team. |
| `owner-no-write` | error | Has read/triage access or none; code owners need write. | Give write access (directly or via a team), or replace them. |
| `team-not-found` | error | `@org/team` does not exist (needs `org-token`). | Fix the slug as in the team URL, or create the team. |
| `team-no-write` | error | Team has no or read-only access to this repo (needs `org-token`). | Give the team Write (Settings → Collaborators and teams). |
| `team-wrong-org` | error | Team of another org, or a team on a user-owned repo. | Use a team of the org that owns the repository. |
| `rule-without-valid-owner` | error | A line whose owners are all invalid, so its paths are unowned. | Add one owner with write access, or delete the line on purpose. |
| `github-error` | error | What GitHub itself rejects: `GET /repos/{o}/{r}/codeowners/errors?ref=`. | Fix the line as GitHub suggests (shown in the finding). |
| `invalid-line` | error | Syntax GitHub skips: `!` negation, `[ ]` ranges, GitLab `[Section]` headers, malformed owners. | Rewrite without `!`, `[ ]`, `[Section]`; owners are @user, @org/team or email. |
| `too-large` | error | File over 3 MB; GitHub ignores it. | Shrink it with broader patterns. |
| `no-codeowners` | error on PRs, else warning | No `.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`; on a PR also "this PR removes it". | Add `.github/CODEOWNERS` with a catch-all such as `* @org/maintainers`. |
| `pattern-matches-nothing` | warning | Line matches no tracked file (moved or deleted). | Update the pattern or delete the line. |
| `shadowed-rule` | warning | Line never decides a file: later lines claim everything it matches (last match wins). | Move the broad line above the specific ones, or delete it. |
| `dormant-owner` / `dormant-team` | warning, audit only | No PR review in this repo in `dormantDays` (default 180). Teams with `expandTeams` and `org-token`. | Confirm they still own the code, or hand it to an active owner. |
| `email-owner` | warning | Email owners cannot be verified through the API. | Use the @login. |

Patterns follow GitHub's rules: gitignore-style, the last matching line wins, a
line with no owners makes its paths unowned, `docs/*` does not reach into
subdirectories, `\#` escapes a leading hash, `\ ` a space. The tests encode the
examples from GitHub's CODEOWNERS docs.

## GitHub Action

Full examples: [`examples/owners.yml`](examples/owners.yml) (PR + weekly audit,
fine-grained token) and [`examples/owners-app-token.yml`](examples/owners-app-token.yml)
(the org-token from a GitHub App, `actions/create-github-app-token` pinned to
its v3.3.0 SHA). If you add a checkout step for something else, pin it:
`actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0`.

Because Owners never fetches or runs PR code, `pull_request_target` is safe too
(it gives fork PRs a token that can comment). Do not add a checkout of the PR
head to such a job.

Inputs: `mode` (auto/pr/audit), `token`, `org-token`, `config` (workspace file
instead of the API), `ref` (audit), `comment`, `comment-author`, `dormant-days`
(audit), `fail-on`, `license`. Outputs: `ok`, `unowned` (one path per line),
`report` (JSON).

### Permissions

| Permission | Used for | Without it |
|---|---|---|
| `contents: read` | CODEOWNERS and `.mainfast.yml` at the base/default branch and the PR head, git tree, GitHub's CODEOWNERS errors | the run stops (nothing to judge) |
| `pull-requests: write` | the PR's changed files (read) and the one sticky comment | read only: no comment, a warning annotation, the result stands; none: PR mode stops |
| *(metadata: read, always granted)* | `GET /users/{u}`, collaborator permission | — |
| search (any token) | dormancy, audit only, at most `maxSearches` requests | — |
| **`org-token`** with Organization → Members: read | org membership (`owner-left-org`), team existence and access, team-member dormancy | skipped with **one note** ("needs a token with Organization → Members: read"); teams count as valid, users are still checked for existence and write access |

`GITHUB_TOKEN` cannot have any organization permission, so it can never see
private org membership or teams. Owners does not guess (no per-owner "missing"
findings); it says once what it did not check.

### Creating the org-token

Either works; store the result as a secret (`MAINFAST_OWNERS_ORG_TOKEN`).

- **Fine-grained personal access token** (github.com → Settings → Developer
  settings → Fine-grained tokens → Generate): *Resource owner* = the
  organization; *Repository access* = the repositories Owners runs in;
  *Repository permissions* → Metadata: Read-only (set automatically);
  *Organization permissions* → **Members: Read-only**. Nothing else. The org may
  need to approve it (Settings → Personal access tokens). It expires and is tied
  to the person who made it.
- **GitHub App** (org Settings → Developer settings → GitHub Apps → New): no
  webhook; Repository permissions → Metadata: Read-only; Organization
  permissions → **Members: Read-only**. Install it on the org for the same
  repositories, save its client ID as a variable and its private key as a
  secret, and mint a token per run with `actions/create-github-app-token`
  ([example](examples/owners-app-token.yml)). Does not expire with a person.

Owners probes the token once (`GET /orgs/{org}/teams?per_page=1`); if GitHub
refuses it the note says so with the status, and the org checks are skipped.

### Dormancy and the search rate limit

The search API allows 30 requests a minute. The audit makes one request per
valid user owner (per team member with `expandTeams`, stopping at the first
member with a review), at most `owners.maxSearches` (default 100) per run. When
a response says the quota is spent, the next request waits for the reset (at
most 65 s; longer and the rest are skipped); a rate-limit 403/429 is retried
twice with 15 s / 30 s backoff. A capped run says how many owners it covered;
the order rotates weekly, so the next runs cover the rest.

### The PR comment

Owners keeps one comment per PR, found again by its marker **and** its author: only a comment that
starts with the marker and was written by the token's own identity
(`comment-author` input, else `GET /user`, else `github-actions[bot]`) is ever
edited, so a marker pasted into someone else's comment is ignored. Set
`comment-author` for an app token (`my-app[bot]`). Clean PRs get no comment; an
earlier comment is edited to "Resolved". Unchanged results leave it untouched.

### Untrusted text

File paths, CODEOWNERS patterns and lines, owners, team slugs, branch names and
GitHub's own error text are escaped (`@mainfast/shared/markdown`) in the
comment, the job summary and the suggested lines: no HTML, no links, no `@`
mentions (paths and owners are code spans), nothing that breaks out of a table,
no fake marker. Annotations are plain text. Tests use hostile
file names (`<!--`, the marker, `|`, backticks, `<img>`, links, newlines) and
hostile owners and GitHub errors.

## Configuration

`.mainfast.yml`, section `owners:` ([reference](../docs/config.md#owners),
[example](.mainfast.example.yml)): `dormantDays` (180; audit only), `maxSearches`
(100), `ignore` (globs that need no owner), `skipOwners`, `requireOwners`,
`expandTeams`, `failOn`. `extends:` is applied. Read from the base branch (PR) or
the default branch (audit) through the API; `config:` reads a workspace file
instead.

## Run it locally

```sh
npx mainfast audit owners             # full audit through the API with a GitHub origin and GITHUB_TOKEN or GH_TOKEN
npx mainfast audit owners --offline   # lint CODEOWNERS offline, no token
```

Without a token or a GitHub origin remote it lints offline. It only reads and posts nothing.

## REST endpoints (API version 2022-11-28)

| What | Endpoint |
|---|---|
| CODEOWNERS / config | `GET /repos/{o}/{r}/contents/{path}?ref=` (over 1 MB: `GET .../git/blobs/{sha}`) |
| Tree | `GET /repos/{o}/{r}/git/trees/{ref}?recursive=1` |
| PR files | `GET /repos/{o}/{r}/pulls/{n}/files` (GitHub caps at 3000) |
| GitHub's errors | `GET /repos/{o}/{r}/codeowners/errors?ref=` |
| Users | `GET /users/{u}`, `GET /repos/{o}/{r}/collaborators/{u}/permission` (`role_name`) |
| Org (org-token) | `GET /orgs/{org}/teams?per_page=1` (probe), `GET /orgs/{org}/members/{u}`, `GET /orgs/{org}/teams/{slug}`, `GET /orgs/{org}/teams/{slug}/repos/{o}/{r}` (`application/vnd.github.v3.repository+json`), `GET /orgs/{org}/teams/{slug}/members` |
| Dormancy | `GET /search/issues?q=repo:o/r type:pr reviewed-by:u updated:>=date` (`total_count` only) |
| Comment | `GET/POST /repos/{o}/{r}/issues/{n}/comments`, `PATCH .../issues/comments/{id}`, `GET /user` |

## Development

```sh
npm run all        # at the suite root: brand check, typecheck, every test, build
npm test -w @mainfast/owners
```

The package's own CLI, from your build (run in `owners/`):

```sh
node dist/cli.cjs lint --repo .                                     # offline, no token
GITHUB_TOKEN=... node dist/cli.cjs audit --github-repo owner/name [--ref main]
GITHUB_TOKEN=... node dist/cli.cjs pr --github-repo owner/name --pr 42 [--comment]
```

`audit` and `pr` read everything through the API like the Action. Org checks use
`--org-token`, else the token itself (a personal token of an org member usually
can). Exit 1 on an error-level finding.

`test/fixtures/api.ts` is a fake org (`acme`) with one user or team per
finding; `test/fixtures/CODEOWNERS` plants each file-level problem. Requests go
through the shared `mockFetch`; `test/setup.ts` replaces the global `fetch` with
one that throws, so no test reaches the network.

## Limits

- A renamed file is judged by its new path only.
- Dormancy counts PRs the user reviewed that were updated in the window, per
  GitHub search; review comments without a review do not count.
- The comment lists the first 50 unowned paths and 100 findings per table; the
  `report` output has all.
- A truncated tree listing (very large repositories) skips dead and shadowed
  patterns, with a note.

## Report a problem

Found a bug or a false positive? [Open an issue](https://github.com/mainfast/mainfast/issues) in the main Mainfast repository. You don't need a key or a paid plan. Issues are public, so leave out private code and secrets.
