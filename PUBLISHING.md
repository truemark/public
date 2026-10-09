# Publishing packages

This repository uses Changesets to choose package versions and generate changelogs. Contributors commit a changeset with their changes; GitHub Actions handles publishing. You do not need a lead to publish the library manually.

## Add a changeset to your PR

Run these commands from the repository root using the pnpm version declared in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm exec changeset
```

Select the affected package by its `package.json` name (for example, `truemark-cdk-lib` for `cdk/`), choose the release type, and enter a user-facing summary.

| Release type | Use for |
| --- | --- |
| `patch` | Backward-compatible fixes |
| `minor` | Backward-compatible new functionality |
| `major` | Breaking changes requiring consumers to migrate |

Changesets creates a Markdown file in `.changeset/`. An example for a new library feature is:

```md
---
"truemark-cdk-lib": minor
---

Add NextGen OpenSearch Serverless collection groups with scale-to-zero support.
```

Use package names, not directory names. A changeset can list multiple affected packages. Include migration guidance when introducing a breaking change. Changesets combines pending changesets when calculating each package's release; you do not manually increment `package.json` versions.

Review the release plan and validate the changes:

```sh
pnpm exec changeset status
pnpm -r build
pnpm -r test
git add <changed-files> .changeset/<generated-file>.md
git commit -m "Describe the change"
git push
```

Open a PR targeting `main` with both the implementation and its changeset. For a documentation follow-up to an unpublished feature, keep that feature's actual package changeset in the PR; this guide itself is not a separate publishable package.

## What CI publishes

The entry point is [publish.yml](.github/workflows/publish.yml), which calls [javascript-library-v2.yml](.github/workflows/javascript-library-v2.yml). It runs on PRs targeting `main`, pushes to `main`, and manual dispatch. Ordinary pushes to other branches without a PR do not trigger this entry point.

The default test matrix uses Node.js 20, 22, and 24. Only the Node.js 24 job versions and publishes packages.

### PR snapshots

For non-Dependabot PRs targeting `main`, CI runs:

```sh
pnpx @changesets/cli version --snapshot snapshot
# Build and test affected workspace packages.
pnpx @changesets/cli publish --tag snapshot --no-git-tag
```

This publishes prerelease packages under the npm `snapshot` tag after successful build and test steps. It does not commit snapshot versions back to the PR branch. Test a published snapshot in a consumer project with:

```sh
pnpm add truemark-cdk-lib@snapshot
```

The tag can move when another PR publishes. Use the exact version from the workflow output when you need a reproducible test.

### Releases from main

After merging the PR, CI runs `pnpx @changesets/cli version`, builds and tests the full workspace, commits and pushes the version/changelog changes as `Publish packages`, publishes with `pnpx @changesets/cli publish`, and pushes release tags. Versioning consumes the pending changeset files. The version commit includes `[skip ci]` to avoid starting another release run.

This workflow releases directly from `main`; it does not create a separate version-packages PR. Check the Actions run and npm package version to confirm publication. A manual workflow run on `main` also follows the release path.

## Authentication and package setup

CI uses npm trusted publishing through GitHub OIDC (`id-token: write`). Repository administrators configure each npm package's trusted publisher with GitHub owner `truemark`, repository `public`, and workflow `publish.yml`, as recorded in [.changeset/README.md](.changeset/README.md). That README also specifies the npm setting “Require two-factor authentication and disallow tokens.” The release workflow uses the `RELEASE_BOT_ID` and `RELEASE_BOT_KEY` repository secrets for its GitHub App operations.

Contributors using the PR workflow do not need to run `publish` locally. The local snapshot commands in `.changeset/README.md` are a manual alternative requiring separate npm authorization; they are not required for normal PR publishing. Its final `git reset --hard HEAD` discards tracked local edits, so do not copy that cleanup command into a working checkout with changes you want to keep.

## Troubleshooting

- **“No unreleased changesets found” during snapshot versioning:** ensure the PR contains a pending `.changeset/*.md` file with valid package frontmatter. The directory's README does not count. If a previous release consumed the file, add a new changeset for the new unpublished work. The current snapshot workflow has no empty-changeset skip step.
- **Build or test failure:** fix the failing checks before expecting publication. On PRs, builds include affected packages, their dependents, and dependencies; tests include affected packages and their dependents.
- **npm authorization failure:** check the package's trusted-publisher configuration and the Actions logs. Changing a local npm token does not repair CI's OIDC configuration.
- **Version commit exists but publication failed:** check the publish step and npm before retrying. Versioning and publishing are separate steps; a version commit alone does not prove the package was published.

See [.changeset/config.json](.changeset/config.json) for the release configuration: `main` is the base branch, package access is public, no packages are ignored, and packages are not configured as fixed or linked release groups.
