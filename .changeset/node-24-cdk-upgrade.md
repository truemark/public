---
'truemark-cdk-lib': major
---

Upgrade to the latest stable AWS CDK and move Lambdas to Node.js 24.

**Breaking — `ExtendedNodejsFunction` now defaults to `Runtime.NODEJS_24_X`** (previously
`Runtime.NODEJS_22_X`). `nodejs24.x` removes callback-based handlers along with
`context.succeed`, `context.fail`, `context.done` and
`context.callbackWaitsForEmptyEventLoop`. A function whose handler still uses a callback
signature or those APIs will therefore break on its next deploy without any change of its own.
Migrate those handlers to `async`, or pin `runtime: Runtime.NODEJS_22_X` to keep the previous
behaviour. Handlers that are already `async` need no change.

**Breaking — the default OpenTelemetry collector layer pin moves from `:1` to `:6`.** This
only affects functions with `otel.enabled`; consumers setting `otel.layerVersionArn` are
unaffected.

Other changes:

- `aws-cdk-lib` moves to `^2.272.0`, `constructs` to `^10.8.1`, the CDK alpha modules to
  `^2.272.0-alpha.0`, and `cdk-monitoring-constructs` to `10.3.1`.
- The internal custom-resource functions behind `KnowledgeBaseCollectionIndex` and
  `PriorityAllocator` move from `Runtime.NODEJS_20_X` to `Runtime.NODEJS_24_X`. Both
  handlers are `async`, so they are unaffected by the Node 24 handler changes.
- `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, the metric
  `IQueue` gained in `aws-cdk-lib` 2.272.0.
- The library's TypeScript `target` moves from `ES2018` to `ES2022`.
