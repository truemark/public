---
name: pr-comments-fix
description: Triage the GitHub PR comments for the current branch into fix / reject / escalate, apply the fixes, and record every verdict with its reason
allowed-tools: Bash(gh:*), Bash(jq:*), Read, Edit, Write, Grep, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments-fix
  version: 2026.07.25.1426
---

Fetch every comment on the GitHub pull request associated with the **current branch**, decide which ones identify a real problem, and fix those. Comments that do not identify a real problem are recorded as rejected with a reason, so `pr-comments-resolve` can close them out on GitHub — a review cycle only terminates if wrong comments have a path to closed.

This skill only edits code in the working tree — it does **not** commit, push, reply to threads, or mark threads resolved on GitHub.

## Steps

1. Resolve the PR for the current branch:
   ```sh
   gh pr view --json number,url -q '"\(.number)\t\(.url)"'
   ```
   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, report that and stop.

2. Fetch all four sources of comments (a GitHub PR splits them across endpoints):

   - **Review summary comments** (the top-level body of each submitted review):
     ```sh
     gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
     ```
   - **Inline review (diff) comments** — anchored to a file and line:
     ```sh
     gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
     ```
   - **Issue / conversation comments** — the general discussion thread:
     ```sh
     gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
     ```
   - **Review-thread resolution state** (whether an inline thread is resolved/outdated), via GraphQL:
     ```sh
     gh api graphql --paginate -f query='
       query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){
         repository(owner:$owner,name:$repo){
           pullRequest(number:$number){
             reviewThreads(first:100, after:$endCursor){
               pageInfo{ hasNextPage endCursor }
               nodes{ isResolved isOutdated path
                 comments(first:1){ nodes{ databaseId author{login} } } } } } } }
     ' -F owner={owner} -F repo={repo} -F number={number}
     ```
     Paginate rather than using a bare `first:100`, which truncates past 100 threads and would drop findings from triage entirely. `--paginate` emits one JSON document per page, so collect nodes across pages before using them.

3. Build the actionable list. For each comment, capture the **author**, **file path** and **line** (for inline comments), the **body** (verbatim), the thread's **root comment databaseId**, and the thread's **resolved / outdated** status.

   **Key every entry to the thread's root comment id, not to whichever comment you happened to read.** The REST endpoint in step 2 returns replies alongside root comments — a reply carries `in_reply_to_id` pointing at its thread's root. `pr-comments-resolve` works per *thread* and looks verdicts up by the root id, so an entry keyed to a reply is a verdict it will never find. Replies are context for understanding the request; they are not separate findings. Two consequences worth remembering: the loop's own replies from earlier rounds appear here, and a thread with discussion on it still yields exactly one entry.

   - Skip threads already marked **resolved**.
   - Skip review entries whose body is empty AND state is COMMENTED (container records for inline-only reviews).
   - Skip purely informational comments that request no change (e.g. PR overview summaries).
   - Skip comments authored by the loop itself (replies posted by `pr-comments-resolve` in an earlier round).

4. **Triage every actionable comment into exactly one verdict.** The question is always *"is there a real defect or a real rule violation here?"* — never *"did the reviewer cite a rule code?"*. Reviewers legitimately find bugs, security holes, and correctness problems that no rule in `.github/copilot-instructions.md` covers, and those must be fixed on their own merit. A cited rule code is supporting evidence, not the test.

   - **fix** — the comment identifies a genuine problem. This covers both:
     - a real defect: a bug, security issue, incorrect logic, unhandled error or edge case, resource leak, race, data-loss risk, broken type, or a test that does not test what it claims — whether or not any rule mentions it;
     - a genuine violation of a rule in `.github/copilot-instructions.md` or `CLAUDE.md`.
   - **reject** — the comment does not identify a real problem. Typical cases:
     - it is **factually wrong** about the code (misreads control flow, references a symbol, parameter, or behavior that does not exist, claims something is unhandled that is handled elsewhere);
     - the concern is **already addressed** at another layer (validated upstream, guaranteed by a type, covered by an existing test);
     - it is **subjective style** — naming, comment density, "readability", structure preference — that is not tied to a rule and is not a defect;
     - it contradicts a **deliberate, defensible design** in this change;
     - it asks for **out-of-scope work** — refactoring untouched code, pre-existing issues, or speculative future-proofing.
   - **escalate** — you genuinely cannot tell whether it is a real problem without a decision only the author can make (an intentional product trade-off, a business rule you cannot verify, a change with wide blast radius). Use this sparingly; it is the safety valve, not the default. When in doubt between *fix* and *escalate*, prefer **fix** if the change is small and safe.

   Never reject a comment merely because fixing it is inconvenient, because it did not cite a rule code, or because the reviewer is a bot. Rejecting a real defect is the most expensive mistake this skill can make.

5. Fix the code for every **fix** verdict:
   - Read the referenced file and surrounding context before editing.
   - Make the **minimal change** that resolves the comment. Do not refactor unrelated code.
   - Follow the project conventions in `CLAUDE.md` and `.github/copilot-instructions.md` (rule codes, formatting, validation library, etc.).
   - If, while editing, you discover the comment was actually wrong, downgrade it to **reject** and record why.

   Leave the code untouched for **reject** and **escalate** verdicts.

6. Write the triage record so the follow-up skills know what you decided and why. Store it at `.git/pr-triage-{number}.json` — inside `.git/` so it is never staged by `commit` or `commit-push` and never needs a `.gitignore` entry. Append to the existing file if one is present (do not overwrite earlier rounds — the history is what makes churn detectable):

   ```json
   {
     "pr": 5,
     "entries": [
       {
         "round": 1,
         "commentId": 123456789,
         "path": "tools/transcribe/src/main.ts",
         "line": 42,
         "url": "https://github.com/...",
         "body": "first ~300 chars of the comment, verbatim",
         "verdict": "fix",
         "reason": "Real defect: the output path is used before the null check on line 40.",
         "files": ["tools/transcribe/src/main.ts"]
       }
     ]
   }
   ```

   `round` is 1 higher than the highest `round` already in the file (1 if the file is new). `reason` must be a single sentence that stands on its own — it is posted verbatim to GitHub by `pr-comments-resolve`, so write it as a reply to the reviewer, not as a note to yourself.

7. **Churn check.** Before finishing, compare this round's comments against `reject` entries from earlier rounds in the triage record. If a comment you already rejected has been raised again on the same path with substantially the same content, do **not** silently re-reject it — flag it in your report as churn. A reviewer insisting on the same point twice is a signal the rejection may be wrong and the author should look.

8. Report the results. List each comment with:
   - the **file path** and **line**
   - the comment **body** (brief) and its **URL** (`html_url`)
   - the **verdict** and, for `fix`, what was changed; for `reject` and `escalate`, the recorded reason

   End with a short summary: how many were fixed, rejected, and escalated; any churn detected; and a reminder that nothing was committed, pushed, or resolved on GitHub.
