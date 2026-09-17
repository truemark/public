---
name: pr-open
description: Take the current working tree from changes to an open draft PR — fresh branch, commit, push, and create in one step
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
disable-model-invocation: true
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-open
  version: 2026.07.24.2236
---

Take whatever is in the working tree and turn it into an open draft pull request: move the work onto a fresh branch cut from an up-to-date `origin/main`, commit it, push, and open the PR. This is `branch-clean` + `commit` + `pr-create` run back to back.

This skill composes the existing single-step skills rather than reimplementing them. Read each referenced `SKILL.md` and follow its steps as written; if one contradicts this file, the referenced skill wins for its own step.

**Carry every uncommitted change through.** As with `branch-clean` and `commit`, invoking this skill is an instruction to ship the working tree exactly as it stands. Do not filter, exclude, revert, or stash any change because it looks unrelated or unintended. Flag anything surprising in the final report and let the author decide.

## Steps

1. Determine where things stand:
   ```sh
   git rev-parse --abbrev-ref HEAD
   git status --porcelain
   gh pr view --json number,url,state -q '"\(.state)\t\(.url)"'   # non-zero exit means no PR
   ```

2. If the current branch already has an **open** PR, stop and report its URL. This skill opens PRs; it does not update them. Point the user at `/commit-push` to add commits, or `/pr-review-loop` to work the review.

3. If the tree is clean **and** the branch has no commits ahead of `origin/main`, stop — there is nothing to open a PR for.

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

   Finish by telling the user they can run `/pr-review-loop` to work the review cycle to completion.
