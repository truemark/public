---
name: pr-open
description: Take the current working tree from changes to an open draft PR — fresh branch, commit, push, and create in one step, ending with the PR URL
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
disable-model-invocation: true
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-open
  version: 2026.09.20.1811
---

Take whatever is in the working tree and turn it into an open draft pull request: move the work onto a fresh branch cut from an up-to-date `origin/main`, commit it, push, and open the PR. This is `branch-clean` + `commit` + `pr-create` run back to back.

This skill composes the existing single-step skills rather than reimplementing them. Read each referenced `SKILL.md` and follow its steps as written; if one contradicts this file, the referenced skill wins for its own step.

**Carry every uncommitted change through.** As with `branch-clean` and `commit`, invoking this skill is an instruction to ship the working tree exactly as it stands. Do not filter, exclude, revert, or stash any change because it looks unrelated or unintended. Flag anything surprising in the final report and let the author decide.

**Always hand back the PR link.** Every exit from this skill that has a PR — the one it opens, or the open one it finds in step 2 — ends with that PR's URL, written as a bare `https://github.com/...` URL on its own line so the terminal makes it clickable. Never substitute a PR number, a branch name, or a markdown label for the URL; the author's next move is to open the page. The exits with no PR are step 3 and a **failed** lookup in step 1; each says so in as many words and names the current branch instead, so a missing link is never mistaken for an oversight — and a failed lookup reports the failed command rather than asserting that no PR exists. The same applies when a phase fails partway: report which phase failed, and give the PR URL if one was created before the failure or the branch name if none was.

## Steps

1. Determine where things stand:
   ```sh
   git rev-parse --abbrev-ref HEAD
   git status --porcelain
   gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json number,url -q '.[0].url // empty'
   ```
   Only a **successful** empty result means the branch has no open PR. Use `gh pr list` rather than `gh pr view` for this: `view` exits non-zero both for "no PR" and for a failed call, so its exit code cannot answer the question, while `list` exits 0 either way and non-zero only on a real failure (**GEN-015**). If the call exits non-zero, the check failed — stop and report which command failed and why, and do **not** read the empty output as "no PR"; an outage would otherwise send the run down the open-a-PR path on a branch that already has one.

2. If the current branch already has an **open** PR, stop and report its URL on its own line. This skill opens PRs; it does not update them. Point the user at `/commit-push` to add commits, or `/pr-review-loop` to work the review.

3. If the tree is clean **and** the branch has no commits ahead of `origin/main`, stop — there is nothing to open a PR for. Say explicitly that no PR exists yet and name the current branch, since this is one of only two exits with no link to give — the other is a **failed** lookup, which reports the failed command instead of asserting that no PR exists.

4. **Branch phase.** The goal is that the work sits on a feature branch based on an up-to-date `origin/main`. Check whether that is already true before doing anything, with a test that answers the question rather than printing values for you to eyeball:
   ```sh
   git fetch origin main
   branch=$(git rev-parse --abbrev-ref HEAD)
   ahead=$(git rev-list --count origin/main..HEAD)
   if [ "$branch" != "main" ] && [ "$ahead" -eq 0 ]; then
     echo "branch phase already satisfied"
   else
     echo "branch phase needed (branch=$branch ahead=$ahead)"
   fi
   ```
   Both conditions must hold: the current branch is **not** `main`, and it has **no commits ahead** of `origin/main`. When they do, the branch phase is satisfied — skip it and say so in the report. This is the common case when `branch-clean` was just run by hand; re-cutting would stash, derive the same name, and pop again for no gain, with a needless conflict risk.

   `git rev-list --count origin/main..HEAD` is the check to use rather than comparing two `rev-parse` outputs by eye. It states the actual condition — commits ahead — and returns a number a script can branch on.

   Otherwise follow `.claude/skills/branch-clean/SKILL.md` to move the work onto a fresh branch off the updated `origin/main`. That covers both starting from `main` and re-cutting a stale feature branch, and it is what keeps the PR's diff clean against current `main`.

   Derive the branch name from the changes as that skill describes. Because there is always work in flight here, do not ask the user what they are about to work on — inspect the stash and name the branch from what actually changed.

5. **Commit phase.** Follow `.claude/skills/commit/SKILL.md` to stage everything and commit with a descriptive message.

6. **PR phase.** Follow `.claude/skills/pr-create/SKILL.md` to push and open the draft PR. Remember that this repo squash-merges, so the PR title and body become the commit on `main` — write them as the commit message for the whole change, summarizing every commit ahead of `main`.

7. Report the result in one block: the new branch name, what happened to the old branch (deleted, or kept because it had unmerged commits), the commit sha and subject, and the PR URL. Note that the PR is a draft. Call out any change that looked surprising but was committed anyway.

   Note that the user can run `/pr-review-loop` to work the review cycle to completion, and then finish with the PR URL as a bare URL on its own line — the reminder comes **before** the link, so the very last line of the run is the clickable URL. The link is the last thing the author needs from this run, so it goes where it is impossible to miss rather than buried mid-paragraph.
