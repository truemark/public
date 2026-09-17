---
name: skills-update
description: Update every installed skill and other tracked files (e.g. copilot-instructions.md) from each file's authoritative source URL in its metadata
allowed-tools: Bash(gh:*), Bash(jq:*), Bash(mkdir:*), Bash(git:*), Read, Write, Glob
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/skills-update
  version: 2026.07.26.0811
---

Refresh every installed skill — **and** the repository's other tracked
distributed files — from its **authoritative source**. Each `SKILL.md` (and each
tracked file, such as `.github/copilot-instructions.md`) carries a
`metadata.source` URL pointing at where it was published from. This skill walks
every tracked item, re-downloads its source, and overwrites the local copy so it
matches the source exactly:

- A **skill** source is a GitHub **tree** URL (a directory). Re-download the
  **entire** directory — the `SKILL.md` **and** all related files (references,
  scripts, assets, nested folders).
- A **tracked file** source is a GitHub **blob** URL (a single file). Re-download
  just that one file to its path in the repository.

This skill only writes files into the working tree — it does **not** commit,
push, or touch git history. Review the resulting diff yourself and commit when
happy.

**Update everything tracked, not a subset.** Invoking this skill means refresh
all installed skills that declare a source **and** every tracked file. Do not
pick and choose. If the user names specific items in the same request, limit to
those; otherwise do them all.

## Assumptions & guards

- Requires an authenticated GitHub CLI (`gh auth status`). If `gh` is not
  authenticated, stop and tell the user to run `gh auth login`.
- Only `github.com` URLs are supported — a `/tree/` URL for a skill directory or
  a `/blob/` URL for a tracked file. If a `source` points at a different host (or
  is neither a `/tree/` nor a `/blob/` URL), skip it and report it as
  **unsupported** — do not guess how to fetch it.
- The fetch is **authoritative-wins**: local files are overwritten with the source
  version. Files that exist locally but are **absent from the source** are **not**
  deleted automatically — they are reported as **stale** so the user can decide.

## Steps

1. Locate the skills directory and the repo root. This skill lives at
   `<SKILLS_DIR>/skills-update/SKILL.md`, so `SKILLS_DIR` is the parent of this
   skill's own directory — the directory that holds every `<name>/SKILL.md`. Use
   the skill's base directory to resolve it; do not hardcode a path. Resolve the
   repository root too (`git rev-parse --show-toplevel`) — tracked files are
   written relative to it.

2. Build the list of tracked items to refresh:
   - **Skills** — every immediate subdirectory of `SKILLS_DIR` that contains a
     `SKILL.md`:
     ```sh
     ls -d "$SKILLS_DIR"/*/SKILL.md
     ```
   - **Tracked files** — standalone files that carry their own `metadata.source`
     frontmatter but are not a skill's `SKILL.md`. Currently these are:
     - `<repo-root>/.github/copilot-instructions.md`
     - `<SKILLS_DIR>/ERIKRJ_SKILLS_README.md`

     Include a tracked file only if it exists locally; note any that are missing.
     (This list is intentionally explicit — these files are not discovered by the
     `<name>/SKILL.md` walk, even when they sit inside `SKILLS_DIR`.)

3. For each item (a skill's `SKILL.md` or a tracked file), extract its
   `metadata.source`. It is the `source:` line nested under the `metadata:` key in
   the YAML frontmatter:
   ```sh
   src=$(awk '
     /^metadata:/      {inmeta=1; next}
     inmeta && /^[^[:space:]]/ {inmeta=0}
     inmeta && /^[[:space:]]+source:[[:space:]]/ {
       sub(/^[[:space:]]+source:[[:space:]]*/, ""); print; exit
     }' "$skill_md")
   ```
   - If there is no `source`, skip the item and report it as **no-source**.

4. Parse the GitHub URL and note its **kind**. Split on `/`: `OWNER` and `REPO`
   are the two segments after `github.com`, the next segment is the **kind**
   (`tree` or `blob`), the segment after that is `REF`, and everything after `REF`
   is `PATH`.
   - A **`tree`** URL (`https://github.com/<OWNER>/<REPO>/tree/<REF>/<PATH...>`)
     means `PATH` is a **directory** (a skill), e.g. `.claude/skills/branch-clean`.
   - A **`blob`** URL (`https://github.com/<OWNER>/<REPO>/blob/<REF>/<PATH...>`)
     means `PATH` is a **single file** (a tracked file), e.g.
     `.github/copilot-instructions.md`.

   Assume `REF` is a **single** segment (e.g. `main`); if the branch name itself
   contains slashes the parse is ambiguous — skip and report it as
   **unsupported**. A URL that is neither `tree` nor `blob`, or not on
   `github.com`, is also **unsupported**.

5. Fetch and write the source, depending on the kind:

   - **`tree` (skill directory).** List every file under `PATH` in one call with
     the recursive Git-tree API, keeping only the blobs under `PATH`:
     ```sh
     gh api "repos/$OWNER/$REPO/git/trees/$REF?recursive=1" \
       --jq ".tree[] | select(.type==\"blob\") | .path" \
       | grep -E "^$(printf '%s' "$PATH" | sed 's/[.[\*^$/]/\\&/g')(/|$)"
     ```
     An empty list means the directory does not exist at that ref — report the
     item as **source-missing** and move on (do not delete anything locally). For
     each source blob, compute its path **relative** to `PATH` (strip the `PATH/`
     prefix) and write it into the local skill directory, creating parent dirs:
     ```sh
     rel=${blob#"$PATH"/}
     dest="$skill_dir/$rel"
     mkdir -p "$(dirname "$dest")"
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/$OWNER/$REPO/contents/$blob?ref=$REF" > "$dest"
     ```

   - **`blob` (tracked file).** Download just that one file and write it to
     `<repo-root>/$PATH` (its path is already repo-relative), creating parent dirs:
     ```sh
     dest="$REPO_ROOT/$PATH"
     mkdir -p "$(dirname "$dest")"
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/$OWNER/$REPO/contents/$PATH?ref=$REF" > "$dest"
     ```
     A `404` means the file does not exist at that ref — report it as
     **source-missing** and leave the local copy untouched.

   Write every file **exactly** as fetched — do not reformat, re-wrap, or "fix"
   the content. The source is authoritative.

6. For a **skill** directory, detect **stale** local files — files under the local
   skill directory that were **not** in the source blob list. Report them; do
   **not** delete them unless the user asks you to prune. (A common stale file is
   an intentional local rename or a local-only note.) Tracked single files have no
   stale-file concept.

7. Move to the next item and repeat. Note two things while iterating:
   - **Self-update.** If `skills-update` itself is refreshed, its `SKILL.md` is
     rewritten on disk mid-run. The instructions already loaded for *this* run are
     unaffected; the new version takes effect next time.
   - Keep going if one item fails (network error, missing source) — collect the
     failure and continue so one bad source does not abort the whole update.

8. Report the result as a per-item summary (skills and tracked files together).
   For each item list one of:
   - **updated** — files fetched and written (note how many, and if any nested
     related files were included);
   - **unchanged** — fetched, but identical to what was already on disk;
   - **no-source** — no `metadata.source`, skipped;
   - **unsupported** — non-github.com or a URL that is neither `tree` nor `blob`;
   - **source-missing** — the source directory/file did not exist at that ref;
   - **failed** — an error occurred (include the error).

   Then summarize the whole run: which files changed (a `git status --short` /
   `git diff --stat` is the clearest way to show it), any **stale** files you
   flagged, and a reminder that **nothing was committed or pushed** — the user
   should review the diff and commit when satisfied.
