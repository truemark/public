---
"truemark-cdk-lib": patch
---

Disable pnpm's `minimumReleaseAge` publish cooldown for the `CdkPipeline` synth build (`PNPM_CONFIG_MINIMUM_RELEASE_AGE=0`). pnpm 11 defaults this to a one-day cooldown, which breaks aws-cdk-lib `NodejsFunction` bundling: that runs an isolated `pnpm install` over a copy of the workspace lockfile without the workspace's `minimumReleaseAgeExclude`, so a freshly published dependency fails the check.

The default pnpm synth commands now run `pnpm exec cdk synth` instead of `pnpx cdk synth`, so the synth uses the project's lockfile-installed `aws-cdk` CLI rather than downloading the latest `cdk` package from the registry on every build. With that change the default commands only install from the committed lockfile (`--frozen-lockfile`), so the cooldown adds no protection there. Projects using the default pnpm commands must list `aws-cdk` as a dependency. Custom `commands` that resolve packages outside the lockfile (e.g. `pnpm dlx`) also run without the cooldown.
