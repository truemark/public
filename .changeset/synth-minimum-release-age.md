---
"truemark-cdk-lib": patch
---

Disable pnpm's `minimumReleaseAge` publish cooldown for the `CdkPipeline` synth build (`PNPM_CONFIG_MINIMUM_RELEASE_AGE=0`). pnpm 11 defaults this to a one-day cooldown, which breaks aws-cdk-lib `NodejsFunction` bundling: that runs an isolated `pnpm install` over a copy of the workspace lockfile without the workspace's `minimumReleaseAgeExclude`, so a freshly published dependency fails the check. The synth build installs the committed, reviewed lockfile with `--frozen-lockfile`, so the cooldown adds no protection there anyway.
