---
name: codereview
description: Review a path against CLAUDE.md and copilot-instructions.md rules and record violations in CODEREVIEW.md
allowed-tools: Bash(git:*), Bash(rg:*), Bash(ls:*), Bash(find:*), Read, Edit, Write, Grep, Glob
disable-model-invocation: true
arguments: [path]
metadata:
  owner: Erik Jensen (@erikrj)
  source: https://github.com/erikrj/public/tree/main/.claude/skills/codereview
  version: 2026.07.15.1923
---

Review every source file under `$path` against the repository's review rules and report the violations you find. `$path` is a directory (relative to the repo root or absolute) that is scanned **recursively**. The whole repository is too large to review at once, so this skill is always scoped to a single path — review only what is under `$path`.

If `$path` is empty or does not exist, stop and ask for a directory to review. Do **not** default to the repo root.

## Steps

1. Load the rules. Read both rule sources in full before reviewing anything:
   - `CLAUDE.md` (project guidelines and repository layout).
   - `.github/copilot-instructions.md` (the numbered rule codes: `GEN-`, `TS-`, `PY-`, `GQL-`, `CDK-`, `QWIK-`, `LIT-`).

   Treat the numbered rule codes as the authoritative checklist. Follow the same review discipline `.github/copilot-instructions.md` mandates: cite the rule code on every violation, flag rather than rewrite, and do not invent rules or flag subjective style not tied to a rule code.

2. Enumerate the files to review under `$path`. Respect `.gitignore` — only review tracked or trackable source files (use `git ls-files -co --exclude-standard -- $path`, which lists both tracked and untracked-but-not-ignored files, or `rg --files $path` which honors `.gitignore`). Skip `node_modules`, `dist`, build output, lockfiles, and binary assets.

3. Review each file. For every violation, capture:
   - the **rule code** (e.g. `TS-001`),
   - the **file path** (relative to the repo root) and **line number(s)**,
   - a one-line description of the violation and the **minimal fix** the rule calls for.

   Only report genuine violations of a cited rule. When a file could plausibly comply or violate depending on context not visible in the file, note it as uncertain rather than asserting a violation. This skill **reports** — it does not edit the reviewed code.

4. Print the findings for this run to the console, grouped by file, each line citing its rule code, location, and the fix. If there are no violations under `$path`, say so explicitly.

5. Update `CODEREVIEW.md` in the repo root to reflect the current state under `$path`:
   - If `CODEREVIEW.md` does not exist, create it with the header described below.
   - **Reconcile only the paths you reviewed this run.** Replace every previously recorded finding whose file is under `$path` with the findings from this run. Any old finding under `$path` that you did not re-find this run is now fixed or gone — **remove it**. Leave findings for files outside `$path` untouched (they were not reviewed this run).
   - Keep findings organized by file path, each entry showing the rule code, line number, and description, so the file reads as the current outstanding-violations backlog.
   - If reconciling leaves no findings at all, keep the header and state that there are currently no recorded violations.

6. Report a short summary to the console: how many files were reviewed under `$path`, how many violations were found this run, and how many stale findings were removed from `CODEREVIEW.md`.

## CODEREVIEW.md header

`CODEREVIEW.md` must begin with a short description block (above the findings) explaining its purpose to developers, in substance:

> This file is the outstanding code-review backlog for the repository. It records violations of the rules in `CLAUDE.md` and `.github/copilot-instructions.md`, found by the `codereview` skill. Each entry cites the rule code, file, line, and the fix required. Findings are scoped to the path each `codereview` run was given; entries are removed automatically once a rerun no longer finds them. It is generated — fix the code and rerun `codereview <path>` rather than editing this file by hand.

Keep the wording concise; do not add per-file boilerplate or copyright headers (that would itself violate **GEN-001**).
