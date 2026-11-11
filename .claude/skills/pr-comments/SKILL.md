---
name: pr-comments
description: List all comments on the GitHub PR for the current branch with full details, and report the PR URL
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(git:*)
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments
  version: 2026.09.20.1816
---

List every comment on the GitHub pull request associated with the **current branch**, with details.

**Always hand back the PR link.** Every exit from this skill that found a PR ends with that PR's URL, written as a bare `https://github.com/...` URL on its own line so the terminal makes it clickable. Never substitute a PR number, a branch name, or a markdown label for the URL — the reader's next move is to open the page. Only two exits have no link, and in both no URL was ever resolved: the lookup found no PR, and the lookup itself failed. The first says plainly that the branch has no PR; the second reports the failed command and must never be phrased as "no PR".

## Steps

1. Resolve the PR for the current branch:
   ```sh
   gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --state open --json number,url -q '.[0] // empty | "\(.number)\t\(.url)"'
   ```

   `gh pr list` is the existence check, not `gh pr view`: it exits **0** whether or not a PR was found — empty output means there is none — and exits non-zero only when the query itself failed, so an outage is never reported as "no PR" (**GEN-015**). Guard the interpolation with `.[0] // empty`: a bare `.[0] | "\(.number)…"` interpolates a `null` first element into the literal line `null\tnull`, which defeats the empty-output test and carries invalid PR fields into the rest of the skill. A non-zero exit is a **failed check**, not an answer — stop and report it rather than taking the no-PR path.

   Derive `{owner}` and `{repo}` from `gh repo view --json nameWithOwner`.
   If there is no PR for the current branch, report that and stop — name the branch, since this is one of only two exits with no link to give — the other is a **failed** lookup, which reports the failed command instead of asserting that no PR exists. Otherwise print the PR URL on its own line before the listing, so the link is available without scrolling past every comment.

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
     gh api graphql -f query='
       query($owner:String!,$repo:String!,$number:Int!){
         repository(owner:$owner,name:$repo){
           pullRequest(number:$number){
             reviewThreads(first:100){
               nodes{ isResolved isOutdated path
                 comments(first:1){ nodes{ databaseId author{login} } } } } } } }
     ' -F owner={owner} -F repo={repo} -F number={number}
     ```

3. Present the results grouped by source, in chronological order within each group.
   For every comment include:
   - **author** login
   - **created/updated** timestamp
   - for inline comments: **file path** and **line** (and `in_reply_to_id` if it's a reply, so threads read in order)
   - for reviews: the review **state** (APPROVED / CHANGES_REQUESTED / COMMENTED)
   - for inline threads: **resolved / outdated** status from the GraphQL result
   - the comment **body** (verbatim)
   - the comment **URL** (`html_url`)

   Skip review entries whose body is empty AND state is COMMENTED (these are container
   records for inline-only reviews — note the count instead of listing each).

4. End with a short summary: total comments by source, and how many inline threads are unresolved. Close the report with the PR URL as a bare URL on its own line.
