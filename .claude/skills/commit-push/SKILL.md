---
name: commit-push
description: Stage all modified files, commit them with a descriptive message, then push to the remote
allowed-tools: Bash(git:*)
disable-model-invocation: true
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/commit-push
  version: 2026.07.15.1923
---

Stage every modified, deleted, and untracked file in the working tree, commit them with a clear, descriptive message, and push the branch to its remote. This is `commit` plus a push.

**Commit the working tree exactly as it is.** Invoking this skill is an explicit instruction to commit *everything* currently in the working tree. Do not second-guess, filter, exclude, revert, `git restore`, `git checkout`, or `git stash` any change — not even one that looks unrelated, unintended, surprising, or like generated/regenerated output. It is not your call to decide a change is "noise" and drop it. If a change looks unexpected, still commit it, and simply flag it in your final report so the user can decide. The only changes that may be left out are ones the user names explicitly in the same request.

## Steps

1. Inspect the working tree to understand what changed:
   ```sh
   git status --porcelain
   git diff --stat HEAD
   git diff HEAD
   ```
   If there is nothing to commit **and** the branch is not ahead of its remote, report that and stop. If the tree is clean but there are unpushed commits, skip to the push step.

2. If the current branch is the default branch (`main`), stop and tell the user to create a feature branch first. Do not commit or push directly to `main`.

3. Stage **all** changes — every modified, deleted, and untracked file, with no exceptions:
   ```sh
   git add -A
   ```
   Do not drop or revert any file here based on your own judgment about whether it belongs (see the note above).

4. Write a commit message that summarizes the change as a whole:
   - A concise subject line (imperative mood, ~50 chars or less, no trailing period) describing **what** the change accomplishes — not a file list.
   - When the change is non-trivial, add a blank line and a short body explaining the **why** and any notable details. Keep it brief.
   - Group related edits into one coherent message. Do not just enumerate filenames.

5. Commit, ending the message with the required trailer:
   ```sh
   git commit -m "<subject>" -m "<optional body>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
   ```

6. Push the branch, setting upstream if it has none (e.g. a branch created with `--no-track`):
   ```sh
   git push -u origin HEAD
   ```
   If the push is rejected because the remote has commits you don't (non-fast-forward), stop and report it — do **not** force-push. Let the user reconcile (rebase/pull) first.

7. Report the result: the commit sha and subject, the files included, and the remote branch it was pushed to. If the branch has an open PR, note that the push updated it. If any staged change looked surprising or unrelated, call it out here as a flag for the user — but it was still committed, not dropped.
