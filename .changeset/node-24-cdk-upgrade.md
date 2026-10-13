---
'truemark-cdk-lib': minor
---

Upgrade to the latest stable AWS CDK and move Lambdas to Node.js 24.

- `aws-cdk-lib` moves to `^2.272.0`, `constructs` to `^10.8.1`, the CDK alpha modules to
  `^2.272.0-alpha.0`, and `cdk-monitoring-constructs` to `10.3.1`.
- The internal custom-resource functions behind `KnowledgeBaseCollectionIndex` and
  `PriorityAllocator` move from `Runtime.NODEJS_20_X` to `Runtime.NODEJS_24_X`. Both
  handlers are `async`, so they are unaffected by the Node 24 handler changes.
- **`ExtendedNodejsFunction`'s default runtime moves from `Runtime.NODEJS_22_X` to
  `Runtime.NODEJS_24_X`.** `nodejs24.x` removes callback-based handlers along with
  `context.succeed`/`fail`/`done` and `context.callbackWaitsForEmptyEventLoop`. Functions whose
  handlers still use a callback signature or those APIs must migrate to `async` handlers, or pin
  `runtime: Runtime.NODEJS_22_X` until they do. Handlers that are already `async` need no change.
- The default OpenTelemetry collector layer pin moves from `:1` to `:6`. This only affects
  functions with `otel.enabled`; consumers setting `otel.layerVersionArn` are unaffected.
- `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, the metric
  `IQueue` gained in `aws-cdk-lib` 2.272.0.
- The library's TypeScript `target` moves from `ES2018` to `ES2022`.
