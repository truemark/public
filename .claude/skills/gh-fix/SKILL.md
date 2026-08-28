---
name: gh-fix
description: Fix a single GitHub security/quality finding (code scanning, Dependabot, or secret scanning) on a new branch and open a PR
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(pnpm:*), Bash(git:*), Read, Edit, Write, Grep, Glob
arguments: [alert]
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/gh-fix
  version: 2026.07.15.1923
---

Fix the GitHub finding identified by `$alert`, then put the fix on a fresh branch and open a pull request for it. `$alert` is the alert's `html_url` (as emitted by `gh-findings`) or a `<source>/<number>` shorthand. This skill commits, pushes, and opens a PR — it does **not** dismiss the alert on GitHub (the alert closes only once the PR merges, or once a secret is rotated and resolved).

## Steps

1. Refuse to run with a dirty working tree so the PR contains only the fix:
   ```sh
   git status --porcelain
   ```
   If there is **any** output (modified, staged, deleted, or untracked files), stop and tell the user to commit or stash their changes first. Do not stash, commit, or discard anything yourself.

2. Parse `$alert` to get `{owner}`, `{repo}`, `{source}`, and `{number}`. Accept either form:
   - A full URL, e.g. `https://github.com/{owner}/{repo}/security/code-scanning/25`, `.../security/dependabot/739`, or `.../security/secret-scanning/3`. The path segment maps to the source: `code-scanning` → code scanning, `dependabot` → Dependabot, `secret-scanning` → secret scanning.
   - A shorthand `code-scanning/25` / `dependabot/739` / `secret-scanning/3`, with `{owner}/{repo}` taken from `gh repo view --json nameWithOwner`.

   If `$alert` is empty or cannot be parsed into a known source + number, stop and show the expected forms.

3. Fetch the alert detail for its source:
   - **Code scanning**: `gh api repos/{owner}/{repo}/code-scanning/alerts/{number}`
   - **Dependabot**: `gh api repos/{owner}/{repo}/dependabot/alerts/{number}`
   - **Secret scanning**: `gh api repos/{owner}/{repo}/secret-scanning/alerts/{number}`

   If the alert is already `fixed`/`dismissed`/`resolved`, report that and stop — nothing to do.

4. Fix according to the source:

   - **Code scanning** — this is a real in-code fix:
     - Read the flagged file at `most_recent_instance.location.path` around `start_line`/`end_line`, plus enough surrounding context to understand it.
     - Apply the **minimal change** that resolves the rule (`rule.id`, e.g. `js/insufficient-password-hash`, `js/polynomial-redos`, `js/incomplete-sanitization`). Use the rule's `help`/`description` from the alert to guide the fix.
     - Follow `CLAUDE.md` and `.github/copilot-instructions.md` conventions (valibot, formatting, etc.). Do not refactor unrelated code.

   - **Dependabot** — fix by upgrading, not by editing source:
     - Identify the affected package (`dependency.package.name`, ecosystem) and the patched version (`security_vulnerability.first_patched_version.identifier`).
     - Prefer raising the version where it is declared. For transitive deps in `pnpm-lock.yaml`, bump via pnpm rather than hand-editing the lockfile:
       ```sh
       pnpm update {package} --recursive --latest    # or target the patched version explicitly
       ```
     - Respect the repo rule against adding new dependencies — this only upgrades existing ones. If the only fix would add or majorly break a dependency, stop and report it for a human decision instead of forcing it.
     - Note that one package often covers several alerts; upgrading it may resolve siblings at once.

   - **Secret scanning** — Claude cannot rotate a credential, so do not pretend to "fix" it:
     - Locate the secret in the code/history if it is still present and remove it (replace with an env var / config reference), following existing patterns for secret handling.
     - Clearly report that the credential **must be rotated out-of-band** (the leaked value should be treated as compromised), and that removing it from the working tree does not purge it from git history.

5. If the finding is ambiguous, disagrees with intentional design, or cannot be safely fixed, leave the code untouched, skip the branch/commit/PR steps below, and explain why. No PR is opened when there is no fix to land.

6. Confirm the fix actually changed something before going further:
   ```sh
   git status --porcelain
   ```
   If there is **no** output, the attempted fix produced no working-tree changes (e.g. the dependency was already at the patched version, or the code already complied). Stop here — do not stash, branch, or open a PR — and report that there was nothing to land.

7. Put the fix on a fresh branch cut from an up-to-date `origin/main`, following the same naming convention as `branch-clean`:
   ```sh
   gh api user -q .login               # remember as {user}
   git fetch origin main
   ```
   - Choose a **short** branch name of the form `{user}/{name}`. `{name}` must be short, kebab-case, and descriptive — two or three words at most — derived from the alert being fixed:
     - **Code scanning** → the rule, e.g. `fix-polynomial-redos`.
     - **Dependabot** → the upgrade, e.g. `bump-{package}`.
     - **Secret scanning** → the removal, e.g. `remove-leaked-secret`.
   - The previous step confirmed there are changes, so stash them, create the branch off the freshly fetched main with `--no-track` (so it tracks its own remote branch once pushed, not `main`), then restore the fix:
     ```sh
     git stash push --include-untracked -m "gh-fix: {source}/{number}"
     git switch --no-track -c {user}/{name} origin/main
     git stash pop
     ```
     If the pop conflicts, stop and report it — leave the stash intact for the user to resolve manually.

8. Commit the fix and open a PR:
   - Stage and commit with a concise, descriptive message (imperative subject, ~50 chars, no trailing period) that names the finding it resolves. End the message with the required trailer:
     ```sh
     git add -A
     git commit -m "<subject>" -m "<optional body>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
     ```
   - Push and open a PR against `main`. Because the repo squash-merges, write the title and body as the final commit message — succinct but descriptive, and reference the alert:
     ```sh
     git push -u origin HEAD
     gh pr create --base main --title "<title>" --body "<body>"
     ```
     If the push is rejected as non-fast-forward, stop and report it — do **not** force-push.

9. Report the outcome: the alert (source + number + URL), **what was changed** (files/edits or the dependency upgrade) or **why it was skipped**, the new branch name, the commit sha, and the PR URL. Remind the user that the alert will only close once the PR merges (Dependabot/code-scanning) or the secret is rotated and the alert resolved — and that a leaked secret must still be rotated out-of-band regardless of the PR.
