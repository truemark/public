---
name: pr-create
description: Push the current branch, open a draft GitHub PR with a squash-merge-ready title and body, and report its URL
allowed-tools: Bash(git:*), Bash(gh:*)
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-create
  version: 2026.09.20.1811
---

Open a **draft** GitHub pull request for the **current branch** against `main`. Because this repo **squash-merges**, the PR title and description become the final commit on `main` — so write them as the commit message for the whole feature: succinct but descriptive.

**Always hand back the PR link.** Every exit that has a PR — the one this skill opens, or the open one it finds in step 1 — ends with that PR's URL, written as a bare `https://github.com/...` URL on its own line so the terminal makes it clickable. Never substitute a PR number, a branch name, or a markdown label for the URL. The exits with no PR are the guards in steps 1 and 2 (on `main`, or nothing ahead of `origin/main`) and a **failed** lookup in step 1; each says so in as many words and names the branch, so a missing link is never mistaken for an oversight — and a failed lookup reports the failed command rather than asserting that no PR exists. If the push or `gh pr create` fails, report which step failed and give the branch name, since no URL exists yet.

## Steps

1. Determine the branch and guard against bad states:
   ```sh
   git rev-parse --abbrev-ref HEAD     # current branch
   ```
   - If the branch is `main`, stop and tell the user to create a feature branch first. Say explicitly that no PR was opened and name the branch, since this exit has no link to give.
   - If an open PR already exists for the branch, stop and report its URL on its own line instead of creating a duplicate:
     ```sh
     gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json url -q '.[0].url // empty'
     ```
     Only a **successful** empty result means there is no open PR to collide with. `gh pr list` is the existence check rather than `gh pr view`, whose non-zero exit cannot distinguish "no PR" from a failed call (**GEN-015**). If the call exits non-zero the check failed: stop and report which command failed and why, rather than reading the empty output as "no PR" and opening a duplicate against a PR that is already there.

2. Review what the PR will contain so the title and body reflect the actual change set, not just the latest commit:
   ```sh
   git fetch origin main
   git log --oneline origin/main..HEAD
   git diff --stat origin/main...HEAD
   git diff origin/main...HEAD
   ```
   If there are no commits ahead of `origin/main`, stop and report that there is nothing to open a PR for. Say explicitly that no PR exists yet and name the branch, since this exit has no link to give.

3. Push the branch and set upstream if it isn't already pushed:
   ```sh
   git push -u origin HEAD
   ```

4. Compose the PR **title** and **body** as the squash commit:
   - **Title** — a single succinct line in imperative mood (~50–70 chars, no trailing period) describing what the feature accomplishes as a whole. It must stand alone as a good commit subject. Do not prefix it with a branch name or ticket noise.
   - **Body** — a short description of the change: what it does and why. Use a few bullet points if the change spans multiple parts. Keep it tight — this is a commit message, not an essay. Omit boilerplate ("This PR...") and do not enumerate every file.
   - Summarize the **whole branch** (all commits ahead of `main`), since squash collapses them into one.

5. Create the PR against `main` in **draft** state:
   ```sh
   gh pr create --draft --base main --title "<title>" --body "<body>"
   ```

6. Report the result: the PR URL and the title used. Note that the PR was opened as a draft, so the user must mark it ready for review before it can be merged. Remind the user that on squash-merge this title and body become the commit on `main`, so they can tweak the wording in GitHub before merging if needed.

   Finish with the PR URL as a bare URL on its own line. The link is what the author needs from this run, so it goes where it is impossible to miss rather than buried mid-paragraph.
