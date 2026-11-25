# AutoAlarm Changelog

## Unreleased
### Changed
- Moved into the [truemark/public](https://github.com/truemark/public) monorepo as `autoalarm/`. `cdk` and `handlers` are now pnpm workspace packages: versions come from the workspace catalog and `truemark-cdk-lib` is linked from the workspace. The cdk tests run under vitest instead of jest. The package is private and is no longer published to GitHub Packages.
- Each AutoAlarm Lambda function's log alarm now watches a metric of its own (`TrueMark/Logs` / `<stack>-<function>-<hash>-CriticalLogCount`) instead of the `CriticalLogCount` metric that every `truemark-cdk-lib` function in the account shares.
- The log alarms now match a handler error as well as the word `ERROR`. The filter was the text `ERROR`, which the handlers' own errors never contain: they log a numeric level (`"level":50`) and messages such as "Error deleting alarms". The filter is now the regex `%ERROR|\x22level\x22:[56]0%`, so it still counts any line containing `ERROR` and also counts the handlers' error and fatal lines. Expect these alarms to fire more often.
- The function log groups are renamed to `/aws/lambda/<stack>-<function>-<hash>`, where the hash covers the function's construct path. **On the next deploy CloudFormation replaces the five log groups, so their existing log events (3 days' retention) are deleted**, and the log metric filters and alarms are recreated. Saved queries or subscription filters that name the old groups need updating.

### Fixed
- A failed alarm deletion for a removed RDS instance, RDS cluster, CloudFront distribution, Step Functions state machine, Transit Gateway or VPN connection now fails the SQS record, so it is retried and then moved to the dead-letter queue. These six surfaces logged the error and acknowledged the event, which left the alarms behind with nothing to retry. The other surfaces already rethrew.
- A single alarm that cannot be deleted (for example when a tag removes one threshold) now fails the SQS record instead of being logged and acknowledged. An alarm that is already gone still counts as deleted.
- The ReAlarm producer now fails its run when SQS rejects individual entries of a `SendMessageBatch` call. SQS reports those inside a successful response, so the alarms were dropped with no error.
- A failed tag lookup now fails the SQS record on every surface. ALB, CloudFront, OpenSearch, Route 53 Resolver, Step Functions, Target Group, Transit Gateway and VPN treated the failure as "no tags", so a tagged resource got no alarms at creation, and a Step Functions tag change could delete the state machine's alarms.
- An ECS service ARN with no cluster segment now fails the record. It was logged as an error and then skipped as "not a service event".
- A tag event for a CloudWatch Logs resource that is not a log group (a destination or delivery, for example) is now skipped. It was logged as a malformed log group ARN and then failed the record with a `TypeError`, so it was retried and sent to the dead-letter queue.

## v1.14.4
### Fixed
- Fixed main handler not routing EC2 VPN create/delete events to the VPN module when events arrived in CloudTrail format. EventBridge sends VPN events with `detail-type` "AWS API Call via CloudTrail" and no `detail.resourceType`; the handler only routed when `resourceType === 'vpn-connection'`, so those events were treated as "Unhandled EC2 event format" and sent to the DLQ. Added an explicit branch for CloudTrail-form VPN create/delete events so they are routed to `parseVpnEventAndCreateAlarms` like the existing VPN path.

### Removed
- Removed `.github/workflows/mirror-to-bit-bucket.yml` (GitHub Actions workflow that mirrored the repo to Bitbucket).
- Removed `pipelines.yml` (Bitbucket Pipelines config for CDK Deploy and CDK Deploy Multiple Accounts).

## v1.14.3
### Added
- github workflows added

## v1.14.2
### Added
- Refactored ECS module to properly support task-level monitoring instead of service-level monitoring while maintaining CloudWatch compatibility.
- Updated ARN parsing logic to scan for and extract the correct ECS task ARN rather than cluster or service ARNs.
- Simplified ECS event handling to focus entirely on task creation, tagging, untagging, and StopTask events.
- Cleaned up unused service/cluster logic to reduce noise and improve clarity, while retaining required CloudWatch metric dimensions (ClusterName and ServiceName) for backward compatibility.
- Improved internal naming consistency (taskId, extractECSTaskInfo, task-focused log messages).

## v1.14.1
### Added
- Added support for loggroup monitoring via alarm based tag management. 

## v1.13.12
### Fixed
- Fixed a deprecated lib version for truemark-cdk-lib which contains an update for a deprecated lambda property. Addresses issue-200. 

## v1.13.11

### Fixed

- Fixed additional missing eventbridge rule definitions for tags that have since been added to autoalarm after audit.

## v1.13.10

### Fixed

- Fixed missing event bridge rules for network-in and network-out tag changes on EC2 instances.

## v1.13.7

### Fixed

- Fixed a bug that resulted in Anomaly Alarms not catching some configuration parameters for dataPointsToAlarm and
  evaluation periods.

## v1.13.5

### Fixed:

- Fixed a bug where EC2 storage alarms worked for windows guests but not for linux.

### Changed:

- Removed cdk.out and node files from IDE indexing.

## v1.13.3

#### Fixed:

- Fixed a bug in the default configs for EC2 storage alarms where the comparison operator and thresholds are inverse of
  What they should be for linux hosts when creating alarms for windows hosts.

## v1.13.2

### Fixed:

- Fixed logic that would process SQS create events for alarms that were not tagged at creation for autoalarm. During
  automation or workflows that create and tear down sqs queues, AutoAlarm would be overloaded with create events and make
  large number of unnecessary calls to the aws apis and introduce throttling issues. This fix ensures that only queues
  that are properly tagged for autoalarm will be processed for alarm creation. (issue 158)

## v1.13.1

### Added:

- Validation for Statistics using valibot to ensure that only valid statistics are used in the alarm configuration (issue 135).

### Changed:

- Significant structural refactors for the project to improve maintainability (issue-144).
- Refactored alarm-configs.mts to only contain utilities used to parse tags and alarm configurations.
- Segregated and split off alarm configs into their own files for each service to improved.
- AutoAlarm's new structure includes barrel exports in index.mts files for alarm configs, alarm utils, types and
  service modules to simplify imports and improve implementation across the project.

### Fixed:

- Fixed a bug in RDS Cluster Module where the ARN from the sqs payload contained the Cluster Resource ID instead of a valid ARN
  by adding logic to remap the ARN from the cluster resource ID (issue 151).
- Fixed a bug where extended statistics were not being properly parsed in tag values (issue 146).

## v1.12.1

### Added:

- Added additional support for RDS and RDS Cluster alarms.
- Added Tag keys for new DB alarm configs

### Fixed:

- Fixed SQS queue visibility timeout to match lambda timeout which is required by CDK.
- Fixed a missing parameter in PutMetricAlarmCommandInput to allow configuration of data points to alarm

## v1.11.0

### Added:

- Implemented SQS-based message routing layer to resolve FIFO queue head-of-line blocking issues
- Added content-based message group ID generation to prevent head-of-Line blocking in FIFO queues
- Created dedicated SQS handler function that routes service-specific events to a single main function queue

### Changed:

- Refactored main-function-subconstruct to use a single consolidated FIFO queue instead of multiple service-specific queues
- Improved CloudWatch API error handling by properly propagating throttling errors through the call chain
- Enhanced resource naming and organization for better operational visibility and debugging
- Optimized error recovery by ensuring failed operations can be properly retried without blocking other messages
- AutoAlarm no longer fails SQS messages that contain error language in the message body
- Changed queue visibility timeout from 900 seconds to 120 seconds for event source and main function queues

### Fixed:

- Fixed an issue where FIFO queue head-of-line blocking caused significant delays in event processing
- Fixed error handling in CloudWatch alarm operations to ensure throttling errors are properly captured for retry
- Improved error propagation in alarm-tools.mts to ensure failed alarm operations are properly recycled to SQS for retry

## v1.10.3

### Fixed:

- Fixed issue where target group alarms were not properly cleaned up on deletion due to TargetGroupNotFoundException during the delete event processing workflow
- Improved error handling for target group events with defensive programming to handle race conditions between delete and tag change events

## v1.10.2

### Fixed:

- Fixed alarm filtering logic in NoBreachingExtendedQueue to correctly set TreatMissingData to 'notBreaching' for all SQS queue alarms for default SQS queues.
- Fixed statistic case in alarm configuration for OpenSearch metrics ('SUM' to 'Sum')

## v1.10.0

### Added:

- Added CloudWatch monitoring for State Machines(Step Functions) with support for several metrics:
    - Executions Timed Out
    - Executions Failed

### Changed:

- Updated README with new services and metrics supported by AutoAlarm.

### Fixed:

- Fixed a bug that caused AutoAlarm to fail when creating alarms for EC2 instances during creation or termination events.

## v1.9.0

### Added:

- Added CloudWatch monitoring for RDS Clusters with support for several metrics:
    - CPU utilization
    - Database connections (with anomaly detection)
    - DB load (with anomaly detection)
    - Deadlocks
    - Freeable memory
    - Replica lag (both static thresholds and anomaly detection)
    - Swap usage (anomaly detection)
    - Write latency (anomaly detection)

### Changed:

- Implemented improved SQS batch processing to address the "snowball anti-pattern" by:
    - Tracking individual failed items instead of failing entire batches
    - Adding proper itemIdentifier tracking for failed SQS messages
    - Enhancing error handling with detailed logging of failed items
- Optimized CloudWatch API usage with:
    - Batching of requests (100 alarms per API call)
    - Rate limiting with dynamic delays based on API response times
    - Concurrent tag fetching with controlled parallelism
- Refactored auto-alarm-construct to use a single SQS queue for all alarm processing
- Refactored AutoAlarm Construct so that each component of AutoAlarm is now broken off into its own subconstruct to aid in maintainability and readability.

### Fixed:

- Fixed critical issue where failed messages in a batch would cause the entire batch to be retried, leading to exponential retry growth (snowball anti-pattern)
- Resolved throttling issues with CloudWatch API calls by implementing batched cloudwatch API calls and backoff strategies. This significantly reduces the number of API calls made to CloudWatch.

## v1.8.0

### Added:

- Added CloudWatch monitoring for individual DB instances in RDS.

### Changes:

- ReAlarm now uses a single dedicated queue for the consumer function and another SQS queue for the reAlarm event rule function.
- CloudWatch Alarms are now evaluated in batches of 100 and filtered in the API call thus significantly reducing the number of API calls made to CloudWatch.
- Batching of events now report individual failures in the batch rather than failing the entire batch and causing unnecessary retries.

### Fixed:

- Fixed a bug that caused excessive delay in AutoAlarm due to batch processing of triggers for both ReAlarm functionality and Alarm Management.

## v1.7.4

### Changes:

- Updated README with more explicit language detailing that only Application Load Balancers are currently supported and Network Load Balancers are not.

### Fixed:

- Fixed a bug that that allowed Network Load Balancers to trigger the ALB logic to manage alarms for Application Load Balancers. This resulted in an error when creating alarms for Network Load Balancers.

## v1.7.3

### Changes:

- Implemented logic to throw warning instead of error in case of missing load balancer for target groups target group alarm creation module
- Updated README with note that Target Group alarms require a load balancer.

### Fixed:

- Fixed a bug that resulted in AutoAlarm throwing an error when load balancer is not associated with a target group leading to excessive delays through FIFO queue retries.

## v1.7.2

### Changes

- Implemented producer-consumer pattern with SQS queue for realarm processing using SQS
- Implemented rate limiting and backoff for API calls to cloudwatch in ReAlarm processing
- Significantly reduced number of API calls to cloudwatch in ReAlarm processing
- Added proper throttling and error handling for ReAlarm processing.

### Fixed:

- Fixed bug that prevented ReAlarm from processing alarms in certain cases where total alarm volume resulted in AWS API throttling.

## v1.7.0

### Added:

- Enhanced ReAlarm functionality with per-alarm configuration using tags
- New tag-based ReAlarm scheduling system allowing customization of re-alarm intervals per alarm
- New EventBridge rule handler for managing ReAlarm schedules
- Support for dynamic ReAlarm schedule updates based on tag changes
- Tag-based configuration with `autoalarm:re-alarm-minutes` for custom schedules
- Tag-based configuration with `autoalarm:re-alarm-enabled` to disable ReAlarm for specific alarms

### Changed:

- ReAlarm is now enabled by default with a 120-minute schedule
- Improved ReAlarm error handling and retry logic
- Enhanced logging for better observability of ReAlarm operations
- Restructured ReAlarm configuration to be more flexible and maintainable
- Updated ReAlarm Lambda to support both scheduled and override-based executions
- Moved from global ReAlarm configuration to granular, tag-based configuration

### Removed:

- Removed global ReAlarm schedule configuration via CDK context
- Removed `useReAlarm` context variable (ReAlarm is now enabled by default)
- Removed `reAlarmSchedule` context variable (replaced with tag-based configuration)
- Removed `realarm:disabled` tag in favor of `autoalarm:re-alarm-enabled`

### Fixed:

- Fixed a bug that prevented retry logic from working correctly in ReAlarm due to improper package import.

## v1.6.0

## Added:

- Added a fifo queue to the alarm-tools module to ensure that alarms are created in the correct order.
- Support added for CloudFront, Route53Resolver, TransitGateway, and VPN services.
- Added ReAlarm Lambda which retriggers alarms in an alarm state for increased observability. This can be configured with tagging.

### Changed:

- Updated the alarm-config.mts file to include the new services.
- Updated the README to include the new services.
- Updated the auto-alarm-construct.ts file to include the new services.
- AutoAlarm Queue Alarms now treat missing data as missing, rather than breaching.
- Tagging schema now allows for the autoalarm:target tag to be used to specify whether an EC2 instance creates Alarms in Cloudwatch or Amazon Managed Prometheus.
- Added support for Amazon Managed Prometheus Service (AMP) and EC2 Prometheus Alarms for CPU, Memory and Disk Utilization.

### Fixed:

- Fixed an issue where the alarm-tools module would not create alarms in the correct order when creating multiple alarms.
- Fixed and issue where Tag change and state change events were not being processed correctly by the lambda function.

## v1.5.0

## Added

- Added a new configuration file that centralizes all default alarm configurations for currently supported services in
  one place.
- This file contains tag parsing logic used across all services modules used to create alarms.
- This file also introduces a more robust tagging schema that simplifies tagging patterns across all services and alarm types.
- This file allows alarms to be defined in a single location without the need to adjust code in each service module.
- Support for OpenSearch has been added.

## Changed:

- All services will now use the same tagging schema to enable non-default alarms and configure default and non-default
  alarms according to application and environment specific needs.
- tags monitored by eventbridge rule listeners now no longer contain the service name. All tags now follow a convention
  of 'autoalarm:' followed by a short description of the metric. These are defined in the project README.

## Fixed:

## Removed:

- Removed the old tagging schema.
- Removed Various logging statements that were used for testing and no longer needed.
