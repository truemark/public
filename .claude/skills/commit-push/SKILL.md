---
name: commit-push
description: Stage all modified files, commit them with a descriptive message, push to the remote, and link any open PR for the branch
allowed-tools: Bash(git:*), Bash(gh:*)
disable-model-invocation: true
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/commit-push
  version: 2026.09.20.1816
---

Stage every modified, deleted, and untracked file in the working tree, commit them with a clear, descriptive message, and push the branch to its remote. This is `commit` plus a push.

**Commit the working tree exactly as it is.** Invoking this skill is an explicit instruction to commit *everything* currently in the working tree. Do not second-guess, filter, exclude, revert, `git restore`, `git checkout`, or `git stash` any change — not even one that looks unrelated, unintended, surprising, or like generated/regenerated output. It is not your call to decide a change is "noise" and drop it. If a change looks unexpected, still commit it, and simply flag it in your final report so the user can decide. The only changes that may be left out are ones the user names explicitly in the same request.

**Hand back the PR link when there is one.** This skill is not PR-scoped, but its output is almost always read on the way to a pull request. Once the report is otherwise complete, ask whether the current branch has an open PR:
```sh
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json url -q '.[0].url // empty'
```
If that prints a URL, end the report with it as a bare `https://github.com/...` URL on its own line, so the terminal makes it clickable — never a PR number or a branch name in its place. If it succeeds and prints nothing, there is no open PR: say nothing about links rather than apologizing for their absence. The check is one cheap call, so run it on every exit that did work worth looking at, including the early stops.

Use `gh pr list`, not `gh pr view`, and treat a **non-zero exit as a failed check rather than as "no PR"**. `gh pr view` exits non-zero both when the branch genuinely has no PR and when the call itself fails — a revoked token, an offline network, a GitHub outage — so reading its exit code as an answer reports "no open PR" during an outage and silently drops a link that does exist. `gh pr list --head` separates the two: it exits **0** whether or not a PR was found, printing the URL or nothing, and exits non-zero only when the query actually failed. On a non-zero exit, say the check failed and why, rather than asserting there is no PR.

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

7. Report the result: the commit sha and subject, the files included, and the remote branch it was pushed to. If any staged change looked surprising or unrelated, call it out here as a flag for the user — but it was still committed, not dropped. Then run the open-PR check above; if there is one, say that the push updated it and close with its URL.
