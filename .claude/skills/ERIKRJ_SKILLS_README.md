---
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/blob/main/.claude/skills/ERIKRJ_SKILLS_README.md
  version: 2026.07.27.1744
---

# Agent skills

This directory holds repository-scoped agent skills. Each skill lives in `<skillname>/SKILL.md`; the directory name is the skill name.

## The development workflow

The skills are designed around one end-to-end loop: make a change, ship it to a PR, let the agent work the review to completion, then review the finished result once. The two commands that matter are `pr-open` and `pr-review-loop` — the rest are the single-purpose skills those two compose, kept available so any step can be run by hand.

```text
1. ask Claude to make changes
2. pr-open           # fresh branch off main + commit + push + draft PR
3. pr-review-loop    # request review → fix / reject → push → resolve → repeat
4. more changes while the PR is open? commit-push, then back to 3
5. review the result, mark ready, merge
6. branch-done       # switch back to main, pull, drop the branch
```

Once the PR is open, further changes — whether you make them or you ask Claude to — ship with `commit-push`, which adds them to the same PR; `pr-open` refuses to run again for a branch that already has one. Then run `pr-review-loop` again so the new commits get reviewed.

Step 3 is the part that used to require you. `pr-review-loop` drives the whole review cycle unattended: it gets a Copilot review in flight, waits for it to finish, decides what is real, fixes it, pushes, replies on every thread, resolves them, and goes around again until the PR settles.

Where a repository requests Copilot automatically on PR open, a review is already running by the time `pr-review-loop` starts. The loop detects that and waits for the in-flight review rather than requesting a duplicate — a duplicate request is rejected, and older versions treated that rejection as a hard error and exited before triaging anything.

### How the loop decides what to fix

Every comment gets exactly one verdict. The question is always *"is there a real defect or a real rule violation here?"* — never *"did the reviewer cite a rule code?"*. Reviewers legitimately find bugs and security problems that no rule in `.github/copilot-instructions.md` covers, and those are fixed on their own merit.

| Verdict | When | What happens |
|---------|------|--------------|
| `fix` | A genuine defect (bug, security issue, bad logic, unhandled edge case, resource leak, test that does not test what it claims) **or** a genuine violation of a rule in `.github/copilot-instructions.md` / `CLAUDE.md` | Code is edited, committed, pushed. The thread gets a reply citing the fixing commit, then is resolved. |
| `reject` | The comment does not identify a real problem: factually wrong about the code, already handled elsewhere, subjective style not tied to a rule, contradicts a deliberate design, or asks for out-of-scope work | No code change. The thread gets a reply stating why, then is resolved. |
| `escalate` | Genuinely needs a decision only you can make (a product trade-off, a business rule the agent cannot verify, a change with wide blast radius) | Left open, replied to, and surfaced in the report. Ends the loop. |

Verdicts and reasons are written to `.git/pr-triage-{number}.json` — inside `.git/` so it is never staged by `commit` and needs no `.gitignore` entry. The record persists across rounds, which is what makes churn detectable.

**Rejection is the mechanism that lets the loop terminate.** Before it existed, a false positive could not be fixed (it was wrong) and could not be resolved (nothing was fixed), so it survived every round forever and the cycle could only be ended by a human resolving threads in the GitHub UI.

### Turning findings into rules

Fixing a finding closes it on one PR. If the same class of mistake can be made again anywhere else, fixing it alone means rediscovering it on every future PR — so before committing, the loop asks which of the round's fixes generalize, and appends those to `.github/copilot-instructions.md` as numbered rules.

The line is whether the defect could recur in unrelated code:

- **Generalizes** — a misused CLI flag, a footgun in a config format, an API whose behavior surprises the caller. These become rules.
- **Does not** — a wrong path, a stale filename, a description that drifted from its own steps. These are one-offs in the diff at hand.

Rules are appended to the matching domain section with the next unused number (numbers are never reused or renumbered), state the wrong and right forms concretely, and bump the file's `metadata.version`. The loop is deliberately conservative here: a rule that fires on subjective judgment produces noise on every future review, which is worse than occasionally re-finding the same thing. Borderline cases are left out and flagged in the report instead.

This is the compounding part of the workflow — each PR that finds something general makes the reviewer smarter on the next one, rather than the loop paying the same tax forever.

### How the loop stops

| Condition | Meaning |
|-----------|---------|
| **Settled** | No actionable findings, or everything resolved with no code changed. Nothing new for a reviewer to look at. |
| **Churn** | A comment already rejected in an earlier round was raised again on the same path. Two rejections of the same point means the disagreement is real and belongs to you. |
| **Escalation** | A finding needs your decision. The round finishes everything else first. |
| **Round cap** | `pr-review-loop <rounds>` rounds completed (default 20). |
| **Hard error** | Review request failed for a reason other than "already requested", poll timed out, or the push was rejected as non-fast-forward (run `rebase`). |

The loop never force-pushes and never marks the PR ready for review — that stays yours.

### What to read when it finishes

The run report ends with three lists, and they are the point of reviewing at all:

- **Rejected without a code change** — every place the agent overrode a reviewer on your behalf, with the reason posted to GitHub. Read this first.
- **Needs your decision** — escalations and churn.
- **The final audit** — everything still open on the PR, each with a recommendation.

The audit is a fresh query against GitHub, not a summary of what the loop believes it did. That distinction is the whole value: a `resolveReviewThread` call that failed silently, a thread that appeared after the last fetch, or a reply that posted while the resolve did not would otherwise leave the run reported as finished while you still see open comments on the PR page. Each open item is paired with why it is open — escalated, churn, not fixed, uncommitted, blocked, a failed API call, a comment type that has no resolve state, or never triaged — and a concrete next action rather than an invitation to go look.

A thread the loop **never triaged** is reported as a defect in the run, not as a decision waiting on you. Those two must never read the same.

## PR review workflow

These skills operate on the PR for your **current branch**. They are split by responsibility so each step is safe to run alone; `pr-review-loop` is the composition of the middle three.

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `pr-open` | Takes the working tree to an open draft PR in one step: fresh `{user}/{name}` branch off updated `origin/main`, commit, push, create. Composes `branch-clean` + `commit` + `pr-create`. Stops if the branch already has an open PR. | Stages + commits | Pushes + opens draft PR |
| `pr-review-loop [rounds]` | Drives the full review cycle unattended until the PR settles. Composes `pr-comments-fix` + `commit-push` + `pr-comments-resolve` per round. Requires a clean working tree. | Yes (commits) | Requests reviews, pushes, replies, resolves |
| `pr-comments` | Lists every comment on the PR (review summaries, inline diff comments, conversation comments) with full details and resolution status. Read-only. | No | Reads only |
| `pr-comments-fix` | Triages every comment into `fix` / `reject` / `escalate`, edits the working tree for the fixes, and records verdicts and reasons to `.git/pr-triage-{number}.json`. Does not commit, push, reply, or resolve. | Yes (working tree) | Reads only |
| `pr-comments-resolve` | Closes out threads: fixed ones are verified as **committed** then replied to and resolved; rejected ones are replied to with the reason and resolved. Escalated ones are replied to and left open. Never edits code. | No | Reads + writes |

All of them resolve the PR from the current branch and pull comments from the four places GitHub stores them (review summaries, inline diff comments, issue/conversation comments, and GraphQL review-thread state).

### Running the steps by hand

The loop is the fast path, not the only path. To stay in the loop yourself:

```text
1. pr-comments           # see what reviewers asked for
2. pr-comments-fix       # triage + make the code changes
3. (review the diff yourself, then commit-push)
4. pr-comments-resolve   # reply on each thread and resolve
```

`pr-comments-fix` stops at the working tree so you can inspect before committing. `pr-comments-resolve` will **not** resolve a thread whose fix is uncommitted — it reports it as "left open — uncommitted" so nothing is marked done before it is actually on the branch.

### Notes

- **Current-branch scoped.** Each skill operates on the PR for the branch you have checked out. If there is no PR for the branch, it reports that and stops.
- **Respects repo rules.** Triage honors the conventions in `CLAUDE.md` and `.github/copilot-instructions.md` — but a rule code is supporting evidence for a finding, not the bar for one.
- **Skips noise.** Informational comments (e.g. PR overview summaries) and already-resolved threads are skipped automatically.
- **Copilot naming.** Three different names are in play and are not interchangeable: `@copilot` is the value `gh pr edit --add-reviewer` takes, `Copilot` is the login the requested reviewer appears under, and `copilot-pull-request-reviewer[bot]` is the author of the submitted review.
- **Requires the GitHub CLI.** All rely on an authenticated [`gh`](https://cli.github.com/) and use `gh api` / `gh api graphql` under the hood.

## Security & quality findings workflow

Two skills work together to surface and fix GitHub's security and quality alerts for the **whole repository**. Like the PR-comment skills, they are split so reporting is read-only and fixing is an explicit, per-finding action.

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `gh-findings` | Reports all open findings from code scanning, Dependabot, and secret scanning, with summary stats and a full listing. Each finding includes a paste-to-run `gh-fix <url>` line. Read-only. | No | Reads only |
| `gh-fix <url>` | Fixes one finding identified by its alert URL, then puts the fix on a fresh `{user}/{name}` branch and opens a PR. Does not dismiss the alert. | Yes (commits) | Opens a PR |

`gh-fix` handles each source differently:

- **Code scanning** — reads the flagged file/line and applies the minimal in-code fix for the rule.
- **Dependabot** — upgrades the affected package to its patched version (via `pnpm`), never adding a new dependency.
- **Secret scanning** — removes the secret from the code and tells you to **rotate the credential out-of-band**; Claude cannot rotate it, and removal does not purge it from git history.

### Typical flow

```text
1. gh-findings                           # see every open alert, each with a gh-fix line
2. gh-fix <alert-url>                    # fix one finding on its own branch + PR (repeat per finding)
3. pr-review-loop                        # work the review on that PR to completion
4. review/merge the PR — alerts close once merged (or after rotation)
```

### Notes

- **No click-to-fix.** Terminal links are not clickable into the session, so `gh-findings` prints `gh-fix <url>` as a line you copy and paste. `gh-fix` fixes one finding per run — it never auto-fixes everything.
- **One finding, one PR.** `gh-findings` only reads. `gh-fix` commits the fix to a fresh `{user}/{name}` branch (the `branch-clean` convention) and opens a PR, but never dismisses or resolves an alert on GitHub — alerts close when the PR merges (Dependabot/code scanning) or the secret is rotated. It requires a clean working tree so the PR contains only the fix.
- **Respects repo rules.** `gh-fix` follows the conventions in `CLAUDE.md` and `.github/copilot-instructions.md`, and defers to you when a fix would add a dependency or can't be made safely.
- **Requires the GitHub CLI.** Both rely on an authenticated [`gh`](https://cli.github.com/) with access to the repo's security alerts.

## Other skills

| Skill | What it does | Touches code? | Touches GitHub? |
|---------|--------------|:-------------:|:---------------:|
| `commit` | Stages all modified, deleted, and untracked files and commits them locally with a descriptive message. Commits the working tree as-is — never drops or reverts a change based on its own judgment. Refuses to commit to `main` and does not push. | Stages + commits | No |
| `commit-push` | Same as `commit`, then pushes the branch to its remote (setting upstream if needed). Commits the working tree as-is — never drops or reverts a change based on its own judgment. Refuses `main`; never force-pushes. | Stages + commits | Pushes |
| `rebase` | Fetches and rebases the current branch onto `origin/main`, resolving any conflicts, then force-pushes with `--force-with-lease` (skipped if the branch has no upstream). Refuses to run with a dirty working tree; never plain force-pushes. | Rebases (rewrites commits) | Fetches + force-pushes (with lease) |
| `branch-clean` | Stashes local changes, fetches, and starts a fresh short `{user}/{name}` branch off the updated `origin/main`, then drops the old branch and restores the stash. | Stashes/restores | Fetches only |
| `branch-done` | Finishes the current branch: switches to `main`, pulls the latest (fast-forward), and deletes the old branch locally — safely, or force-deleting only when its PR is merged. Refuses a dirty tree. | Switches/pulls | Fetches only |
| `pr-create` | Pushes the current branch and opens a draft GitHub PR against `main`, with a succinct title and body written as the squash-merge commit. | No | Pushes + opens draft PR |
| `codereview <path>` | Recursively reviews a single path against the rules in `CLAUDE.md` and `.github/copilot-instructions.md`, prints the violations it finds, and maintains the outstanding-violations backlog in `CODEREVIEW.md` (removing findings a rerun no longer finds). Reports only; does not edit reviewed code. | Writes `CODEREVIEW.md` | No |
| `skills-update` | Refreshes every installed skill (and all its related files) **and** other tracked distributed files (e.g. `.github/copilot-instructions.md`) from the `metadata.source` GitHub URL declared in each file — a `/tree/` URL for a skill directory or a `/blob/` URL for a single file — overwriting local copies with the authoritative source. Reports updated/unchanged/stale per item; does not commit or push. | Writes skill + tracked files | Reads only |
| `transcribe <file>` | Transcribes an audio/video file by running the `tools/transcribe` CLI (AWS Transcribe), writing the transcript next to the input. Prompts for the AWS profile when one is not provided/set, and checks it is authenticated before running. | Writes transcript files | Reads + writes AWS (S3 + Transcribe) |

## Permissions

An unattended `pr-review-loop` stops at the first permission prompt, which defeats the point. `.claude/settings.json` in this repository allowlists the specific git and `gh` subcommands the loop needs, and denies the ones it must never reach for:

- **Allowed** — `git status/diff/log/show/rev-parse/fetch/add/commit/switch/stash`, `git branch` in its read-only forms only, the two exact push forms below, `gh pr`, `gh api`, `gh repo view`, `gh auth status`, `jq`, `date`, `sleep`, `wc`, `tr`.
- **Denied** — `git push --force`, `git push -f`, `git reset --hard`, `git clean`, `gh api -X`, `gh api --method`, `gh pr merge`, `gh repo delete`.

Subcommands are enumerated rather than blanket-allowing `Bash(git *)`. Deny rules take precedence over allow rules.

### Deny blocks; absence prompts

These are two different outcomes, and confusing them is how this file got its permissions wrong the first time:

- A command matching a **deny** rule is **refused outright**. There is no prompt, and no way to approve it in the moment.
- A command matching **no allow rule** — and no deny rule — **prompts**. You approve or reject it as it happens.

So "make this prompt rather than run silently" is achieved by *leaving a command off the allowlist*, never by denying it. Denying a command that a hand-invoked skill legitimately needs does not add friction to that skill; it breaks it outright.

That is exactly what went wrong here. `git push --force-with-lease` and `git branch -D` were originally denied on the theory that denying them would make `/rebase`, `branch-clean`, and `branch-done` prompt. It would instead have made their documented paths impossible to complete — `rebase` could not have pushed at all. Both denies were removed. The narrow allowlist already produces the intended behavior on its own: neither command matches an allow rule, so both prompt when invoked by hand and neither is reachable unattended.

### What the deny rules can and cannot do

**Permission rules match the command string from the left, and the trailing wildcard decides how much they cover.** A rule written without one — `Bash(git push)` — matches that command *exactly*, so it permits `git push` and nothing else. A rule ending in `:*` — `Bash(gh api -X:*)` — matches any command that *begins* with that prefix.

Neither form can express "this flag anywhere in the command." That is what makes deny rules leaky: `Bash(gh api -X:*)` does not match `gh api repos/{owner}/{repo}/pulls/{n}/merge -X PUT`, because that command does not *start* with `gh api -X` — the flag sits at the end. `Bash(git push --force:*)` misses `git push origin HEAD --force` for the same reason. Treat the deny list as a guard against the common, literal form, not as a boundary that survives a flag being moved.

The control that actually holds is the **narrow allowlist**:

- **`git push` is allowed only as `Bash(git push)` and `Bash(git push -u origin HEAD)`** — the two exact forms `commit-push` and `pr-create` issue. Both are written without a trailing wildcard, so they match those invocations and nothing longer: any other push, with a flag anywhere in it, matches no allow rule and therefore prompts. That is what genuinely keeps the unattended loop away from a force-push, and unlike the deny list it does not depend on guessing where a flag will sit.
- **`git branch` is allowed only for reading** — `Bash(git branch)` and `Bash(git branch --show-current)`. Every delete form prompts, including the safe `git branch -d`. A broader `Bash(git branch:*)` would have permitted `git branch --delete --force` outright, and no deny rule could reliably have caught it: `--delete --force` is `-D` spelled long, and a prefix rule naming one spelling never sees the other. Restricting the allow side covers every spelling at once. Branch deletion happens in `branch-clean` and `branch-done`, which are invoked by hand, so a prompt there costs one keystroke.
- **`gh api` is allowed broadly** (`Bash(gh api:*)`), because the loop calls many endpoints and the paths vary per PR. This is a real capability worth understanding: anything reachable over the GitHub REST or GraphQL API is reachable from an allowed `gh api` call. What keeps merges and deletions out of reach is that the skills never issue them, not that the permission layer forbids them.

The same asymmetry cuts the other way, and it is worth knowing before "fixing" a rule that looks broken. `gh-findings` issues `gh api repos/{owner}/{repo}/code-scanning/alerts --paginate -X GET ...`, which *looks* like it should trip the `Bash(gh api -X:*)` deny. It does not: the command begins `gh api repos/...`, not `gh api -X`, so the prefix never matches. A deny rule that fails to block a dangerous flag placed late will equally fail to block a harmless one.

Nothing a hand-invoked skill needs is denied. `rebase` force-pushes with `--force-with-lease`, and `branch-clean` and `branch-done` force-delete with `git branch -D` after you confirm; none of the three matches an allow rule, so each prompts at the moment it runs and none can be reached by the unattended loop. That is the intended shape — a prompt for the destructive step of a command you invoked deliberately, and no path to it otherwise.

## Adding a skill

Create a new `<name>/SKILL.md` file in this directory. The frontmatter must include a `metadata` block declaring `owner`, `source`, and `version` (**GEN-006**):

```markdown
---
name: my-skill
description: One-line summary shown in the command list
allowed-tools: Bash(gh:*), Read, Edit
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/my-skill
  version: 2026.07.24.2236
---

Instructions for Claude, written as a prompt...
```

- `description` — summarizes the skill for the command list.
- `allowed-tools` — restricts which tools the skill may use.
- `metadata.source` — the authoritative GitHub URL the skill is published and re-synced from. Downstream repositories pull from it via `skills-update`; per **GEN-005**, a downstream copy is never edited in place. This repository *is* the source for these skills, so editing them here is the correct way to change them.
- `metadata.version` — a `YYYY.MM.DD.HHMM` stamp, bumped on every change.

Two optional fields worth knowing:

- `disable-model-invocation: true` — hides the skill from Claude's own skill list so it only runs when you type `/name`. Used for skills that push, open PRs, or otherwise act on the remote: `commit-push`, `codereview`, `pr-open`, `pr-review-loop`.
- `arguments: [name]` — declares positional arguments, referenced in the body as `$name`.
