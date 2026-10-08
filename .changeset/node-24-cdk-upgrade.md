---
'truemark-cdk-lib': minor
---

Upgrade to the latest stable AWS CDK and standardize on the Node.js 24 Lambda runtime.

- `aws-cdk-lib` moves to `^2.272.0`, `constructs` to `^10.8.1`, the CDK alpha modules to
  `^2.272.0-alpha.0`, and `cdk-monitoring-constructs` to `10.3.1`.
- `ExtendedNodejsFunction` now defaults to `Runtime.NODEJS_24_X` (was `NODEJS_22_X`).
  Functions that do not set `runtime` explicitly will be updated on the next deployment.
  Pass `runtime: Runtime.NODEJS_22_X` to keep the previous behavior.
- The internal custom-resource functions behind `KnowledgeBaseCollectionIndex` and
  `PriorityAllocator` move from `Runtime.NODEJS_20_X` to `Runtime.NODEJS_24_X`.
- `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, the metric
  `IQueue` gained in `aws-cdk-lib` 2.272.0.
- The library's TypeScript `target` moves from `ES2018` to `ES2022`.
