# TrueMark CDK Library Changelog

## 1.33.0
### Minor Changes

- e354108: aws-lambda: `FunctionAlarms` takes an optional `isIterator` prop, marking a function as a
  stream consumer (e.g. a DynamoDB or Kinesis stream). It is forwarded to
  cdk-monitoring-constructs, where it controls the iterator-age dashboard widget and gates
  `maxIteratorAge` alarms. Unset keeps today's behaviour: the prop is passed through
  undefined, so the cdk-monitoring-constructs default of `true` still applies and existing
  `maxIteratorAge` alarms and dashboards are unchanged. Pass `isIterator: false` on a
  non-stream function to drop the iterator-age widget.

## 1.32.0
### Minor Changes

- 952790d: - aws-sqs: `StandardQueue` implements `metricApproximateNumberOfMessagesOutstanding`, which
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

## 1.31.0
### Minor Changes

- a866bd7: Add NAT instance and IPv6 support to `aws-vpc` (#483).
  
  - **New `NatInstance` construct** — a self-managed, ASG-backed NAT instance with a dedicated
    ENI, offered as a lower-cost alternative to a managed NAT Gateway. Defaults to ARM64 on
    `t4g.micro` (`t3a.micro` on X86_64), with optional spot instances (`useSpotInstance`),
    a custom `imageId`, extra cloud-init files/commands (`additionalWriteFiles`,
    `additionalRunCmds`), and a configurable `ssmPolicyArn`. Exported from `aws-vpc`.
  - **`NatType` gains `'natInstance'`** — `StandardNetwork` provisions a `NatInstance` and points
    the private subnet route tables at its ENI when selected. Requires at least one public subnet
    and one private subnet; both are validated.
  - **New `enableIpv6` prop on `StandardNetwork`** — associates an Amazon-provided IPv6 CIDR and
    configures the VPC for dual-stack (`ec2.IpProtocol.DUAL_STACK`). IPv6-only mode is not yet
    supported.
  - **Migration note for older versions:** `StandardNetwork` defaults to 3 availability zones
    (already the default in `1.29.0`). Consumers upgrading from a version that defaulted to 2
    may get new per-AZ resources **and replacements of existing subnets**: adding a third private
    subnet shifts sequential CIDR allocations in the public and later subnet groups.
    Set `azCount: 2` before upgrading to retain the two-AZ setting; otherwise review `cdk diff`
    and plan the subnet/resource migration.

## 1.30.0
### Minor Changes

- 937eab0: aws-securitylake: `StandardSecurityLake` now supports a `subscribers` prop
  that creates `AWS::SecurityLake::Subscriber` (access type `S3`) plus
  `AWS::SecurityLake::SubscriberNotification` resources. SQS notification is
  the default; HTTPS notification is supported via `httpsNotificationEndpoint`.
  Exposed as `SecurityLakeSubscriberProps` / `SecurityLakeSubscriberSourceProps`
  with `subscribers` and `subscriberNotifications` arrays on the construct for
  downstream wiring.

## 1.29.0

### Minor Changes

- d1d05fd: aws-securitylake: add StandardSecurityLake construct that wraps the Security Lake L1 constructs to stand up a data lake. Supports an optional `createLakeFormationServiceLinkedRole` flag to provision the `AWSServiceRoleForLakeFormationDataAccess` SLR required by Security Lake.

## 1.28.2

### Patch Changes

- 0e52ce7: AutoBackup selection roles now carry `AWSBackupServiceRolePolicyForS3Backup`, so S3 buckets tagged with `backup:policy` are backed up instead of failing with a permission error. Buckets must still have versioning enabled for AWS Backup to protect them.

## 1.28.1

### Patch Changes

- 4df3a8b: Remove `@aws-sdk/credential-provider-node` peer dependency. The bedrock knowledge base collection index handler now relies on the OpenSearch signer's default credential lookup, which uses the module provided by the Lambda runtime.

## 1.28.0

### Minor Changes

- 02f8085: Add an exported `getGlobalIndexes` helper to `aws-dynamodb` for generating global secondary index names (`Gs1`, `Gs2`, …).

## 1.27.0

### Minor Changes

- cf9923c: Add aws-rds module and implement StandardPostgresAuroraServerlessCluster (Aurora Serverless v2 PostgreSQL).

## 1.26.0
### Minor Changes

- 6644d4d: Add AWS WorkSpaces constructs and supporting modules: `aws_workspaces`, `aws_patterns_workspaces`, `aws_directory_service` (Managed AD, Simple AD, directory groups), and SSM helpers `aws_ssm_activation` (hybrid activations) and `aws_ssm_patch` (patch baselines and run-shell-script associations).

## 1.25.1
### Patch Changes

- fbe9289: Loosen the `aws-cdk-lib` (`^2.256.0`) and `aws-cdk` (`^2.1124.0`) catalog dependencies to caret ranges so consumers can resolve compatible newer 2.x releases

## 1.25.0
### Minor Changes

- 7c5cfe2: Fixed CloudFrontBucketV2 ignoring the bucketName prop. Stacks that set bucketName previously had it silently ignored and an auto-generated name was used. The value now takes effect, so on the next deployment CloudFormation will replace the bucket to apply the new name (the old bucket is retained or deleted per its removal policy, and any existing objects must be migrated).

## 1.24.0
### Minor Changes

- ef6b750: Add StandardNetwork VPC construct with a `none | single | multi` NatType string union

## 1.23.1
### Patch Changes

- a1f7628: Fixed log group conflicts

## 1.23.0
### Minor Changes

- 419ecdd: Updated dependencies, replaced eslint and refactored code for updates

## 1.22.15
### Patch Changes

- bd7e93c: Updated redirect function to handle www redirection

## 1.22.14
### Patch Changes

- 1bba7dc: Fixed issues with gitPushFilter

## 1.22.13
### Patch Changes

- f182ce5: Added AutoBackup construct

## 1.22.12
### Patch Changes

- 3e1c604: Added FunctionLogOptions to StandardPythonFunction
- 7b4b8d3: Updated default python runtime to 3_14

## 1.22.11
### Patch Changes

- ce36da7: Set enableDockerBuildxOnAssetPublish to false when computeType is lambda.

## 1.22.10
### Patch Changes

- f5612d4: Updated cache paths in CdkPipeline

## 1.22.9
### Patch Changes

- 194db9b: Disabled docker when compute type is lambda

## 1.22.8
### Patch Changes

- c4b62e4: Set buildEnvironment for synth in CdkPipeline to allow for lambda usage

## 1.22.7
### Patch Changes

- 342ace9: Fixed privileged setting in CdkPipeline

## 1.22.6
### Patch Changes

- d2230d6: Fixed logic with privileged mode

## 1.22.5
### Patch Changes

- 0619bc4: Set privileged mode to false when compute type is lambda

## 1.22.4
### Patch Changes

- 78ed4ec: Added restartExecutionOnUpdate to CdkPipeline

## 1.22.3
### Patch Changes

- b8f6d52: Replaced triggers with gitPushFilter

## 1.22.2
### Patch Changes

- 14c817f: Added new runtime versions for CdkPipeline

## 1.22.1
### Patch Changes

- c49b7e3: Added tiggers to CodePipeline

## 1.22.0
### Minor Changes

- 5abe56d: Add automatic ALB listener rule priority allocation for StandardApplicationFargateService. Add new construct for ECS Run Tasks StandardFargateRunTask.

## 1.21.8
### Patch Changes

- 6e08dea: Added standard-fargate-runtask

## 1.21.7
### Patch Changes

- 3fcc8aa: Added typesVersions

## 1.21.6
### Patch Changes

- 8891a3e: Fixed module exports

## 1.21.5
### Patch Changes

- 338cf4e: Fixed main and types

## 1.21.4
### Patch Changes

- 10648a2: Added deliveryDelay to StandardQueue

## 1.21.3
### Patch Changes

- cc53d96: Improved regular expression in isPascalCase
- e3e7cc4: Improved regex on isCamelCase

## 1.21.2
### Patch Changes

- 3f5248e: Added cors support to WebsiteBucket

## 1.21.1
### Patch Changes

- 6f95456: Added include to BucketDeploymentConfig
- a412028: Added @changesets/cli and changed to new publishing workflow
