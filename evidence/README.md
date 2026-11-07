# Mainfast Evidence

**Proof, not review**, for pull requests written by coding agents (Claude Code, GitHub Copilot
coding agent, OpenAI Codex, Cursor, Devin, Dawnpatch, Aider, or your own bot).

AI reviewers read the code. Evidence checks the *proof*: did tests actually run on the commit
being merged, did every required check really pass, and did the agent touch the things that decide
whether its own work gets judged (CI workflows, CODEOWNERS, test config, the tests themselves)?

> Licence: MIT; free for public repos and private repos with up to 5 active contributors
> ([Free and Pro](../README.md#free-and-pro)).

## What it posts

One check run named **Mainfast Evidence** per PR head sha (updated in place on re-runs), and one
sticky PR comment that is edited on every push:

```
### Mainfast Evidence: FAIL — 3 failing
head `b7f3c2a` · Claude Code

| Evidence | On this commit |
|---|---|
| Tests ran | passed — ci/circleci: integration: success, test: success |
| Required checks | 1/2 passed — lint: skipped |
| Changed-line coverage | no report |
| Sensitive files / test weakening | workflows (1), 1 skip/focus marker(s) |
| Description claims | "Added tests": backed; "All tests pass": backed |
| Diff size | +20 −3 in 3 file(s) |
| Secret-like strings | none |

#### Failing
- **Required check was skipped or neutral** (`required_check_skipped`) — lint: skipped — …
  - Fix: Make required jobs always run and report, or move the condition inside a step; …
- **CI workflow files changed** (`touched_workflows`) — `.github/workflows/ci.yml` — …
- **Tests skipped** (`skip_added`) — `src/price.test.ts:18` it.skip("formats zero", () => {
```

Line-level flags (skips, secrets, uncovered lines) also become check-run annotations (max 50).

Under each flag the card gives a one-line fix. Try it without GitHub:
`npm run build && node dist/cli.cjs pr --repo octo-org/widgets --pr 42 --fixture examples/fixture-pr.json`.

## Provenance: is this an agent PR?

By default only agent PRs are gated (`apply_to: agents`); every other PR gets a **success**
check run titled "Not an agent PR". `apply_to: all` gates every PR. Any one signal is enough:

| Signal | Examples |
|---|---|
| PR author / commit author login | `claude[bot]`, `Copilot`, `copilot-swe-agent[bot]`, `chatgpt-codex-connector[bot]`, `cursor[bot]`, `devin-ai-integration[bot]`, `dawnpatch[bot]` + `agents.authors` |
| Commit trailers | `Co-Authored-By: Claude …`, `Agent-Logs-Url: …`, `Co-authored-by: Copilot <copilot@github.com>`, `Co-authored-by: Cursor <cursoragent@cursor.com>`, `Made-with: Cursor`, `aider: …` + `agents.trailers` |
| Commit emails | `noreply@anthropic.com`, `cursoragent@cursor.com`, `…+Copilot@users.noreply.github.com` + `agents.emails` |
| Branch prefix | `claude/`, `copilot/`, `codex/`, `cursor/`, `devin/`, `dawnpatch/`, `aider/` + `agents.branch_prefixes` |
| PR labels | `ai-generated`, `agent-pr`, `coding-agent` + `agents.labels` |
| PR body footers | `Generated with [Claude Code]`, `Made with Cursor`, `Link to Devin run: https://…devin.ai/sessions/…`, `chatgpt.com/codex/tasks/…` |
| git-ai notes | `refs/notes/ai`, Git AI Standard v3.0.0 (`schema_version: authorship/3.0.0`): attestation lines per file, `---`, JSON with `prompts`/`sessions` → `agent_id.tool/model`. Human (`h_`) ranges are not counted. Read from the local checkout only (never for fork PRs). |

The card lists every signal and any commits in the PR with no agent signal (human fix-ups).

### Built-in agents: what is verified

Checked on 28 Oct 2026 against public docs and public PRs. A signal that turns out wrong only
misses a detection; no signal can loosen the gate. Add your own with `agents:` in the policy.

| Agent | Verified (source) | Not verified (best guess) |
|---|---|---|
| Claude Code | `claude[bot]` login and `claude/` branch prefix (defaults of `anthropics/claude-code-action`, `action.yml` `bot_name` / `branch_prefix`); `Co-Authored-By: Claude <noreply@anthropic.com>` trailer and `Generated with [Claude Code]` PR footer (Claude Code's default attribution) | — |
| GitHub Copilot coding agent | commits authored by Copilot with the human as co-author and an `Agent-Logs-Url` trailer (GitHub changelog, 2026-03-20); `copilot/` branches and the `copilot-swe-agent` actor (Microsoft Learn, Copilot coding agent module) | the `copilot-swe-agent[bot]` login form; the `<id>+Copilot@users.noreply.github.com` email |
| GitHub Copilot in VS Code | `Co-authored-by: Copilot <copilot@github.com>`, added by VS Code's Git extension (`git.addAICoAuthor`; heise, 2026). Users report it on commits Copilot did not touch: treat it as a weak signal, or turn it off with `use_defaults: false` | — |
| OpenAI Codex | `chatgpt-codex-connector[bot]` is the Codex GitHub app's identity (it posts Codex reviews, e.g. openai/openai-cookbook#2201) | that it authors PRs or commits; the `codex/` branch prefix; a co-author trailer; `chatgpt.com/codex/tasks/` links in the PR body |
| Cursor | `Co-authored-by: Cursor <cursoragent@cursor.com>` on agent commits (Cursor forum, staff reply); "Made with Cursor" attribution on Agent commits and PRs (cursor.com Git docs); `cursor/` branches for background agents (Cursor forum) | `cursor[bot]` as a PR author (it is the Bugbot reviewer's login) |
| Devin | `devin/<timestamp>-<slug>` branches and `Link to Devin run: https://…devin.ai/sessions/…` in the PR body (public Devin PRs, e.g. colinhacks/zod#3893); the "Devin.ai Integration" GitHub app (docs.devin.ai) and its `devin-ai-integration` account opening PRs (public contributor listings) | the bot's noreply email; the exact co-author trailer (docs.devin.ai only says a "Co-authored (Devin + you)" mode exists) |
| Aider | — | `aider:` commit prefix, `Co-authored-by: aider` trailer, `aider/` branches (from memory) |
| Dawnpatch | our own agent (`dawnpatch[bot]`, `dawnpatch/`) | — |

Removed in this pass because nothing public showed them: the logins `claude` (a plain user name),
`codex[bot]`, `cursor-agent[bot]`, and the loose "codex task" body phrase.

## Flags

Every flag below is one line on the card with its fix (`mainfast-evidence flags` prints the list).

| Flag | Default | Fires when | Fix |
|---|---|---|---|
| `tests_not_run_on_head` | fail | no check run / status matching `test_checks` exists **for the head sha**. If tests ran on an earlier push, the card says which commit. Check data for any other sha is ignored. | Run the test workflow on this commit (push again or re-run CI); evidence from an earlier push does not count. |
| `tests_failed` | fail | a test check on head failed, was cancelled, timed out or needs action | Fix the failing tests on this commit, or have the agent fix them, then push. |
| `tests_skipped` | warn | no test check on head failed or is running, but one or more concluded `skipped` (an `if:` or path filter); a skipped *required* check also fires `required_check_skipped` | Make the test job run on this commit (check its `if:` and path filters), or set `tests_skipped: fail` to require it. |
| `tests_empty` | fail | test checks are green but their output says 0 tests / no test files | Point the test job at the real tests (glob, working directory, test discovery) so it runs more than zero. |
| `required_check_missing` | fail | a required check (rulesets, classic protection if readable, `required_checks`) never reported on head | Restore the job name the ruleset requires (or update the ruleset after a rename), and drop path filters on required jobs. |
| `required_check_skipped` | fail | a required check concluded `skipped`, `neutral` or `stale` (GitHub counts those as passing) | Make required jobs always run and report, or move the condition inside a step; GitHub counts skipped as passing. |
| `required_check_failed` | warn | a required check failed (GitHub already blocks on it) | Fix the failing required check; set `required_check_failed: fail` to show it as a failure here too. |
| `coverage_below_threshold` | warn | changed-line coverage < `coverage.min_changed_lines` (lcov or Cobertura). Never raised on fork PRs: their report comes from the fork's own CI, so it is ignored and the card says "not available" | Add tests for the changed lines, or lower `coverage.min_changed_lines`. |
| `coverage_missing` | off | no coverage report was provided (not raised on fork PRs, where coverage is ignored) | Upload lcov or Cobertura from CI and pass it as `coverage-files` (or `coverage.files`). |
| `touched_workflows` | fail | `.github/workflows/**`, `.github/actions/**`, other CI configs | Have a human review the CI change, or move it to its own PR; agents should not edit what judges them. |
| `touched_codeowners` | fail | `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS` | Have a code owner review the CODEOWNERS change in a separate, human-authored PR. |
| `touched_lockfiles` | warn | npm/yarn/pnpm/bun/poetry/uv/pdm/Pipfile/go.sum/Cargo/Gemfile/composer lockfiles | Check the dependency change is intended (`npm ci` / lockfile diff), or set `touched_lockfiles: off`. |
| `touched_tests` | warn | an existing test file lost lines, was renamed or deleted (adding tests is fine) | Check each removed or rewritten test line is intended; keep the old assertions unless the behaviour changed. |
| `touched_test_config` | warn | jest/vitest/playwright/karma/mocha config, `pytest.ini`, `tox.ini`, coverage config | Review the test-config change: coverage thresholds, excluded paths and test globs can switch tests off. |
| `touched_policy` | fail | the PR edits `.mainfast.yml` (the base branch's policy is used regardless) | Change `.mainfast.yml` in a separate, human-reviewed PR; this PR is judged by the base branch's policy anyway. |
| `tests_deleted` | fail | a test file was deleted | Restore the deleted test file, or explain in the PR why the behaviour it covered is gone. |
| `tests_removed` | fail | net test-case count across the diff dropped (moving tests between files nets to 0) | Restore the removed test cases, or replace them with equivalent ones. |
| `assertions_dropped` | fail | net assertion count across test files dropped; tautologies do not count as assertions | Restore the dropped assertions; a test without them passes whatever the code does. |
| `assertions_commented_out` | fail | an added comment line contains an assertion | Uncomment the assertion and fix the code it was catching, or delete it on purpose with a reason. |
| `skip_added` | fail | `.skip`, `xit`, `xdescribe`, `.todo`, `@pytest.mark.skip/skipif/xfail`, `@unittest.skip`, `pytest.skip()`, `self.skipTest()`, `t.Skip()` | Remove the skip marker and fix the test, or open an issue and link it next to the skip. |
| `focus_added` | fail | `.only`, `fit`, `fdescribe` (silently stops every other test in the file) | Remove `.only` / `fit` / `fdescribe`; they stop every other test in the file. |
| `trivial_assertion_added` | warn | `expect(true).toBe(true)`, `assert True`, `assert x == x`, `assert.True(t, true)` | Replace the always-true assertion with one that checks the code's result. |
| `claim_tests_added_unbacked` | fail | the PR text says tests were added; no new test case is in the diff | Add the tests the description promises, or correct the description. |
| `claim_tests_pass_unbacked` | fail | the PR text says tests pass / CI is green; test checks on head did not pass | Wait for the test checks on this commit to pass, or correct the description. |
| `diff_too_large` | warn | changed lines or files above `diff.max_lines` / `diff.max_files` (lockfiles and `diff.exclude` not counted) | Split the PR, or raise `diff.max_lines` / `diff.max_files` (generated files can go in `diff.exclude`). |
| `secret_like_string` | fail | AWS keys, GitHub/Anthropic/OpenAI/Slack/Stripe/Google/npm tokens, private keys, JWTs, high-entropy hard-coded credentials, in added lines only. Values are redacted in output. | Remove the value and rotate it if it is real; add a known fake to `secrets.allow` (anchored, `^…$`). |
| `diff_unanalyzed` | warn | GitHub returned no patch for a text file (too large); use a full checkout | Run the Action in a full checkout (`fetch-depth: 0`) so the diff is computed locally, not from truncated API patches. |

Test-weakening rules cover JavaScript/TypeScript (jest, vitest, mocha, ava, node:test), Python
(pytest, unittest) and Go (`testing`, testify).

Conclusion: any `fail` flag → **failure**; otherwise checks still running → **in progress**;
otherwise warnings → `warn_conclusion` (success by default). Non-agent PRs (with `apply_to:
agents`) → **success**, "Not an agent PR".

Required checks are read and classified by the suite's shared logic
(`@mainfast/shared/required-checks`, the same Mainfast Rollcall audits with): active rulesets
(`GET /rules/branches/{branch}`), classic protection from "Get a branch" (contents: read; the
admin-only endpoint only as a fallback, and a refusal there is a card note, not an error), latest
run per name on the head sha, worst of check run + status, and app pins (a required check pinned to
an app is not satisfied by a run another app posted under that name).

## Policy: `.mainfast.yml`

Evidence reads only the `evidence:` section, **from the PR's base commit** (a PR cannot loosen its
own gate). Unknown keys and bad values are reported on the card, never silently ignored. Full
example: [`examples/mainfast.yml`](examples/mainfast.yml).

```yaml
evidence:
  apply_to: agents            # or all
  agents:
    authors: [release-robot]
    branch_prefixes: [ai/]
    labels: [ai-generated]
    trailers: ["^Agent-Session: "]
  test_checks: ["test", "/integration/"]
  required_checks: [test]
  coverage: { files: [coverage/lcov.info], min_changed_lines: 80 }
  diff: { max_lines: 1500, max_files: 60 }
  secrets: { allow: ["^AKIAIOSFODNN7EXAMPLE$"] }
  flags:
    touched_lockfiles: off
    required_check_failed: fail
```

`secrets.allow` patterns are matched against the **secret value** a rule extracted, never against
the rest of the line, so a marker such as `// example` next to a real key does not hide it. Anchor
them (`^…$`) to allow exactly one known fake value.

## GitHub Action

Full workflow: [`examples/workflows/evidence.yml`](examples/workflows/evidence.yml). Two jobs:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review]
  workflow_run:
    workflows: [CI]
    types: [completed]
permissions: {}
jobs:
  pr:   # same-repository PRs, every push
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    permissions: { contents: read, checks: write, pull-requests: write, statuses: read }
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with: { fetch-depth: 0, ref: "${{ github.event.pull_request.head.sha }}" }
      - uses: mainfast/evidence@v0
        with: { wait-for-checks: "600" }
  ci:   # after CI finishes; also the only job that sees fork PRs. No checkout.
    if: github.event_name == 'workflow_run'
    permissions: { contents: read, checks: write, pull-requests: write, statuses: read, actions: read }
    steps:
      - uses: mainfast/evidence@v0
        with: { local-diff: "false" }
```

### Permissions

| Permission | Job | Why |
|---|---|---|
| `contents: read` | both | PR files and commits, `.mainfast.yml` at the base commit, "Get a branch" (classic required checks), rulesets for the branch |
| `checks: write` | both | create / update the `Mainfast Evidence` check run on the head sha; read other check runs |
| `pull-requests: write` | both | the sticky comment (issue-comment endpoints on a PR); find a fork PR by head sha (`GET /commits/{sha}/pulls`, `GET /pulls`) |
| `actions: read` | `ci` | only to download the coverage artifact from the CI run |
| `statuses: read` | both | commit statuses (for example `ci/circleci: …`) count as checks; without it the card notes that statuses were unreadable, and a status-only test or required check reads as missing |
| `administration` | never | not needed; GITHUB_TOKEN cannot have it. Classic protection is read from "Get a branch" |

### `workflow_run`, forks and what runs where

- `pull_request` runs the workflow file **from the PR** with an ordinary token. For a fork PR that
  token is read-only, so Evidence could not post; the example skips forks in the `pr` job.
- `workflow_run` runs the workflow file **from the default branch**, with the base repository's
  token (write, per `permissions:`) and its secrets, even when the run that triggered it came from
  a fork. An agent that edits the Evidence workflow in its PR cannot switch this copy off (and
  `touched_workflows` flags the edit). Because this job holds a write token:
  - the example never checks out PR code in it (no `actions/checkout` at all) and has no `run:`
    step; the diff comes from the API (`local-diff: "false"`);
  - the Action runs no code from the PR in any job: it reads the API, parses text, and in the `pr`
    job runs `git` on the checked-out objects (diff, notes) — never a script, hook, build or test;
  - the policy is `.mainfast.yml` **at the PR's base commit**, read through the API; the fork's
    (or branch's) own `.mainfast.yml` is never read, on any trigger;
  - nothing in the workflow passes a secret to PR content; the Action's only secret is the token,
    used for API calls. Add no secret-using steps to this job;
  - event text (branch names, PR titles, commit messages) is attacker-chosen for a fork: never
    interpolate `${{ github.event.workflow_run.head_branch }}` and friends into a `run:` step;
  - the coverage artifact is data the PR's CI run produced (a fork can write anything into it). For
    a **same-repo** PR it is parsed as lcov / Cobertura and never executed. For a **fork** PR it is
    ignored: coverage shows as "not available on fork PRs (artifact comes from the fork's own CI)"
    on the card, with no `coverage_below_threshold` or `coverage_missing` flag either way (the CLI
    `pr` command does the same for a fork PR).
- `workflow_run.pull_requests` is empty for fork PRs (observed GitHub behaviour; the docs do not
  say it). Evidence then looks the PR up by the run's head sha: `GET /commits/{sha}/pulls`, then
  open PRs filtered by `head=<fork owner>:<branch>`, then up to 300 open PRs. A candidate counts
  only if GitHub's PR record is open, its head sha equals the run's head sha and its base
  repository is this repository. If a listed PR has moved on to a newer commit, the run is
  skipped with a notice (the run for the new head evaluates it).
- A first-time contributor's fork CI may wait for approval; until it runs, no `workflow_run`
  fires and the fork PR has no card (a required `Mainfast Evidence` check keeps it blocked).
- With a full checkout (`fetch-depth: 0`, `pr` job) the diff is computed locally (no truncated
  patches) and git-ai notes are fetched from `refs/notes/ai`. Fork PRs never use the checkout.
- If the token cannot post, the job fails instead (`fail-job: auto`) and the card goes to the job
  summary.
- The sticky comment is the one that starts with the marker **and** was written by the token's own
  identity (`GET /user` for a user token, otherwise `github-actions[bot]`; set `comment-author:
  my-app[bot]` for a GitHub App token). A marker pasted into someone else's comment is ignored.
- Everything on the card that the PR or another app controls (file paths and lines, check names,
  description quotes, branch names, commit messages) is escaped: HTML-encoded, Markdown
  metacharacters backslash-escaped or put in code spans, `@mentions` neutralised, one line per
  item, length-capped.

Inputs and outputs: see [`action.yml`](action.yml).

## CLI

```
mainfast-evidence local --base main [--head HEAD] [--body-file pr.md] [--coverage lcov.info] [--format text|markdown] [--json]
mainfast-evidence pr --repo owner/name --pr 42 [--token …] [--post [--comment-author me]] [--fixture routes.json] [--format …] [--json]
mainfast-evidence flags
```

Output is plain text in a terminal (no Markdown escapes) and the Markdown card when piped;
`--format` picks one.

`local` works from git alone (diff, test weakening, claims, secrets, provenance, git-ai notes);
check-based evidence is reported as not evaluated. Exit codes: 0 pass/warn, 1 fail, 2 usage, 3 pending.

## Library

```ts
import { parsePolicy, collectSnapshot, evaluate, renderCard, RestClient } from "@mainfast/evidence";
```

Every analyser is pure over a `PrSnapshot` (`src/types.ts`); `collectSnapshot` builds one from the
REST API and `localSnapshot` from git; `renderCard` / `renderText` render a report. No `.d.ts` is
shipped yet (`dist/lib.cjs` bundles the private `@mainfast/shared`, which a per-file declaration
emit would reference).

## Development

```
npm install
npm run typecheck && npm test && npm run build   # or: npm run all
```

`dist/` is committed for the Action (`dist/index.cjs` = the Action, `dist/cli.cjs`, `dist/lib.cjs`). Tests
use recorded REST payloads (`test/fixtures/github/`, shaped per the 2022-11-28 REST docs) served
through `mockFetch`; no test calls GitHub (`test/setup.ts` replaces the global `fetch` with one
that throws). Diff analysis tests build real temporary git repos.

## Report a problem

Found a bug or a false positive? [Open an issue](https://github.com/mainfast/mainfast/issues) in the main Mainfast repository. Anyone can, free, with no key. Issues are public, so leave out private code and secrets.
