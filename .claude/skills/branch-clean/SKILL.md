---
name: branch-clean
description: Stash changes, fetch, and start a fresh short-named branch off the updated origin/main
allowed-tools: Bash(git:*), Bash(gh:*)
metadata:
  owner: Erik Jensen <@erikrj>
  source: https://github.com/erikrj/public/tree/main/.claude/skills/branch-clean
  version: 2026.07.15.1923
---

Move the current work onto a fresh branch cut from an up-to-date `origin/main`, then drop the old branch. Local changes are carried over via a stash. This skill commits nothing and never touches the remote beyond fetching.

**Always move every uncommitted change together.** Bring all modified and untracked files over to the new branch as one group — never ask which changes to include, and never offer to split them out or leave some behind, even when they look unrelated. If the user wants a subset, they will say so explicitly; absent that, everything moves.

## Steps

1. Capture the starting state:
   ```sh
   git rev-parse --abbrev-ref HEAD     # current branch — remember as {old}
   git status --porcelain              # are there local changes?
   ```
   Get the GitHub username for the branch prefix:
   ```sh
   gh api user -q .login               # remember as {user}
   ```

2. If there are local changes, stash them **all** (including untracked files) and remember that a stash was created:
   ```sh
   git stash push --include-untracked -m "branch-clean: {old}"
   ```
   This captures the entire working tree in one stash so every change moves together — do not stash by path or cherry-pick files. If the tree is clean, skip the stash.

3. Fetch the latest `main`:
   ```sh
   git fetch origin main
   ```

4. Choose a **short** branch name of the form `{user}/{name}`:
   - `{name}` must be short, kebab-case, and descriptive — two or three words at most (e.g. `fix-login-redirect`, not `fix-the-login-redirect-bug-on-safari`).
   - **If changes were stashed**, derive `{name}` from what actually changed — inspect the stash to pick a fitting name:
     ```sh
     git stash show --stat stash@{0}
     git stash show -p stash@{0}
     ```
   - **If the tree was clean**, ask the user what they are about to work on, and base `{name}` on their answer. Do not invent a name without asking.

5. Create and switch to the new branch from the freshly fetched main. Use `--no-track` so the branch does not adopt `origin/main` as its upstream — it should track its own remote branch once pushed, not `main`:
   ```sh
   git switch --no-track -c {user}/{name} origin/main
   ```

6. Delete the old branch locally (now that you are on the new one). **Never delete `main`** — if `{old}` is `main` (or is the same as the new branch), skip this step entirely and leave the branch in place. In that case there is no distinct feature branch to drop.
   Otherwise, first try the **safe** delete, which refuses if `{old}` has commits not reachable from its upstream or `HEAD`:
   ```sh
   git branch -d {old}
   ```
   If the safe delete fails, `{old}` has unmerged commits that would be discarded. Do **not** silently force-delete. Show what would be lost and ask the user how to proceed:
   ```sh
   git log --oneline {old} --not origin/main     # commits on {old} not in origin/main
   ```
   - If the user confirms the commits are disposable (or already captured elsewhere, e.g. an open PR), force-delete: `git branch -D {old}`.
   - Otherwise leave `{old}` in place and report that it was kept so its commits are not lost.

7. If a stash was created in step 2, restore it onto the new branch:
   ```sh
   git stash pop
   ```
   If the pop conflicts, stop and report the conflict — leave the stash intact for the user to resolve manually.

8. Report the result: the new branch name, whether changes were carried over, and what happened to `{old}` — deleted, kept (because it had unmerged commits), or not applicable (the delete was skipped because `{old}` was `main` or the same as the new branch). Note that nothing was committed or pushed.
