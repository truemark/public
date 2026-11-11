---
"truemark-cdk-lib": minor
---

Add OpenSearch Serverless collection and collection group constructs with NextGen scale-to-zero support, shared group references, encryption and network configuration, access grants, and optional index provisioning. Validate generation-specific configuration and order index creation after data access policies.

Upgrade aws-cdk-lib to 2.260.0 for NextGen collection group support. This raises the
peer floor to 2.260.0, which also changes the runtime CDK picks for its internal
LogRetention helper function from `nodejs22.x` to `nodejs24.x` — visible in the
StandardPostgresAuroraServerlessCluster snapshots. That runtime is chosen by
aws-cdk-lib itself (`determineLatestNodeRuntimeName`) and synthesized as a literal
with no per-region CloudFormation mapping, so any stack that sets
`cloudwatchLogsRetention` gets `nodejs24.x` in every region it deploys to.
