---
name: pr-comments-resolve
description: Close out inline PR review threads — verify fixes are committed or apply the recorded rejection, reply on each thread, mark it resolved, and report the PR URL
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*), Read, Grep, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments-resolve
  version: 2026.09.20.1816
---

Close out every open **inline review thread** on the GitHub pull request associated with the **current branch**. A thread is closed one of two ways: the change it asked for was made and committed, or it was rejected with a stated reason. Both get a reply and are marked resolved. Only threads that are genuinely unresolvable — the fix is uncommitted, or the point needs the author's decision — are left open.

Scope is inline review threads specifically, because those are the only comments GitHub gives a resolvable state. Review **summary** bodies and issue / conversation comments cannot be resolved via the API; they are reported so nothing is silently dropped, but this skill does not close them.

This skill does **not** edit code. Run `pr-comments-fix` first to make the changes and record the triage verdicts.

**Always hand back the PR link.** Every exit from this skill that found a PR gives that PR's URL, written as a bare `https://github.com/...` URL on its own line so the terminal makes it clickable — never a PR number, a branch name, or a markdown label in its place. Because this report's ending is already spoken for by the rejected-thread list (step 7), the link is the report's **opening** line instead; a run that closes threads on the author's behalf is one they will want to spot-check on GitHub. Only two exits have no link, and in both no URL was ever resolved: the lookup found no PR, and the lookup itself failed. The first says plainly that the branch has no PR; the second reports the failed command and must never be phrased as "no PR".

## Steps

1. Resolve the PR for the current branch:
   ```sh
   gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json number,url,headRefName -q '.[0] // empty | "\(.number)\t\(.url)\t\(.headRefName)"'
   ```

   `gh pr list` is the existence check, not `gh pr view`: it exits **0** whether or not a PR was found — empty output means there is none — and exits non-zero only when the query itself failed, so an outage is never reported as "no PR" (**GEN-015**). Guard the interpolation with `.[0] // empty`: a bare `.[0] | "\(.number)…"` interpolates a `null` first element into the literal line `null\tnull`, which defeats the empty-output test and carries invalid PR fields into the rest of the skill. A non-zero exit is a **failed check**, not an answer — stop and report it rather than taking the no-PR path.

   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, report that and stop — name the branch, since this is one of only two exits with no link to give — the other is a **failed** lookup, which reports the failed command instead of asserting that no PR exists. Otherwise print the PR URL on its own line before touching any thread.

2. Fetch the inline review threads with their resolution state, node id (needed to resolve), and the first comment's database id (needed to reply):
   ```sh
   gh api graphql --paginate -f query='
     query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$number){
           reviewThreads(first:100, after:$endCursor){
             pageInfo{ hasNextPage endCursor }
             nodes{ id isResolved isOutdated path line
               comments(first:50){ nodes{ databaseId author{login} body createdAt } } } } } } }
   ' -F owner={owner} -F repo={repo} -F number={number}
   ```
   The query paginates deliberately. A bare `reviewThreads(first:100)` truncates past 100 threads, and this skill is the one that closes threads out — truncation would leave threads untouched while the run reports completion. `--paginate` emits one JSON document per page, so collect nodes across pages (`jq -s '[.[].data.repository.pullRequest.reviewThreads.nodes[]]'`) before working with them.
   Also fetch the two comment types that have **no resolve state** — review summary bodies and issue / conversation comments:
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
   gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
   ```
   These cannot be resolved and are **not** part of the actionable list built in step 4. Fetch them so that any that asked for a change can be surfaced in the report (step 7) rather than silently dropped — if one needs action, it is the author's to take or a reason to re-run `pr-comments-fix`.

3. Load the triage record written by `pr-comments-fix` at `.git/pr-triage-{number}.json`, keyed by `commentId`. It carries the **verdict** (`fix` / `reject` / `escalate`) and the **reason** for each comment. If the file is missing (this skill was run standalone), triage the threads yourself using the verdict definitions in the `pr-comments-fix` skill — the classification rules live there and must not be duplicated or weakened here.

4. Build the actionable list of **unresolved** inline threads. For each, capture the **path**, **line**, the thread's node **id**, the originating comment's **databaseId**, and the request (verbatim body).
   - Skip threads already marked **resolved**.
   - Skip purely informational comments that request no change (e.g. PR overview summaries).

5. Determine each thread's outcome. Never resolve a thread on the strength of a working-tree edit — the change must be **present in a commit on the current branch**.

   For **fix** verdicts, verify before touching the thread. Verify against the triage entry's **`files[]`** — the files the fix actually touched — falling back to `{path}` only when the triage record is missing:
   ```sh
   git status --porcelain {files...}      # must be clean for those files
   git log --oneline -5 -- {files...}     # the fixing commit should be here
   git log -p -1 -- {files...}            # inspect the change if needed
   ```
   Read those files and their surrounding context to confirm the change the comment asked for is in fact present.

   Checking only `{path}` would misclassify every cross-file fix as **not-fixed** and leave its thread open — the same reason step 6 derives the cited sha from `files[]`. A comment asking for a test is satisfied in a test file, not at the line it was anchored to.

   Classify each thread as:
   - **fixed-and-committed** — the change is present and committed → reply + resolve.
   - **rejected** — the triage verdict is `reject` → reply with the reason + resolve.
   - **fixed-but-uncommitted** — the change is in the working tree only → do **not** resolve; report that it must be committed first.
   - **not-fixed** — verdict was `fix` but the change is absent → do **not** resolve; report it as still open.
   - **escalated** — the triage verdict is `escalate` → do **not** resolve. Reply on the thread noting it needs the author's decision, and surface it in the report.

6. Reply and resolve.

   For **fixed-and-committed** threads, cite the commit that addressed it. Derive the sha from the triage entry's **`files[]`** — the files the fix actually touched — not from the path the comment was anchored to:
   ```sh
   git log -1 --format=%h -- {files[0]} {files[1]} ...   # short sha that fixed it
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{databaseId}/replies \
     -f body="Fixed in {sha} — {one-line summary of the change}."
   ```
   A fix frequently lands somewhere other than the commented line — "add a test for this" is fixed in a test file, and a comment on a config value is often fixed in the doc that describes it. Using the commented path alone would then cite an unrelated commit, or find none at all. If the triage record is unavailable, fall back to `git log -1 --format=%h` for the branch tip and say which files changed rather than naming a path-specific sha you cannot verify.

   For **rejected** threads, post the recorded reason. The reply must say what was checked and why the comment does not apply, so a human reading the PR later can audit the decision without re-deriving it:
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{databaseId}/replies \
     -f body="Not applying — {reason}."
   ```
   Write the reason plainly and without hedging or apology. Do not claim a rule or a check that does not exist, and do not dress a judgment call up as a fact: if the call is a design preference, say so.

   Then mark the thread resolved using its node `id` (both cases):
   ```sh
   gh api graphql -f query='
     mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }
   ' -F id={threadId}
   ```

   Keep replies short and factual. Do not resolve a thread whose reply failed to post.

7. Report the results, opening with the PR URL as a bare URL on its own line. List each thread with:
   - the **file path** and **line**
   - the comment **body** (brief)
   - the outcome: **fixed + resolved** (with the cited sha), **rejected + resolved** (with the reason), **left open — uncommitted**, **left open — not fixed**, or **left open — needs your decision**

   Then list any **unresolvable** comments from step 2 — review summary bodies or issue / conversation comments that asked for a change. They cannot be closed via the API, so name them explicitly rather than letting them vanish between the threads that could be.

   End with a short summary: how many threads were resolved as fixed, how many resolved as rejected, and how many left open and why. Because rejected threads are closed without a code change, always list them together at the end under a clear heading — they are the part of this run most worth the author's eyes.
