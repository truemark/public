# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

-   Moved into the [truemark/public](https://github.com/truemark/public) monorepo as `autostate/`. `cdk` and `handlers` are now pnpm workspace packages: versions come from the workspace catalog and `truemark-cdk-lib` is linked from the workspace. The cdk tests run under vitest instead of jest. The packages are private.

## [1.2.0]

### Changed

-   Moved to Node 20 runtime
-   Moved from GTS to standard eslint and prettier config
-   Moved cdk to cdk folder
-   Moved to ES modules for handlers
