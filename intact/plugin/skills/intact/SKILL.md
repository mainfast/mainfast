---
name: intact
description: Before pushing a branch that contains merge commits (for example after merging origin/main into a feature branch or worktree), run the Mainfast Intact check to prove the merge did not silently drop changes from main or slip in unrelated edits. Use when about to push, after resolving merge conflicts, or when asked whether a merge reverted something.
---

# Check merges before push

A merge with no conflicts is not proof that main survived. A conflict
resolved by "taking ours", or an edit slipped into the merge commit, never
shows up in a pull request diff. `mainfast check` re-runs the automatic merge
for every merge commit on the branch and reports what each merge commit itself
changed.

## Run it

From the repository (or worktree) you are about to push:

```bash
MF="$(command -v mainfast || echo "${CLAUDE_PLUGIN_ROOT}/scripts/mainfast.cjs")"
git fetch origin --quiet
"$MF" check                 # every merge in <main>..HEAD
"$MF" check HEAD            # just the merge you made
"$MF" check --json          # for parsing
```

`CLAUDE_PLUGIN_ROOT` is this plugin's directory; the bundled CLI needs Node 20+.
Exit code 0 = intact, 1 = findings, 2 = could not analyse.

## Read the result

| Finding | Meaning | What to do |
| --- | --- | --- |
| `dropped (main)` | A hunk main added since the merge base is gone from the merge | Read the named main commit (`git show <sha>`), restore its change in a follow-up commit, re-run |
| `partially-dropped (main)` | Some of main's tokens survived, some did not | Same; often a hand-merged conflict that lost a line |
| `dropped (branch)` notice | The resolution took main's side over the branch's own change | Confirm it was intended |
| `evil` | The merge commit contains lines neither parent had, outside any conflict | Move the edit into its own commit unless it is a needed fix-up (renamed call site) |

Many `dropped (main)` hunks in one file means the resolution took the branch's
whole file (`git checkout --ours`). Redo that file's resolution from main's
version instead.

## Rules

- Do not push when the check exits 1 unless the user has read the findings and
  says the drop is intended.
- Fix forward with a new commit; do not rewrite a merge the remote already has.
- Lockfiles and generated files: regenerate rather than hand-merge, and list
  them under `intact.ignore` in `.mainfast.yml` (or set `intact.use_default_ignores: true`)
  only if regeneration is enforced elsewhere. Lockfiles are checked by default.
- Report the merge commit, each finding (file:line, main commit, subject), and
  what you did about it.
