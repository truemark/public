---
name: pr-review-loop
description: Drive the full Copilot review cycle unattended — wait out any in-flight review, request one when none is running, fix real findings, reject false positives, push, resolve threads, repeat until settled
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*), Bash(date:*), Bash(sleep:*), Bash(wc:*), Bash(tr:*), Read, Edit, Write, Grep, Glob
disable-model-invocation: true
arguments: [rounds]
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-review-loop
  version: 2026.07.27.1744
---

Run the entire PR review cycle for the **current branch** without a human in the loop: get a Copilot review in flight, wait for it to finish, fix what is real, reject what is not, commit and push, reply on and resolve every thread, then go around again. Stop when the PR has settled, and hand back a report the author can audit in one pass.

`$rounds` caps the number of review rounds (default **20**). The cap exists to bound cost and to stop arguments with a reviewer that will not be satisfied — hitting it is a reportable outcome, not a failure to retry harder. In practice the loop settles well before the cap; churn and escalation are the conditions that normally end it.

This skill composes the existing single-step skills rather than reimplementing them. Read each referenced `SKILL.md` and follow its steps as written; if one contradicts this file, the referenced skill wins for its own step.

## Preconditions

1. Resolve the PR for the current branch:
   ```sh
   gh pr view --json number,url,headRefName,isDraft -q '"\(.number)\t\(.url)\t\(.headRefName)\t\(.isDraft)"'
   ```
   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, stop and tell the user to run `/pr-open` first.

2. Confirm the working tree is clean:
   ```sh
   git status --porcelain
   ```
   If it is dirty, stop and report. Uncommitted changes make thread verification unreliable — the loop cannot tell a fix that shipped from one that is merely sitting in the tree. Tell the user to run `/commit-push` first.

## The round

Repeat until a stop condition below is met. Announce the round number before each round so the run is followable in the transcript.

1. **Check for work already waiting.** Fetch the review threads. This is the canonical thread query used throughout this skill — **it must paginate**:
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
   A bare `reviewThreads(first:100)` **silently truncates** on a PR with more than 100 inline threads, and every failure that causes is a false negative: the loop misses unresolved threads, requests a review that was not needed, and can declare itself settled while comments are still open. Declaring `$endCursor` and returning `pageInfo{ hasNextPage endCursor }` lets `--paginate` walk every page on its own.

   Because `--paginate` emits **one JSON document per page**, collect the nodes across pages before counting — `jq -s '[.[].data.repository.pullRequest.reviewThreads.nodes[]]'` — for the same reason a per-page `length` is wrong in step 3 (**GEN-007**).

   If there are already unresolved, actionable threads, skip to step 4 — there is no point asking for another review when the last one has not been answered. Otherwise continue to step 2.

2. **Get a review in flight — do not blindly request one.** Many repositories request Copilot **automatically** the instant a PR is opened, so straight after `/pr-open` a review is already running. Requesting a second one is a duplicate that GitHub rejects, and treating that rejection as a hard error aborts the loop *before it triages anything* — leaving the PR with exactly the open threads this skill exists to close. That failure is invisible from the loop's own output: it reports a clean early exit while the reviewer's comments sit unanswered.

   Establish the cutoff a new review has to beat, then request only when nothing is already running:
   ```sh
   # newest Copilot review already on the PR; the sentinel covers "none yet"
   prev=$(gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate \
     | jq -s -r '[.[][] | select(.user.login=="copilot-pull-request-reviewer[bot]")
                 | .submitted_at] | max // "1970-01-01T00:00:00Z"')

   # is Copilot a requested reviewer right now? one line per match, counted once
   pending=$(gh pr view --json reviewRequests \
     -q '.reviewRequests[] | select(.login=="Copilot") | .login' | wc -l | tr -d ' ')

   if [ "$pending" -eq 0 ]; then
     gh pr edit --add-reviewer "@copilot"
   fi
   ```
   `jq -s` slurps every page into one array before taking `max`, so the cutoff is the newest review on the whole PR rather than the newest on the last page (**GEN-007**). ISO-8601 timestamps compare correctly as strings, which is what makes `max` safe here.

   `@copilot` is the special value `gh pr edit --add-reviewer` documents for requesting a Copilot review. The requested reviewer then appears on the PR as the login `Copilot`, and the review it submits is authored by `copilot-pull-request-reviewer[bot]` — the three names are not interchangeable, so match each to the surface it belongs to. If `gh pr edit` rejects the value, fall back to the REST endpoint, which takes the login:
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/requested_reviewers -f 'reviewers[]=Copilot'
   ```
   A draft PR is fine — Copilot reviews drafts. **A rejection saying the reviewer is already requested is success, not failure** — it reports the state this step is trying to reach. Only a request that fails for some *other* reason stops the loop.

3. **Wait for the review to finish.** Two conditions must both hold, and waiting on either one alone mis-fires in a different direction:

   - **Copilot is no longer a requested reviewer.** GitHub clears the request when the review is submitted, so its presence is the authoritative "still working" signal. Waiting on the review record alone can match a review from an earlier round and start triaging while the current one is still being written.
   - **A Copilot review newer than `$prev` exists.** Waiting on the absent request alone is worse, because that is also the state *before* any review is ever requested — the loop would sail straight through on an empty PR.

   ```sh
   deadline=$(( $(date +%s) + 900 ))
   while [ "$(date +%s)" -lt "$deadline" ]; do
     pending=$(gh pr view --json reviewRequests \
       -q '.reviewRequests[] | select(.login=="Copilot") | .login' | wc -l | tr -d ' ')
     landed=$(gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate \
       | jq -s -r --arg prev "$prev" '.[][]
           | select(.user.login=="copilot-pull-request-reviewer[bot]"
                    and .submitted_at > $prev)
           | .submitted_at' | wc -l | tr -d ' ')
     if [ "$pending" -eq 0 ] && [ "$landed" -gt 0 ]; then echo "review landed"; break; fi
     sleep 15
   done
   ```
   Four things in that snippet are deliberate and must not be "simplified":

   - **Both conditions are required.** `[ "$pending" -eq 0 ]` alone is true before the first review is ever requested; `[ "$landed" -gt 0 ]` alone is true while Copilot is still writing the current one.
   - **The timestamp comparison happens inside jq**, which compares ISO-8601 strings correctly. Do not rewrite it as a shell string comparison — `[ "$a" ">" "$b" ]` is a syntax error in zsh, and the loop would spin until it timed out on every round.
   - **Each filter emits one line per match and `wc -l` does the counting.** Do not collapse either to `[...] | length`: `gh api --paginate` concatenates one result per page, so a per-page `length` returns one number *per page* (`"1\n0\n0\n1"` once the PR has enough reviews to paginate) and `[ "$n" -gt 0 ]` then fails with a non-integer error. Counting lines aggregates across pages correctly (**GEN-007**).
   - **The commands begin with `gh`, and the cutoff reaches jq through `--arg`.** Do not prefix either with an environment assignment (`PREV="$prev" gh api ...`) and read `env.PREV`. Permission rules match the command string from the left, so an env-prefixed command starts with `PREV=` and matches no `Bash(gh api:*)` allow rule — the poll would then prompt on every iteration of an unattended loop (**GEN-008**). Piping to a separate `jq` keeps the command matchable and passes the value without quoting hazards.

   Turnaround is typically 1–6 minutes from the request — measure it from when the PR was opened, not from when this skill started, since an auto-requested review is already partway through. The 15-minute timeout is a backstop. **If the timeout expires, stop the loop and report it** — do not re-request in a tight cycle.

4. **Triage and fix.** Follow `.claude/skills/pr-comments-fix/SKILL.md` in full. Its verdict definitions (`fix` / `reject` / `escalate`) are authoritative — in particular, a finding is judged on whether it identifies a **real defect or rule violation**, not on whether it cites a rule code. It writes the triage record to `.git/pr-triage-{number}.json`.

5. **Codify what generalizes.** Before committing, look at this round's `fix` verdicts and ask which of them describe a mistake that could be made again in any future PR, rather than a one-off in this diff. A finding generalizes when the same class of defect would recur in unrelated code — a misused CLI flag, a footgun in a config format, an API whose behavior surprises the caller. It does **not** generalize when it is specific to this change: a wrong path, a stale filename, a description that drifted from its own steps.

   For each finding that generalizes, add a rule to `.github/copilot-instructions.md`:
   - Append it to the matching domain section with the **next unused number** in that prefix. Numbers are never reused or renumbered — check the existing rules before choosing one.
   - State the rule, then show the wrong and right forms concretely. A rule the reviewer cannot mechanically check is not worth adding.
   - Bump the file's `metadata.version` to the current `YYYY.MM.DD.HHMM`.

   This is what stops the loop from re-fixing the same class of finding on every PR: the rule turns a repeated discovery into a check the reviewer applies up front. Be conservative — a rule that fires on subjective judgment produces noise on every future review, which is worse than the occasional repeat finding. If a finding is borderline, leave it out and note it in the report.

   Record the rule codes added in the round's triage entries so the report can cite them.

6. **Commit and push, but only if code actually changed.**
   ```sh
   git status --porcelain
   ```
   - If there are changes, follow `.claude/skills/commit-push/SKILL.md`. If the push is rejected as non-fast-forward, **stop the loop** and report — do not force-push; the user can run `/rebase`.
   - If there are none, skip this step. Every finding this round was rejected or escalated, so there is nothing new for a reviewer to look at.

7. **Reply and resolve.** Follow `.claude/skills/pr-comments-resolve/SKILL.md` in full. Threads that were fixed get a reply citing the commit; threads that were rejected get a reply stating why, and both are marked resolved. Escalated threads are replied to but left open.

8. **Evaluate stop conditions** (below). If none is met, start the next round.

## Stop conditions

Stop the loop and report when any of these holds:

- **Settled** — the round produced no actionable findings, or every finding was resolved and **no code changed** (step 6 was skipped). With nothing new to review, another round would only re-run the same reviewer against the same diff.
- **Churn** — a comment already rejected in an earlier round has been raised again on the same path with substantially the same content. `pr-comments-fix` flags this from the triage record. Two rejections of the same point means the disagreement is real and belongs to the author, not to another round.
- **Escalation** — a finding was classified `escalate`. Finish the current round (fix, push, resolve everything else), then stop. An escalation is by definition a decision the loop cannot make.
- **Round cap** — `$rounds` rounds have completed (default 20).
- **Hard error** — the review request failed for a reason other than "already requested", the poll timed out, or the push was rejected.

Never resolve a thread just to satisfy a stop condition, and never mark the PR ready for review — the PR stays a draft for the author to review and promote.

## Final audit

Whatever the stop condition, **re-query GitHub for what is still open before writing the report.** Do this against the API, not against the loop's own bookkeeping — the point of the audit is to catch the cases where the two disagree. A `resolveReviewThread` call that silently failed, a thread that appeared after the last fetch, a reply that posted while the resolve did not: all of these leave the loop believing it finished while the author still sees open comments.

```sh
# every unresolved inline review thread — the paginated query from step 1
gh api graphql --paginate -f query='
  query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$number){
        reviewThreads(first:100, after:$endCursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ id isResolved isOutdated path line
            comments(first:50){ nodes{ databaseId author{login} body createdAt } } } } } } }
' -F owner={owner} -F repo={repo} -F number={number} \
  | jq -s '[.[].data.repository.pullRequest.reviewThreads.nodes[]] | map(select(.isResolved|not))'

# review summary bodies and conversation comments — these have no resolve state
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
```

The audit **must** use the paginated form. An audit that truncates reports "no open comments" while comments are open — the precise failure it exists to catch, delivered with false confidence.

If nothing is unresolved, say so explicitly and give the number of threads checked. "No open comments" is only worth reading when it is clear what was counted.

Otherwise present **every** remaining open item in a single table — this table is the last thing in the report (see below):

| Item | Why it is still open | Your next step |
|---|---|---|
| `path:line` — one-line gist of the comment | one of the reasons below, with the round it happened in | a concrete action, not an invitation to go look |

Cross-reference the triage record to explain why each is still open; a thread the loop never triaged is a more serious finding than one it deliberately escalated, and the two must not read the same. Use these reasons, and shape the next step accordingly:

| Why it is open | Recommendation to give |
|---|---|
| **Escalated** | State the decision the author has to make and the options, with your recommendation and why. |
| **Churn** | Show the point raised twice, the reason it was rejected, and whether you now think the rejection was wrong. |
| **Not fixed** | Name the change still required and where it goes. |
| **Fixed but uncommitted** | Say which files are dirty and that `/commit-push` closes it. |
| **Blocked** | Name what blocked it — a permission gate, a failed push, a missing credential — and the exact step the author must take. Do not present a blocked item as a decision the author is free to make either way. |
| **Reply or resolve call failed** | Say which call failed and that re-running the skill will retry it. |
| **No resolve state** (review summary or conversation comment asking for a change) | Say whether it still needs action; these can never be closed via the API, so they will reappear in every audit until the author acts. |
| **Never triaged** | Treat as a defect in the run. Say plainly that the loop missed it and what it asks for. |

## Report

Produce one report for the whole run, written to be read by someone who was not watching:

- The PR URL, how many rounds ran, and which stop condition ended the loop.
- Per round: findings fixed (with the files touched), findings rejected (with the reason posted), findings escalated, and the commit sha pushed.
- **Any rules added to `.github/copilot-instructions.md`**, by code, with the finding each came from. These change how every future PR is reviewed, so they need the author's eyes even though nothing in this PR broke.
- **A consolidated "rejected without a code change" list across all rounds**, each with its file, the reviewer's point, and the reason posted to GitHub. This is the highest-value part of the report — it is every place the loop overrode a reviewer on the author's behalf, and it is what the author should read first.
- **A consolidated "needs your decision" list** for escalations and churn, with what the disagreement is.
- **The final audit table** — the table from the audit above: every comment still open on GitHub, each with why it is open and the author's next step. This table is the **last thing in the report** — nothing after it, not even a closing sentence — so the run always ends on the list of what still needs a human. If the audit came back empty, end instead with the explicit "no open comments" line and the count of threads checked.

Report honestly. If a round ended on an error, say so and show the output rather than presenting a partial run as a clean one. The audit is the one section that must never be softened: reporting a run as finished while comments are open on GitHub is the failure this skill exists to prevent, and the author will find out from the PR page rather than from you.
