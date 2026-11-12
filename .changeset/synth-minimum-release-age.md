---
"truemark-cdk-lib": patch
---

Disable pnpm's `minimumReleaseAge` publish cooldown for the `CdkPipeline` synth build (`PNPM_CONFIG_MINIMUM_RELEASE_AGE=0`). pnpm 11 defaults this to a one-day cooldown, which breaks aws-cdk-lib `NodejsFunction` bundling: that runs an isolated `pnpm install` over a copy of the workspace lockfile without the workspace's `minimumReleaseAgeExclude`, so a freshly published dependency fails the check.

The default pnpm synth commands now run `pnpm exec cdk synth` instead of `pnpx cdk synth`, so the synth uses the project's lockfile-installed `aws-cdk` CLI rather than downloading the latest `cdk` package from the registry on every build. Projects using the default pnpm commands must list `aws-cdk` as a dependency.

With that change the workspace install (`--frozen-lockfile`) and the CDK CLI resolve no new versions. `NodejsFunction` bundling still can: its isolated install passes `--no-prefer-frozen-lockfile` over a generated `package.json`, so it may resolve versions outside the reviewed lockfile (within the declared ranges), and with this change it does so without the cooldown. Custom `commands` that resolve packages outside the lockfile (e.g. `pnpm dlx`) also run without the cooldown. Pin bundled `nodeModules` to exact versions where that matters.
