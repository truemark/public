---
'truemark-cdk-lib': minor
---

- aws-sqs: `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, which
  `IQueue` gained in newer aws-cdk-lib releases. Consumers on those releases no longer get
  TS2420 from `standard-queue.d.ts` or TS2741 when passing a `StandardQueue` as an `IQueue`.
  No template change.
- aws-sqs: `StandardQueue` takes an optional `enforceSSL` prop, applied to the queue and its
  dead letter queue. Unset keeps today's behaviour: not enforced on the queue, enforced on the
  dead letter queue.
- aws-wafv2: `CloudFrontSecurityBaselineWebAcl` and `RegionalSecurityBaselineWebAcl` import
  `Construct` from `constructs` instead of `constructs/lib/construct`, which does not resolve
  under `moduleResolution: NodeNext` with constructs 10.8 or later.
- aws-wafv2: both baselines send logs to the log group ARN without the trailing `:*`, the
  format AWS WAF documents. On deploy the existing `AWS::WAFv2::LoggingConfiguration` is
  updated in place; nothing is replaced.
- aws-wafv2: both baselines take an optional `logRemovalPolicy` for the WAF log group. Unset
  keeps today's behaviour (retained). Pass `RemovalPolicy.DESTROY` where the stack is torn
  down and redeployed: the group's name is fixed, so a retained group blocks the next deploy
  until it is deleted by hand.
- aws-cloudfront: `apiDefaults()` takes an optional second list of headers that go to the
  origin request policy only, for headers a cache policy rejects such as
  `CloudFront-Viewer-Address`. Existing calls produce the same policies.
- aws-ssm: `ParameterReader`, used by `ParameterStore.read` across regions, grants
  `ssm:GetParameter` on the parameter's ARN in the target region instead of `*`. The stack's
  shared `AwsCustomResource` provider function logs to a new log group with 3 days'
  retention, one per stack, unless a custom resource created before it already set one. On
  deploy the stack gains that log group and the function's logging configuration is updated
  in place. The function's previous `/aws/lambda/<function>` group, created by Lambda or,
  under `@aws-cdk/aws-lambda:useCdkManagedLogGroup`, by CDK with a retain policy, is left
  behind and can be deleted.
- aws-dynamodb: `ExtendedTableV2` (and so `StandardTableV2`) now sets `tableAlarms`, which was
  always `undefined`, and adds every global secondary index, whether passed in
  `globalSecondaryIndexes` or added later, to the monitoring dashboards when the stack creates
  them. No alarms are added.
