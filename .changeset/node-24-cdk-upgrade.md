---
'truemark-cdk-lib': minor
---

Upgrade to the latest stable AWS CDK and move internal Lambdas to Node.js 24.

- `aws-cdk-lib` moves to `^2.272.0`, `constructs` to `^10.8.1`, the CDK alpha modules to
  `^2.272.0-alpha.0`, and `cdk-monitoring-constructs` to `10.3.1`.
- The internal custom-resource functions behind `KnowledgeBaseCollectionIndex` and
  `PriorityAllocator` move from `Runtime.NODEJS_20_X` to `Runtime.NODEJS_24_X`. Both
  handlers are `async`, so they are unaffected by the Node 24 handler changes.
- `ExtendedNodejsFunction` keeps `Runtime.NODEJS_22_X` as its default. `nodejs24.x` removes
  callback-based handlers and `context.succeed`/`fail`/`done`/`callbackWaitsForEmptyEventLoop`,
  and the ADOT Node.js layer this construct attaches by default
  (`aws-otel-nodejs-<arch>-ver-1-30-2`) does not yet support `nodejs24.x`. Opt in per function
  with `runtime: Runtime.NODEJS_24_X` once your handlers are `async` and, if you use
  `otel.useOtelWrapper`, once ADOT ships a Node 24 compatible layer.
- `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, the metric
  `IQueue` gained in `aws-cdk-lib` 2.272.0.
- The library's TypeScript `target` moves from `ES2018` to `ES2022`.
