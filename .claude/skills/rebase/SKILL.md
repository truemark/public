---
name: rebase
description: Fetch and rebase the current branch onto origin/main, resolving any conflicts, then force-push with lease
allowed-tools: Bash(git:*), Read, Edit
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/rebase
  version: 2026.07.15.1923
---

Bring the current branch up to date with the latest `main` by rebasing it onto `origin/main`, resolving any conflicts, and force-pushing the result with `--force-with-lease`. A rebase (rather than a merge) keeps history linear, plays nicely with `pull.rebase = true`, and leaves `main`'s tip as a true ancestor of the branch so GitHub's "out of date" check passes. Requires a clean working tree — it refuses to run if there are uncommitted changes, so nothing local is ever clobbered.

## Steps

1. Refuse to run with a dirty working tree. Inspect it first:
   ```sh
   git status --porcelain
   ```
   If there is **any** output (modified, staged, deleted, or untracked files), stop and tell the user to commit or stash their changes first. Do not stash, commit, or discard anything yourself.

2. Note the current branch:
   ```sh
   git rev-parse --abbrev-ref HEAD     # current branch
   ```
   If it is `main`, stop and report that there is nothing to rebase — `main` is the branch being rebased onto.

3. Fetch the latest `main` from the remote:
   ```sh
   git fetch origin main
   ```
   If `git log --oneline HEAD..origin/main` is empty, the branch already contains the latest `main` — report that there is nothing to rebase and stop.

4. Rebase the branch onto the freshly fetched `main`:
   ```sh
   git rebase origin/main
   ```
   Prior "merge main into branch" commits (e.g. from GitHub's *Update branch* button) are flattened away by the rebase — that is expected and desirable.
   - If the rebase completes cleanly, continue to step 6.
   - If git stops on a conflict, continue to step 5.

5. Resolve conflicts. The rebase may stop once per conflicting commit — repeat this step each time. List the conflicted files and inspect each:
   ```sh
   git diff --name-only --diff-filter=U
   ```
   For each conflicted file, read it, understand both sides, and resolve the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) so the result is correct — keeping the intent of **both** the branch's commit being replayed and the incoming `main` changes. Follow the repo conventions in `CLAUDE.md` and `.github/copilot-instructions.md` when deciding the merged result. Do not blindly pick one side. Then:
   ```sh
   git add -A
   git rebase --continue
   ```
   Do not edit commit messages when the rebase prompts; keep each original message.

   If a conflict is genuinely ambiguous and you cannot determine the correct resolution, stop and ask the user rather than guessing. Leave the rebase in progress so they can finish it (or run `git rebase --abort` to back out — the branch returns to its pre-rebase state).

6. Push the rebased branch. First check whether the branch has an upstream:
   ```sh
   git rev-parse --abbrev-ref --symbolic-full-name @{u}    # fails if there is no upstream
   ```
   - If there is no upstream, skip the push and note that (`pr-create` or `commit-push` will set it).
   - Otherwise push. Because the rebase rewrote the branch's commits, a normal push would be rejected — use a lease so the push fails instead of clobbering anything unexpected on the remote:
     ```sh
     git push --force-with-lease
     ```
     If the lease fails, someone pushed to the branch after the rebase started. Do **not** retry with a plain `--force`. Stop and report it — the user should fetch, inspect what landed on the remote, and re-run `rebase`.

7. Report the result: how many commits from `main` the branch was rebased onto, how many of the branch's commits were replayed, which files (if any) had conflicts and how they were resolved, the new head sha, and whether the push succeeded (or why it was skipped).
