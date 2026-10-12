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
- The default ADOT Node.js layer moves from `aws-otel-nodejs-<arch>-ver-1-30-2:1` to `:6`. This
  is required for Node 24: the `:1` build (2025-05-30) registers the `import-in-the-middle` hook
  only for ESM handlers (`if (_isHandlerAnESModule())` in `loader.mjs`), but the Node 24 runtime
  loads every handler through `import()` regardless of whether it is CommonJS, so CommonJS
  handlers are left uninstrumented
  ([opentelemetry-lambda#2034](https://github.com/open-telemetry/opentelemetry-lambda/issues/2034),
  fixed upstream in `layer-nodejs/0.19.0` on 2025-12-09). Layer versions `:2` (2026-08-11) and
  later carry the fix — their `loader.mjs` reads
  `if (_isHandlerAnESModule() || _getNodeRuntimeVersion() >= 24)` — and also move
  `import-in-the-middle` from `^1.12.0` to `^3.3.2` and add `require-in-the-middle` `^8.0.1`.
  The layer is only attached when `otel.enabled` is set, and consumers overriding
  `otel.layerVersionArn` are unaffected.
- `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, the metric
  `IQueue` gained in `aws-cdk-lib` 2.272.0.
- The library's TypeScript `target` moves from `ES2018` to `ES2022`.
