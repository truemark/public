# Publishing

This repository uses [changesets](https://github.com/changesets/changesets) to decide when a
release happens and whether it is a **major**, **minor**, or **patch** bump. Versions are never
edited by hand — you describe your change in a changeset file, and CI does the rest when the PR
merges to `main`.

If you only read one thing: **every PR that touches a package needs a changeset, or CI fails.**

- [What gets published](#what-gets-published)
- [The short version](#the-short-version)
- [Writing a changeset](#writing-a-changeset)
- [Choosing a bump level](#choosing-a-bump-level)
- [Having Claude write the changeset](#having-claude-write-the-changeset)
- [What CI does](#what-ci-does)
- [Publishing manually](#publishing-manually)
- [Troubleshooting](#troubleshooting)

## What gets published

This is a pnpm workspace. The packages are declared in `pnpm-workspace.yaml`:

| Package | Directory | Published to npm? |
|---|---|---|
| `truemark-cdk-lib` | `cdk/` | **Yes** — public |
| `autobackup` | `autobackup/` | No — `"private": true` |
| `aws-workspaces` | `blueprints/aws-workspaces/` | No — `"private": true` |

Only `truemark-cdk-lib` reaches the registry. The private packages still take version bumps and
still get `CHANGELOG.md` entries if you name them in a changeset, which is useful for history —
changesets simply skips publishing them.

## The short version

```bash
# 1. Make your change on a branch, then:
pnpm changeset          # interactive prompt: pick packages, pick bump, write the summary

# 2. Commit the generated file alongside your code
git add .changeset/*.md
git commit -m "Add changeset for <whatever you changed>"
git push
```

That's it. Open the PR as normal. On merge to `main`, CI versions, tags, publishes, and pushes a
`Publish packages` commit back to `main`.

`pnpm changeset` maps to `pnpx @changesets/cli` (see the root `package.json`). `@changesets/cli` is
also a root dev dependency, so `pnpm exec changeset` runs the pinned version without a download —
handy for `pnpm exec changeset status`, which shows what is currently queued for release.

## Writing a changeset

A changeset is a Markdown file in `.changeset/` with YAML frontmatter. The interactive prompt
generates one with a random name (`tidy-pugs-shake.md`); renaming it to something descriptive is
encouraged, and writing one by hand is perfectly fine.

```markdown
---
'truemark-cdk-lib': minor
---

Add NAT instance and IPv6 support to `aws-vpc` (#483).

- **New `NatInstance` construct** — a self-managed, ASG-backed NAT instance with a dedicated
  ENI, offered as a lower-cost alternative to a managed NAT Gateway.
- **`NatType` gains `'natInstance'`** — `StandardNetwork` points private subnet route tables
  at its ENI when selected.
```

Rules of the format:

- The frontmatter maps **package name** (from its `package.json`, not the directory) to a bump
  level. List several packages if a change spans them.
- Everything below the frontmatter becomes the `CHANGELOG.md` entry verbatim. Write it for a
  consumer upgrading the library, not for a reviewer reading the diff.
- Multiple changesets can sit in `.changeset/` at once. They accumulate across PRs and are all
  consumed by the next release, which takes the **highest** bump level requested.
- One changeset can cover several PRs. If work merged without one and has not been released yet,
  a later changeset can describe it — check `git log` for the most recent `Publish packages`
  commit to see what is still unreleased.

Good changeset bodies mention the construct, prop, or export by name, say what a consumer should
do differently, and call out anything that changes behavior on an existing deployment.

## Choosing a bump level

| Level | Use when | Example |
|---|---|---|
| `patch` | Bug fix, docs, internal refactor. No API change. | Fix a log group name collision |
| `minor` | New construct, new prop, new export. Backwards compatible. | Add `StandardNetwork` |
| `major` | Removal or incompatible change to a published API. | Remove a construct |

Repository conventions:

- `truemark-cdk-lib` has stayed on `1.x`, and new features ship as **minor**. Reach for `major`
  only after a deliberate decision — it is not the automatic answer to "this is breaking."
- A changed **default** on an already-released construct is a behavior change even though the
  types still compile. Ship it as `minor` if that is the call, but document it loudly in the
  changeset body with the explicit opt-out. For example, when `StandardNetwork`'s `azCount`
  default moved from `2` to `3`, the changeset said so and told consumers to pin `azCount: 2` to
  keep the previous topology.
- Changes that touch no package — CI workflows, `CODEOWNERS`, root config, this file — do not
  need a changeset on their own merits. See the note in [Troubleshooting](#troubleshooting) about
  CI still requiring one.

## Having Claude write the changeset

Claude Code is good at this, and the changelog quality is noticeably better than what most of us
write by hand at the end of a long PR. The useful prompt gives it the diff to read:

> Write a changeset for the changes on this branch. Check the diff against `main` and the merged
> code, pick the bump level, and describe it for a consumer upgrading the library.

What to expect, and what to check:

- **Point it at merged code, not the PR description.** PR bodies go stale. The `nat-instance` PR
  body described a `nat_instance` nat type and a `t4g.nano` default; by the time it merged, later
  commits had renamed it to `natInstance` and bumped the default to `t4g.micro`. A changeset
  written from the body would have shipped two wrong facts into the public changelog.
- **Ask it to check whether prior work is unreleased.** `git log main` and the last
  `Publish packages` commit tell it whether earlier merges still need covering.
- **Verify the bump level yourself.** Claude will usually propose something reasonable, but
  `minor` vs `major` is a judgment call about your consumers, and it is the one thing in the file
  that changes what npm does.
- **Verify package names and prop names against the source.** These end up in a published
  changelog that people search.

Finish with `pnpm exec changeset status` to confirm the right packages are queued at the right
level before you commit.

## What CI does

`.github/workflows/publish.yml` runs on every PR to `main`, every push to `main`, and manual
dispatch. It calls the reusable `javascript-library-v2.yml`, which builds and tests across a
Node matrix of **20, 22, and 24**. Node **24** is the designated publish version, so the
changeset steps run only on that leg — which is why a changeset problem shows up as the node 24
job failing while 20 and 22 pass.

### On a pull request

1. Install, then `changesets version --snapshot snapshot`. This rewrites versions to
   `0.0.0-snapshot-<timestamp>`.
2. Build and test, scoped to the packages affected by the diff against the base branch plus their
   dependents.
3. `changesets publish --tag snapshot --no-git-tag` — publishes a throwaway prerelease under the
   `snapshot` dist-tag so the PR's build can be installed and tried out.

Snapshot publishing is skipped for Dependabot PRs.

### On merge to `main`

1. `changesets version` — consumes every file in `.changeset/`, applies the version bumps, and
   writes the `CHANGELOG.md` entries.
2. Build and test the full workspace.
3. Commit the result as `Publish packages` with `[skip ci]` and push it back to `main`.
4. `changesets publish` — publishes to npm under the `latest` tag.
5. `git push --follow-tags` to push the release tags.

Publishing authenticates to npm with OIDC; there are no npm tokens in this repository. The
`Publish packages` commit is made by a GitHub App, which is why the version bump can push to a
protected branch.

## Publishing manually

Normally you do not need this — merging to `main` is the release mechanism. The
[`.changeset/README.md`](.changeset/README.md) documents the manual snapshot flow for when you
want to try a build against a real registry install before opening a PR:

```bash
pnpm -r i
pnpm -r build
pnpx @changesets/cli
git add <changeset file and other files>
git commit
pnpx @changesets/cli version --snapshot snapshot
pnpm -r build
pnpm -r test
pnpx @changesets/cli publish --tag snapshot --no-git-tag
git reset --hard HEAD
```

The closing `git reset --hard HEAD` matters: `version --snapshot` rewrites `package.json` files in
place, and those edits must never be committed. Only CI's `Publish packages` commit should contain
version bumps.

## Troubleshooting

**`No unreleased changesets found.` and the node 24 job fails.**
The PR has no changeset. `changesets version --snapshot snapshot` exits `1` when `.changeset/`
contains nothing but `config.json` and `README.md`. Node 20 and 22 pass because they never reach
that step. Add a changeset and push.

This bites PRs that genuinely change no package — a workflow tweak, a `CODEOWNERS` edit. The
current workaround is a `patch` changeset against the package nearest the change, which does mean
publishing a version with no functional difference. Worth knowing before you wonder why a
one-line `CODEOWNERS` PR is red.

**My package did not get published.**
Check for `"private": true` in its `package.json`. `autobackup` and `aws-workspaces` are private
by design and will version but never publish.

**The release came out at the wrong level.**
`changesets version` takes the highest bump across all queued changesets. If an unrelated
changeset sitting in `.changeset/` asked for `minor`, your `patch` rides along with it.
`pnpm exec changeset status` before merging shows exactly what is queued.

**I need to change a changeset after pushing.**
Edit the file and push again. Nothing is consumed until the merge to `main`, so changesets are
freely editable right up to that point.
