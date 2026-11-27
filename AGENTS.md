# Project guidelines

Do not ask me "How is Claude doing this session?"

Do not add new dependencies without asking me first. Bundle sizes are critical
for performance for lambda functions, and every dependency of `truemark-cdk-lib`
is passed on to its consumers. Never add dependencies to the root `package.json`;
add them to the package that needs them, and pin shared versions through the
`catalog` in `pnpm-workspace.yaml`.

Be less verbose in comments. Only add comments when you have a reason to.

## Rules and workflow skills come from the playbook

The numbered rules enforced in PR review (**GEN-014**, **TS-009**, **CDK-002** and
the rest) also apply to you. They are served by the `dev` MCP server at
`https://devplaybook.nr1e.com`, which `.mcp.json` registers. They are not copied
into this repository.

- Before you write or review code, call `rules_for_files` with the paths you are
  touching, then `get_rules` for the full text of the rules it lists. Use
  `search_rules` when a question is not tied to a path.
- Cite the rule code when you flag a violation, and follow the review discipline
  in the server's instructions.
- The workflow skills (`pr-open`, `commit`, `rebase` and the others) are served
  by the same server. Claude Code lists them under the server name, as
  `/dev:pr-open`.
- If the server's tools are unavailable, say so instead of working from memory.

The source for both is `mcp-dev-playbook/` in the `nr1etech/nr1e` repository:
change a rule or a served skill there, not here. A skill that only applies to
this repository goes in `.claude/skills` and is edited here.

## Work lands on the branch that is already checked out

When a feature branch is checked out and I ask for a change without asking for a
new branch, the change is for that branch. Put it there. There is nothing to infer
here and nothing to ask about — the open branch is the answer.

This holds when the change looks unrelated to what the branch is about. A pipeline
fix during a construct branch, a config tweak during a refactor, a one-line
correction to a file the branch has never touched: all of them go on the open
branch. Whether unrelated work deserves a branch of its own is my call, and I make
it by asking for one. Deciding it for me — however reasonable the reasoning — is
the thing not to do.

Cut a new branch only when I ask for one, or when there is no feature branch to
land on because `main` is checked out, which is what `/dev:pr-open` and
`/dev:branch-clean` are for.

The two mistakes cost very different amounts. Work put on the open branch is one
`git cherry-pick` from being split out later. Work put on a branch of its own is
work I do not find in the PR I am reviewing, and moving it afterwards means
rewriting two branches instead of one. So when in doubt, use the open branch.

Adding unrelated work to an open branch does mean its pull request now describes
more than it did. This repository squash-merges, so the title and body become the
commit on `main` — update both to cover what was added (**GEN-013**), rather than
leaving a reviewer to find it in the diff.

## Branch naming

Every branch must be prefixed with the developer's GitHub username, as
`{username}/{name}` — e.g. `erikrj/some-branch`. The prefix makes it obvious who
owns a branch on the remote, so never create a bare `some-branch`.

Get the username from `gh api user -q .login` rather than assuming it. Keep
`{name}` short, kebab-case, and descriptive — two or three words (e.g.
`erikrj/fix-login-redirect`, not `erikrj/fix-the-login-redirect-bug-on-safari`).

## Builds must pass before you're done

A task is not complete until the affected packages actually **build** — not just
typecheck. Each package's `build` runs a `prebuild` that format-checks and lints
the code before compiling: `biome check` in most packages, and
`prettier --check . && eslint .` in the ones that have not migrated yet
(`autoalarm/*` and `autostate/*`). CI fails on any prebuild (formatter/linter) or
compile error. `tsc --noEmit` — especially with its incremental cache — can pass
while the build fails, so it is not sufficient on its own.

Before reporting any code change as done:

- Run the real build for what you changed, e.g. `pnpm --filter "<pkg>..." build`.
  This runs the prebuild checks too.
- Or run the package's checker directly on the files you touched: `biome check`
  (`biome check --write` to auto-fix), or `prettier --check` and `eslint`
  (`prettier --write` / `eslint --fix`) in a package still on them. Do not bypass
  these by running `tsc` alone.
- Only say the work is done once the build — prebuild checks included — is green.

## Every package change needs a changeset

Releases are driven by changesets, and versions are never edited by hand. A pull
request that touches a package needs a changeset file in `.changeset/`, or CI
fails. `PUBLISHING.md` explains how to write one and how to choose the bump
level — read it before you add one. A change that touches no package (docs,
workflows, agent configuration) does not need one.

## Repository layout

This is a pnpm workspace monorepo. Each top-level folder is a deployable
automation, the published `truemark-cdk-lib` library, or a blueprint. The root
`README.md` lists the top-level folders and what each one is — read it for the
current layout.

@README.md

When you work on any project (top-level folder) in this repo, read that project's
`README.md` first if it has one.

Some folders carry their own `AGENTS.md` or `CLAUDE.md` with conventions that only
apply inside them; the nearest one wins. `autoalarm/CLAUDE.md` is one — read it
before working in that folder, and before running any AutoAlarm test, because it
sets the guardrails for what a test run may create and destroy.

When you add a new root folder to this project, also update the root `README.md`
to describe it.
