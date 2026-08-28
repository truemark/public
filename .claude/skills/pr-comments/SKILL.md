---
name: pr-comments
description: List all comments on the GitHub PR for the current branch, with full details
allowed-tools: Bash(gh:*), Bash(jq:*)
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/pr-comments
  version: 2026.07.15.1923
---

List every comment on the GitHub pull request associated with the **current branch**, with details.

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

4. End with a short summary: total comments by source, and how many inline threads are unresolved.
