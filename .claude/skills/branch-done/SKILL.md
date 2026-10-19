---
name: branch-done
description: Delete the finished current branch, switch to main, and pull the latest
allowed-tools: Bash(git:*), Bash(gh:*)
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/branch-done
  version: 2026.07.15.1923
---

Finish the current feature branch: switch to `main`, pull the latest, and delete the old branch locally. Use this once a branch's work is merged (or abandoned). This skill never touches the remote beyond fetching/pulling, and never deletes anything without confirming the work is safe.

## Steps

1. Capture the starting state:
   ```sh
   git rev-parse --abbrev-ref HEAD     # current branch — remember as {old}
   git status --porcelain              # are there local changes?
   ```

2. **Refuse to run with a dirty working tree.** If `git status --porcelain` produced any output, stop and tell the user to commit or stash their changes first — deleting the branch (or pulling `main`) would risk losing them. Do not stash, commit, or discard anything yourself. This guard runs first, before any branch-specific handling.

3. **If `{old}` is `main`**, there is no feature branch to delete. Just pull and stop:
   ```sh
   git pull --ff-only
   ```
   Report that you were already on `main` and only pulled.

4. While still on `{old}`, check whether its PR has been merged (this decides whether deleting it is safe, since squash-merge leaves the branch's commits unreachable from `main`):
   ```sh
   gh pr view --json state,mergedAt,url -q '"\(.state)\t\(.mergedAt)\t\(.url)"'
   ```
   Remember whether the PR is `MERGED`. If there is no PR for the branch, note that and continue.

5. Switch to `main` and pull the latest:
   ```sh
   git switch main
   git pull --ff-only
   ```
   `--ff-only` keeps `main` a clean fast-forward; if it refuses, stop and report that `main` has diverged unexpectedly rather than forcing a merge.

6. Delete `{old}` locally. First try the **safe** delete, which refuses if `{old}` has commits not reachable from `main`:
   ```sh
   git branch -d {old}
   ```
   If the safe delete succeeds, you are done — go to step 7.

   If it **fails**, `{old}` has commits not reachable from `main`. Decide based on step 4:
   - **If the PR was `MERGED`** (squash- or rebase-merge makes the branch commits unreachable even though the work is on `main`), force-deleting is safe:
     ```sh
     git branch -D {old}
     ```
   - **Otherwise** (no PR, or PR is still open/closed-unmerged), do **not** silently force-delete. Show what would be lost and ask the user how to proceed:
     ```sh
     git log --oneline {old} --not main     # commits on {old} not in main
     ```
     Force-delete with `git branch -D {old}` only if the user confirms the commits are disposable or captured elsewhere; otherwise leave `{old}` in place and report that it was kept.

7. Report the result: that you are now on `main`, whether the pull fast-forwarded (and how many commits it pulled), and what happened to `{old}` — deleted safely, force-deleted (PR merged), or kept (unmerged, awaiting the user). Note that nothing was pushed.
