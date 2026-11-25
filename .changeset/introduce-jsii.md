---
'truemark-cdk-lib': major
'truemark-cdk-extra-js': major
---

Build `truemark-cdk-lib` with jsii so its constructs can be used from Python, Java and .NET, and add `truemark-cdk-extra-js` for the TypeScript and JavaScript only pieces.

The npm package now ships a `.jsii` assembly. `pnpm run package` builds the Python, Java and .NET packages with jsii-pacmak; they are not published yet. Go is not offered because `cdk-monitoring-constructs` has no Go module.

jsii restricts what a public API may look like, so this release has breaking changes for TypeScript users.

**Moved to `truemark-cdk-extra-js`**

- `SingleStackStage` and `WrapperStageProps`: import from `truemark-cdk-extra-js/aws-cdk`.
- `StandardTable`, `StandardTableProps`, `StandardTableV2`, `StandardTablePropsV2` and `getGlobalIndexes`: import from `truemark-cdk-extra-js/aws-dynamodb`.

**Renamed**

- Enum members are now upper case. Their values are unchanged: `AlarmCategory.CRITICAL` / `WARNING`, `DataClassification.EXPORT_RESTRICTED` / `RESTRICTED` / `CONTROLLED` / `PUBLIC`, `RedirectType.PERMANENT` / `TEMPORARY`, `SourceType.CUSTOM` / `HUGO` / `NPM_DIST` / `STATIC`.
- `getXxx()` methods without arguments became properties:
  - `AlarmsBase.getCriticalAlarms()` / `getWarningAlarms()` → `criticalAlarms` / `warningAlarms` (this applies to `FunctionAlarms`, `TableAlarms` and `QueueAlarms`).
  - `DomainName.getPrefix()` / `getZone()` / `getVpcId()` → `prefix` / `zone` / `vpcId`.
  - `SingleEnvApp.getEnvironmentName()` → `environmentName`, `getEnvironmentNameTitleCase()` → `environmentNameTitleCase`.
  - `ParameterReader.getStringValue()` → `stringValue`.
  - `DistributionBuilder.getOrigins()` / `getBehaviorPaths()` → `origins` / `behaviorPaths`, `BehaviorBuilder.getOrigin()` → `origin`.
- `DistributionBuilder.build()` and `BehaviorBuilder.build()` → `buildDistributionProps()`.
- Static `DomainName.createCertificate(scope, id, domainNames)` → `DomainName.createCertificateForDomains(...)`. The instance method `createCertificate(scope, opts)` is unchanged.
- `ExtendedRecordTarget.fromAlias(target, evaluateTargetHealth)` → `ExtendedRecordTarget.fromAliasTarget(...)`.
- `Collection.registerIndex()` → `_registerIndex()`. It is internal.

**Changed signatures and types**

- `ExtendedStack.exportAndOutputParameter()` returns `{parameter, output}` (`ExportedParameter`) instead of a `[StringParameter, CfnOutput]` tuple.
- `ShellHelper` version methods return `undefined` instead of `null` when the command is not found.
- `ExtendedApp.account` and `ExtendedApp.region` are typed `string | undefined` to match `Stage`. They are still always set.
- `CollectionGroup.generation` and `standbyReplicas` are typed as optional to match `ICollectionGroup`. They are still always set.
- `BundledFunctionProps.isLocalBundlingSupported: () => boolean` is replaced by `localBundlingSupport: ILocalBundlingSupport`, an object with an `isLocalBundlingSupported()` method.
- `StandardFargateCluster.resolveExecuteCommandConfiguration(scope, props, logGroup?)`: `logGroup` moved to the end.
- `MetricAlarmBase`, `AlarmsBase` and `AlarmsOptions` are no longer generic. Subclasses of `MetricAlarmBase` receive `MetricAlarmBaseProps` in `createMetric` and `createAlarm`. `criticalAlarmOptions` and `warningAlarmOptions` are declared on `FunctionAlarmsOptions`, `TableAlarmsOptions` and `QueueAlarmsOptions`. The protected `AlarmsBase.props` and `AlarmsBase.toRecord()` are gone.
- `AlarmHelper.toRecord()` is replaced by the `toAlarmRecord()` function. It and `AlarmFacadeSet` are TypeScript only.
- `aws-patterns-workspaces` no longer re-exports `aws-workspaces`. Import `AwsWorkspaces` and related types from `truemark-cdk-lib/aws-workspaces`.
- `BatchWriteItemProps.items` is typed `Record<string, any>`. The `BatchWriteItemRequestItems` type is still exported and still assignable to it.
- `Collection.addIndex()` takes the new `CollectionIndexOptions`, and `CollectionIndexProps.indexSchema` objects are typed `Record<string, any>`.
- `BucketDeploymentConfig.source` is typed `string | ISource | (string | ISource)[]`.
- `StandardApplicationFargateServiceProps.scaleOnTargetResponseTime` uses the new `ScaleOnTargetResponseTimeOptions`.
- `AlarmFacadeProps`, `FunctionLogOptions` and `AutoBackupProps` properties are now `readonly`.

**Added**

- `FunctionLogOptions`, `FunctionLogConfig`, `CustomResourceLogOptions` and the OpenTelemetry types are exported from `aws-lambda`.
- `aws_patterns_autobackup` is exported from the package root.
