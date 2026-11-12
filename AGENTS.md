# Project guidelines

Do not ask me "How is Claude doing this session?"

Do not add new dependencies without asking me first. Bundles sizes are critical
for performance for lambda functions, qwik apps, react apps and graph APIs.

The rules enforced in PR review also apply to you. See:

Be less verbose in comments. Only add comments when you have a reason to.

When you change the behavior of any command in `.claude/commands/`, also update `.claude/commands/README.md` to match.

@.github/copilot-instructions.md

## Branch naming

Every branch must be prefixed with the developer's GitHub username, as
`{username}/{name}` — e.g. `erikrj/some-branch`. The prefix makes it obvious who
owns a branch on the remote, so never create a bare `some-branch`.

Get the username from `gh api user -q .login` rather than assuming it. Keep
`{name}` short, kebab-case, and descriptive — two or three words (e.g.
`erikrj/fix-login-redirect`, not `erikrj/fix-the-login-redirect-bug-on-safari`).

## Builds must pass before you're done

A task is not complete until the affected packages actually **build** — not just typecheck. Each package's `build` runs a `prebuild` that lints and format-checks the code before compiling. Most packages use Biome (`biome check`), but some still use the legacy Prettier + ESLint prebuild (e.g. `lexavera/graph`) — check the package's `prebuild` script for which. CI runs the full build (`pnpm -r i --frozen-lockfile` then build) and fails on any prebuild (formatter/linter) or compile error. Note that `tsc --noEmit` — especially with its incremental cache — can pass while the build fails, so it is not sufficient on its own.

Before reporting any code change as done:

- Run the real build for what you changed, e.g. `pnpm --filter "<pkg>..." build` (for ClientLoop, `clientloop/scripts/pnpm.sh build`). This runs the prebuild checks too.
- Or run the package's formatter/linter directly on the files you touched — `biome check <files>` in Biome packages, `prettier --check` + `eslint` in the legacy ones (use each tool's `--write`/`--fix` to auto-fix). Do not bypass these by running `tsc` alone.
- Only say the work is done once the build — prebuild checks included — is green.

## Repository layout

This is a pnpm workspace monorepo. Each top-level folder is one of: a product/service, a shared library, infrastructure, or supporting assets. The root `README.md` lists every top-level folder and what it is — read it for the current layout.

@README.md

When you work on any project (top-level folder) in this repo, read that project's `README.md` first if it has one.

When you work on `upgility` code — especially CDK, deployment, or anything touching AWS — read `upgility/README.md` first. It documents the AWS account structure (dev/devops/stage/prod), the recommended `~/.aws/config` and `AWS_PROFILE` values, the regions, and the deployment pipeline.

Some folders carry their own `AGENTS.md` with conventions that only apply inside them; the nearest one wins. `clientloop/tools/AGENTS.md` is one — read it before writing or reviewing an operational script there, because those tools are configured by editing in-file constants rather than by environment variables or CLI flags, and that is deliberate. `clientloop/AGENTS.md` is another — read it before writing anything under `clientloop/docs`, `clientloop/ui`, or `clientloop/graph`, because the payment processor is named CLP there and never by its vendor name: on the two customer surfaces in every form, and in the graph in every comment, description, message, and test name.

When you add a new root folder to this project, also update the root `README.md` to describe it.

## Tooling

### codestat

`codestat` is a local CLI (in `codestat/`) that counts lines of code in a directory. It recursively walks the tree, honors `.gitignore`, and reports **raw** (every line) and **code** (excluding blank/comment lines) counts broken down by language — and, when a `pnpm-workspace.yaml` is present, by package and by package + language.

Run it from the repo root with `codestat [directory] [--format <text|json|markdown>]`. If `codestat` is not on `PATH`, invoke the built CLI directly: `node codestat/dist/cli.js [directory] [-f json]`. The `dist` output is not committed, so build it first if it is missing: `pnpm --filter codestat build`.

Use it when the user asks how big a service/library/folder is, for a language or per-package line-count breakdown, or to compare the size of parts of the monorepo. Prefer `--format json` when you need to parse the numbers programmatically.
