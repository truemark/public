# AutoAlarm Project README

## Table of Contents

- [Overview](#overview)
- [Managing AutoAlarm](#managing-autoalarm)
- [Overriding Default Alarm Values with Tags](#overriding-default-alarm-values-with-tags)
    - [Tag Value Structure](#tag-value-structure)
- [Supported Services and Default Alarm Configurations](#supported-services-and-default-alarm-configurations)
    - [Application Load Balancer (ALB)](#application-load-balancer-alb)
    - [CloudFront](#cloudfront)
    - [EC2](#ec2)
    - [Lambda](#lambda)
    - [OpenSearch](#opensearch)
    - [RDS](#rds)
    - [RDS Clusters](#rds-clusters)
    - [Route53Resolver](#route53resolver)
    - [SQS](#sqs)
    - [Step Functions](#step-functions)
    - [Target Groups (TG)](#target-groups-tg)
    - [Transit Gateway (TGW)](#transit-gateway-tgw)
    - [VPN](#vpn)
- [Guide to Customizing Alarms with Tags](#guide-to-customizing-alarms-with-tags)
    - [Alarm Types](#alarm-types)
        - [Static Threshold Alarms](#static-threshold-alarms)
        - [Anomaly Detection Alarms](#anomaly-detection-alarms)
- [Supported Tag Values](#supported-tag-values)
    - [Threshold Configuration](#threshold-configuration)
    - [Timing Configuration](#timing-configuration)
    - [Understanding Datapoints vs Periods](#understanding-datapoints-vs-periods)
    - [Statistic](#statistic)
    - [Missing Data Treatment](#missing-data-treatment)
    - [Valid Comparison Operators](#valid-comparison-operators)
- [Using the Nullish Character ("-") and Implicit Values in AutoAlarm](#using-the-nullish-character---and-implicit-values-in-autoalarm)
    - [Key Concepts](#key-concepts)
    - [Examples](#examples)
- [ReAlarm Tag Configuration and Behavior](#realarm-tag-configuration-and-behavior)
    - [Overview](#overview-1)
    - [Default Values](#default-values)
    - [Configure ReAlarm Behavior with Tags](#configure-realarm-behavior-with-tags)
        - [Special Note](#special-note)
- [Additional References](#additional-references)

## Overview:
AutoAlarm provides out-of-the-box monitoring with sensible defaults while allowing full customization through resource tags. In addition to default alarms, 
AutoAlarm allows operations teams to customize alarms and monitoring when necessary using a simple tagging strategy.

##  Managing AutoAlarm
- To enabled AutoAlarm for a service instance, tag an instance as follows:  

| Tag Key             | Tag Value | Result                                                                                                              |
|---------------------|-----------|---------------------------------------------------------------------------------------------------------------------|
| `autoalarm:enabled` | `true`    | Enabled AutoAlarm Alarm Management for a resource and creates all default alarms - ***Required to use AutoAlarm**   |
| `autoalarm:enabled` | `false`   | Deletes all AutoAlarm managed alarms (both default and custom alarms). Alternatively, the tag can simply be removed |


## Overriding Default Alarm Values with Tags
- Each alarm configuration supported by AutoAlarm has a default configuration. Furthermore, each service has alarms that are automatically included by default 
  any time the `autoalarm:enabled` tag is set to `true`. In scenarios where a user needs to change the default values on the default alarms or enable alarms
  that are not included by default, these alarms can be configured using a tagging schema with specific tag keys and values as defined below: 

### Tag Value Structure

Each tag value consists of 8 parameters separated by `/`:

| Position | Parameter           | Example                | Description                       |
|----------|---------------------|------------------------|-----------------------------------|
| 1        | Warning Threshold   | `66` or `-`            | Threshold value or `-` to disable |
| 2        | Critical Threshold  | `89` or `-`            | Threshold value or `-` to disable |
| 3        | Period              | `120`                  | Seconds per evaluation period     |
| 4        | Evaluation Periods  | `15`                   | Number of periods to evaluate     |
| 5        | Statistic           | `Average`              | Metric statistic type             |
| 6        | Datapoints to Alarm | `12`                   | Required breaching datapoints     |
| 7        | Comparison Operator | `GreaterThanThreshold` | How to compare against threshold  |
| 8        | Alarm Action        | `breaching`            | Missing Data Treatment            |

**Example Breakdown:**
```
        Tag Key                                        Tag Value
┌────────────────────────┐   ┌─────────────────────────────────────────────────────────────┐                                          
autoalarm:some-metric-type = 66/89/120/15/Average/12/GreaterThanOrEqualToThreshold/breaching
                              │ │   │  │     │    │           │                       │
                              │ │   │  │     │    │           │                       └────➤ TreatMissingData: breaching
                              │ │   │  │     │    │           └────────────────────────────➤ ComparisonOperator: >=
                              │ │   │  │     │    └────────────────────────────────────────➤ DatapointsToAlarm: 12
                              │ │   │  │     └─────────────────────────────────────────────➤ Statistic: Average
                              │ │   │  └───────────────────────────────────────────────────➤ Eval Periods: 15
                              │ │   └──────────────────────────────────────────────────────➤ Period: 120 sec
                              │ └──────────────────────────────────────────────────────────➤ Critical Alarm Threshold: 89
                              └────────────────────────────────────────────────────────────➤ Warning Alarm Threshold: 66
```


## Supported Services and Default Alarm Configurations
Threshold values that contain '-' are undefined and will default to not creating the alarm for that threshold (Warning or Critical). If neither the warning and critical
threshold values are provided in the tag value when setting the tag on the resource, no alarm will be created.


#### Application Load Balancer (ALB)

| Tag                               | Alarm Created by Default | Standard CloudWatch Metric |  Warning Threshold  | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|-----------------------------------|--------------------------|----------------------------|---------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:4xx-count`             | No                       | Yes                        |  -                  | -                  | 60     | 2                  | Sum       | 2                   | GreaterThanThreshold      | ignore                 | `-/-/60/2/Sum/2/GreaterThanThreshold/ignore`           |
| `autoalarm:4xx-count-anomaly`     | No                       | Yes                        |  2                  | 5                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `2/5/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:5xx-count`             | No                       | Yes                        |  -                  | -                  | 60     | 2                  | Sum       | 2                   | GreaterThanThreshold      | ignore                 | `-/-/60/2/Sum/2/GreaterThanThreshold/ignore`           |
| `autoalarm:5xx-count-anomaly`     | Yes                      | Yes                        |  2                  | 5                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold | ignore                 | `2/5/300/2/Average/2/GreaterThanUpperThreshold/ignore` |
| `autoalarm:request-count`         | No                       | Yes                        |  -                  | -                  | 60     | 2                  | Sum       | 2                   | GreaterThanThreshold      | ignore                 | `-/-/60/2/Sum/2/GreaterThanThreshold/ignore`           |
| `autoalarm:request-count-anomaly` | No                       | Yes                        |  3                  | 5                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold | ignore                 | `3/5/300/2/Average/2/GreaterThanUpperThreshold/ignore` |

#### CloudFront

> **Note:** CloudFront is a global service. Its CloudTrail and tag-change events are delivered only in the `us-east-1` region, so CloudFront alarm automation requires AutoAlarm (or a satellite event rule forwarding to it) to be deployed in `us-east-1`.

| Tag                            | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|--------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:4xx-errors`         | Yes                      | Yes                        | 100               | 300                | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `100/300/300/1/Sum/1/GreaterThanThreshold/ignore`      |
| `autoalarm:4xx-errors-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:5xx-errors`         | Yes                      | Yes                        | 10                | 50                 | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `10/50/300/1/Sum/1/GreaterThanThreshold/ignore`        |
| `autoalarm:5xx-errors-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |

#### EC2

| Tag                             | Alarm Created by Default | Standard CloudWatch Metric                     | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|---------------------------------|--------------------------|------------------------------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:cpu`                 | Yes                      | Yes                                            | 95                | 98                 | 60     | 5                  | Maximum   | 5                   | GreaterThanThreshold      | ignore                 | `95/98/60/5/Maximum/5/GreaterThanThreshold/ignore`     |
| `autoalarm:cpu-anomaly`         | No                       | Yes                                            | 2                 | 5                  | 60     | 5                  | Average   | 5                   | GreaterThanUpperThreshold | ignore                 | `2/5/60/5/Average/5/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:memory`              | Yes                      | No (Requires CloudWatch Agent Install on Host) | 95                | 98                 | 60     | 10                 | Maximum   | 10                  | GreaterThanThreshold      | ignore                 | `95/98/60/10/Maximum/10/GreaterThanThreshold/ignore`   |
| `autoalarm:memory-anomaly`      | No                       | No (Requires CloudWatch Agent Install on Host) | 2                 | 5                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold | ignore                 | `2/5/300/2/Average/2/GreaterThanUpperThreshold/ignore` |
| `autoalarm:storage`             | Yes                      | No (Requires CloudWatch Agent Install on Host) | 90                | 95                 | 60     | 2                  | Maximum   | 1                   | GreaterThanThreshold      | ignore                 | `90/95/60/2/Maximum/1/GreaterThanThreshold/ignore`     |
| `autoalarm:storage-anomaly`     | No                       | No (Requires CloudWatch Agent Install on Host) | 2                 | 3                  | 60     | 2                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `2/3/60/2/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:network-in`          | No                       | Yes                                            | -                 | -                  | 60     | 5                  | Sum       | 5                   | LessThanThreshold         | ignore                 | `-/-/60/5/Sum/5/LessThanThreshold/ignore`              |
| `autoalarm:network-in-anomaly`  | No                       | Yes                                            | 2                 | 5                  | 60     | 5                  | Average   | 5                   | LessThanLowerThreshold    | ignore                 | `2/5/60/5/Average/5/LessThanLowerThreshold/ignore`     |
| `autoalarm:network-out`         | No                       | Yes                                            | -                 | -                  | 60     | 5                  | Sum       | 5                   | LessThanThreshold         | ignore                 | `-/-/60/5/Sum/5/LessThanThreshold/ignore`              |
| `autoalarm:network-out-anomaly` | No                       | Yes                                            | 2                 | 5                  | 60     | 5                  | Sum       | 5                   | LessThanLowerThreshold    | ignore                 | `2/5/60/5/Sum/5/LessThanLowerThreshold/ignore`         |

#### ECS

| Tag                             | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|---------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:cpu`                 | Yes                      | Yes                        | 95                | 98                 | 60     | 5                  | Maximum   | 5                   | GreaterThanThreshold      | ignore                 | `95/98/60/5/Maximum/5/GreaterThanThreshold/ignore`     |
| `autoalarm:cpu-anomaly`         | No                       | Yes                        | 2                 | 5                  | 60     | 5                  | Average   | 5                   | GreaterThanUpperThreshold | ignore                 | `2/5/60/5/Average/5/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:memory`              | Yes                      | Yes                        | 95                | 98                 | 60     | 10                 | Maximum   | 5                   | GreaterThanThreshold      | ignore                 | `95/98/60/10/Maximum/5/GreaterThanThreshold/ignore`    |
| `autoalarm:memory-anomaly`      | No                       | Yes                        | 2                 | 5                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold | ignore                 | `2/5/300/2/Average/2/GreaterThanUpperThreshold/ignore` |

#### Lambda

> **Note:** `autoalarm:errors` is created by default for any function tagged `autoalarm:enabled=true`. It uses `GreaterThanOrEqualToThreshold` with a critical threshold of `1`, so **any error** in a 60-second period (`Sum` of the `AWS/Lambda` `Errors` metric) drives the alarm to ALARM. There is no warning alarm by default. To disable it, set the warning and critical thresholds to the nullish character (`autoalarm:errors=-/-/...`).

| Tag                | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator           | Missing Data Treatment | Complete Tag Value                                       |
|--------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|-------------------------------|------------------------|----------------------------------------------------------|
| `autoalarm:errors` | Yes                      | Yes                        | -                 | 1                  | 60     | 1                  | Sum       | 1                   | GreaterThanOrEqualToThreshold | ignore                 | `-/1/60/1/Sum/1/GreaterThanOrEqualToThreshold/ignore`    |

#### LogGroups

| Tag                                | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold      | Critical Threshold        | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|------------------------------------|--------------------------|----------------------------|------------------------|---------------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:incoming-bytes`         | No                       | Yes                        | undefined/Requires tag | undefined/Requires tag    | 300    | 1                  | Maximum   | 1                   | LessThanThreshold         | ignore                 | `-/-/300/1/Maximum/1/LessThanThreshold/ignore`         |
| `autoalarm:incoming-bytes-anomaly` | No                       | Yes                        | undefined/Requires tag | undefined/Requires tag    | 300    | 1                  | Maximum   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Maximum/1/GreaterThanUpperThreshold/ignore` |


#### OpenSearch

| Tag                                     | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator           | Missing Data Treatment | Complete Tag Value                                      |
|-----------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|-------------------------------|------------------------|---------------------------------------------------------|
| `autoalarm:4xx-errors`                  | No                       | Yes                        | 100               | 300                | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold          | ignore                 | `100/300/300/1/Sum/1/GreaterThanThreshold/ignore`       |
| `autoalarm:4xx-errors-anomaly`          | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:5xx-errors`                  | Yes                      | Yes                        | 10                | 50                 | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold          | ignore                 | `10/50/300/1/Sum/1/GreaterThanThreshold/ignore`         |
| `autoalarm:5xx-errors-anomaly`          | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:cpu`                         | Yes                      | Yes                        | 98                | 98                 | 300    | 2                  | Maximum   | 1                   | GreaterThanThreshold          | ignore                 | `98/98/300/2/Maximum/1/GreaterThanThreshold/ignore`     |
| `autoalarm:cpu-anomaly`                 | No                       | Yes                        | 2                 | 2                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `2/2/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:iops-throttle`               | Yes                      | Yes                        | 5                 | 10                 | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold          | ignore                 | `5/10/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:iops-throttle-anomaly`       | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:jvm-memory`                  | Yes                      | Yes                        | 90                | 95                 | 300    | 2                  | Maximum   | 1                   | GreaterThanThreshold          | ignore                 | `90/95/300/2/Maximum/1/GreaterThanThreshold/ignore`     |
| `autoalarm:jvm-memory-anomaly`          | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:read-latency`                | Yes                      | Yes                        | 0.03              | 0.08               | 60     | 2                  | Maximum   | 2                   | GreaterThanThreshold          | ignore                 | `0.03/0.08/60/2/Maximum/2/GreaterThanThreshold/ignore`  |
| `autoalarm:read-latency-anomaly`        | No                       | Yes                        | 2                 | 6                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold     | ignore                 | `2/6/300/2/Average/2/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:search-latency`              | Yes                      | Yes                        | 2                 | 4                  | 300    | 4                  | Average   | 2                   | GreaterThanThreshold          | ignore                 | `2/4/300/4/Average/2/GreaterThanThreshold/ignore`       |
| `autoalarm:search-latency-anomaly`      | Yes                      | Yes                        | -                 | -                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold     | ignore                 | `-/-/300/2/Average/2/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:snapshot-failure`            | Yes                      | Yes                        | -                 | 1                  | 300    | 1                  | Sum       | 1                   | GreaterThanOrEqualToThreshold | ignore                 | `-/1/300/1/Sum/1/GreaterThanOrEqualToThreshold/ignore`  |
| `autoalarm:storage`                     | Yes                      | Yes                        | 10000             | 5000               | 300    | 2                  | Minimum   | 2                   | LessThanThreshold             | ignore                 | `10000/5000/300/2/Minimum/2/LessThanThreshold/ignore`   |
| `autoalarm:storage-anomaly`             | Yes                      | Yes                        | 2                 | 3                  | 300    | 2                  | Minimum   | 2                   | GreaterThanUpperThreshold     | ignore                 | `2/3/300/2/Minimum/2/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:throughput-throttle`         | Yes                      | Yes                        | 40                | 60                 | 60     | 2                  | Sum       | 2                   | GreaterThanThreshold          | ignore                 | `40/60/60/2/Sum/2/GreaterThanThreshold/ignore`          |
| `autoalarm:throughput-throttle-anomaly` | No                       | Yes                        | 3                 | 5                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold     | ignore                 | `3/5/300/1/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:write-latency`               | Yes                      | Yes                        | 0.084             | 0.1                | 60     | 2                  | Maximum   | 2                   | GreaterThanThreshold          | ignore                 | `0.084/0.1/60/2/Maximum/2/GreaterThanThreshold/ignore`  |
| `autoalarm:write-latency-anomaly`       | No                       | Yes                        | -                 | -                  | 60     | 2                  | Average   | 2                   | GreaterThanUpperThreshold     | ignore                 | `-/-/60/2/Average/2/GreaterThanUpperThreshold/ignore`   |
| `autoalarm:yellow-cluster`              | Yes                      | Yes                        | -                 | 1                  | 300    | 1                  | Maximum   | 1                   | GreaterThanOrEqualToThreshold | ignore                 | `-/1/300/1/Maximum/1/GreaterThanOrEqualToThreshold/ignore` |
| `autoalarm:red-cluster`                 | Yes                      | Yes                        | -                 | 1                  | 60     | 1                  | Maximum   | 1                   | GreaterThanOrEqualToThreshold | ignore                 | `-/1/60/1/Maximum/1/GreaterThanOrEqualToThreshold/ignore`  |
| `autoalarm:index-writes-blocked`        | Yes                      | Yes                        | -                 | 1                  | 600    | 1                  | Maximum   | 1                   | GreaterThanOrEqualToThreshold | notBreaching           | `-/1/600/1/Maximum/1/GreaterThanOrEqualToThreshold/notBreaching` |

#### RDS

| Tag                                  | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                                |
|--------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|-------------------------------------------------------------------|
| `autoalarm:cpu`                      | Yes                      | Yes                        | 90                | 95                 | 60     | 10                 | Maximum   | 8                   | GreaterThanThreshold      | ignore                 | `90/95/60/10/Maximum/8/GreaterThanThreshold/ignore`               |
| `autoalarm:db-connections-anomaly`   | Yes                      | Yes                        | 2                 | 4                  | 60     | 20                 | Maximum   | 16                  | GreaterThanUpperThreshold | ignore                 | `2/5/60/20/Maximum/16/GreaterThanUpperThreshold/ignore`           |
| `autoalarm:dbload-anomaly`           | Yes                      | Yes                        | 2                 | 4                  | 60     | 25                 | Maximum   | 20                  | GreaterThanUpperThreshold | ignore                 | `2/5/60/25/Maximum/20/GreaterThanUpperThreshold/ignore`           |
| `autoalarm:deadlocks`                | Yes                      | Yes                        | -                 | 0                  | 60     | 2                  | Sum       | 2                   | GreaterThanThreshold      | ignore                 | `-/0/60/2/Sum/2/GreaterThanThreshold/ignore`                      |
| `autoalarm:disk-queue-depth`         | No                       | Yes                        | 4                 | 8                  | 60     | 20                 | Maximum   | 15                  | GreaterThanThreshold      | ignore                 | `4/8/60/20/Maximum/15/GreaterThanThreshold/ignore`                |
| `autoalarm:disk-queue-depth-anomaly` | Yes                      | Yes                        | 2                 | 4                  | 60     | 12                 | Maximum   | 9                   | GreaterThanUpperThreshold | ignore                 | `2/4/60/12/Maximum/9/GreaterThanUpperThreshold/ignore`            |
| `autoalarm:freeable-memory`          | No                       | Yes                        | 512000000         | 256000000          | 300    | 3                  | Minimum   | 2                   | LessThanThreshold         | ignore                 | `512000000/256000000/300/3/Minimum/2/LessThanThreshold/ignore`    |
| `autoalarm:freeable-memory-anomaly`  | Yes                      | Yes                        | 2                 | 4                  | 300    | 3                  | Minimum   | 2                   | LessThanLowerThreshold    | ignore                 | `2/4/300/3/Minimum/2/LessThanLowerThreshold/ignore`               |
| `autoalarm:swap-usage`               | No                       | Yes                        | 100000000         | 256000000          | 300    | 3                  | Maximum   | 2                   | GreaterThanThreshold      | ignore                 | `100000000/256000000/300/3/Maximum/2/GreaterThanThreshold/ignore` |
| `autoalarm:write-latency`            | No                       | Yes                        | 0.5               | 1                  | 60     | 12                 | Maximum   | 9                   | GreaterThanThreshold      | ignore                 | `0.5/1/60/12/Maximum/9/GreaterThanThreshold/ignore`               |
| `autoalarm:write-latency-anomaly`    | Yes                      | Yes                        | 2                 | 4                  | 60     | 12                 | Maximum   | 9                   | GreaterThanUpperThreshold | ignore                 | `2/4/60/12/Maximum/9/GreaterThanUpperThreshold/ignore`            |
| `autoalarm:write-throughput-anomaly` | No                       | Yes                        | 2                 | 4                  | 60     | 12                 | Maximum   | 9                   | GreaterThanUpperThreshold | ignore                 | `2/4/60/12/Maximum/9/GreaterThanUpperThreshold/ignore`            |
| `autoalarm:read-latency`             | No                       | Yes                        | 1                 | 2                  | 60     | 12                 | Maximum   | 9                   | GreaterThanThreshold      | ignore                 | `1/2/60/12/Maximum/9/GreaterThanThreshold/ignore`                 |
| `autoalarm:read-latency-anomaly`     | Yes                      | Yes                        | 2                 | 4                  | 60     | 12                 | Maximum   | 9                   | GreaterThanUpperThreshold | ignore                 | `2/4/60/12/Maximum/9/GreaterThanUpperThreshold/ignore`            |
| `autoalarm:read-throughput-anomaly`  | No                       | Yes                        | 2                 | 4                  | 60     | 12                 | Maximum   | 9                   | GreaterThanUpperThreshold | ignore                 | `2/4/60/12/Maximum/9/GreaterThanUpperThreshold/ignore`            |



#### RDS Clusters

| Tag                                | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                         |
|------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|------------------------------------------------------------|
| `autoalarm:db-connections-anomaly` | Yes                      | Yes                        | 2                 | 4                  | 60     | 15                 | Maximum   | 12                  | GreaterThanUpperThreshold | ignore                 | `2/4/60/15/Maximum/12/GreaterThanUpperThreshold/ignore`            |
| `autoalarm:replica-lag`            | No                       | Yes                        | 30000             | 600000             | 60     | 15                 | Maximum   | 12                  | GreaterThanThreshold      | ignore                 | `30000/600000/60/15/Maximum/12/GreaterThanThreshold/ignore`        |
| `autoalarm:replica-lag-anomaly`    | Yes                      | Yes                        | 2                 | 4                  | 60     | 20                 | Maximum   | 16                  | GreaterThanUpperThreshold | ignore                 | `2/4/60/20/Maximum/16/GreaterThanUpperThreshold/ignore`            |

#### Route53Resolver

| Tag                                       | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                        |
|-------------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|-----------------------------------------------------------|
| `autoalarm:inbound-query-volume`          | Yes                      | Yes                        | 1500000           | 2000000            | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `1500000/2000000/300/1/Sum/1/GreaterThanThreshold/ignore` |
| `autoalarm:inbound-query-volume-anomaly`  | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`    |
| `autoalarm:outbound-query-volume`         | Yes                      | Yes                        | 1500000           | 2000000            | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `1500000/2000000/300/1/Sum/1/GreaterThanThreshold/ignore` |
| `autoalarm:outbound-query-volume-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore`    |

#### SQS

| Tag                                       | Alarm Created By Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|-------------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:age-of-oldest-message`         | No                       | Yes                        | -                 | -                  | 300    | 1                  | Maximum   | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Maximum/1/GreaterThanThreshold/ignore`      |
| `autoalarm:age-of-oldest-message-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:empty-receives`                | No                       | Yes                        | -                 | -                  | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:empty-receives-anomaly`        | No                       | Yes                        | -                 | -                  | 300    | 1                  | Sum       | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Sum/1/GreaterThanUpperThreshold/ignore`     |
| `autoalarm:messages-deleted`              | No                       | Yes                        | -                 | -                  | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:messages-deleted-anomaly`      | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:messages-not-visible`          | No                       | Yes                        | -                 | -                  | 300    | 1                  | Maximum   | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Maximum/1/GreaterThanThreshold/ignore`      |
| `autoalarm:messages-not-visible-anomaly`  | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:messages-received`             | No                       | Yes                        | -                 | -                  | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:messages-received-anomaly`     | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:messages-sent`                 | No                       | Yes                        | -                 | -                  | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:messages-sent-anomaly`         | No                       | Yes                        | 1                 | 1                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `1/1/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:messages-visible`              | No                       | Yes                        | -                 | -                  | 300    | 1                  | Maximum   | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Maximum/1/GreaterThanThreshold/ignore`      |
| `autoalarm:messages-visible-anomaly`      | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:sent-message-size`             | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Average/1/GreaterThanThreshold/ignore`      |
| `autoalarm:sent-message-size-anomaly`     | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |

#### Step Functions

| Tag                                      | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                    |
|------------------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|-------------------------------------------------------|
| `autoalarm:executions-failed`            | Yes                      | Yes                        | -                 | 1                  | 60     | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/1/60/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:executions-failed-anomaly`    | No                       | Yes                        | -                 | -                  | 60     | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/60/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:executions-timed-out`         | Yes                      | Yes                        | -                 | 1                  | 60     | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/1/60/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:executions-timed-out-anomaly` | No                       | Yes                        | -                 | -                  | 60     | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/60/1/Average/1/GreaterThanUpperThreshold/ignore` |


#### Target Groups (TG)

| Tag                               | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|-----------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:4xx-count`             | No                       | Yes                        | -                 | -                  | 60     | 2                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/60/2/Sum/1/GreaterThanThreshold/ignore`           |
| `autoalarm:4xx-count-anomaly`     | No                       | Yes                        | -                 | -                  | 60     | 2                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/60/2/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:5xx-count`             | No                       | Yes                        | -                 | -                  | 60     | 2                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/60/2/Sum/1/GreaterThanThreshold/ignore`           |
| `autoalarm:5xx-count-anomaly`     | Yes                      | Yes                        | 3                 | 6                  | 60     | 2                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `3/6/60/2/Average/1/GreaterThanUpperThreshold/ignore`  |
| `autoalarm:response-time`         | No                       | Yes                        | 3                 | 5                  | 60     | 2                  | p90       | 2                   | GreaterThanThreshold      | ignore                 | `3/5/60/2/p90/2/GreaterThanThreshold/ignore`           |
| `autoalarm:response-time-anomaly` | No                       | Yes                        | 2                 | 5                  | 300    | 2                  | Average   | 2                   | GreaterThanUpperThreshold | ignore                 | `2/5/300/2/Average/2/GreaterThanUpperThreshold/ignore` |
| `autoalarm:unhealthy-host-count`  | Yes                      | Yes                        | -                 | 1                  | 60     | 2                  | Maximum   | 2                   | GreaterThanThreshold      | ignore                 | `-/1/60/2/Maximum/2/GreaterThanThreshold/ignore`       |
| `autoalarm:healthy-host-count` *  | Yes                      | Yes                        | -                 | 1                  | 60     | 2                  | Maximum   | 2                   | LessThanThreshold         | ignore                 | `-/1/60/2/Maximum/2/LessThanThreshold/ignore`          |



#### Transit Gateway (TGW)

| Tag                           | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator       | Missing Data Treatment | Complete Tag Value                                     |
|-------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|---------------------------|------------------------|--------------------------------------------------------|
| `autoalarm:bytes-in`          | Yes                      | Yes                        | 187500000000      | 225000000000       | 300    | 1                  | Maximum   | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Maximum/1/GreaterThanThreshold/ignore`      |
| `autoalarm:bytes-in-anomaly`  | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |
| `autoalarm:bytes-out`         | Yes                      | Yes                        | 187500000000      | 225000000000       | 300    | 1                  | Sum       | 1                   | GreaterThanThreshold      | ignore                 | `-/-/300/1/Sum/1/GreaterThanThreshold/ignore`          |
| `autoalarm:bytes-out-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | GreaterThanUpperThreshold | ignore                 | `-/-/300/1/Average/1/GreaterThanUpperThreshold/ignore` |

#### VPN

| Tag                              | Alarm Created by Default | Standard CloudWatch Metric | Warning Threshold | Critical Threshold | Period | Evaluation Periods | Statistic | Datapoints to Alarm | Comparison Operator    | Missing Data Treatment | Complete Tag Value                                  |
|----------------------------------|--------------------------|----------------------------|-------------------|--------------------|--------|--------------------|-----------|---------------------|------------------------|------------------------|-----------------------------------------------------|
| `autoalarm:tunnel-state`         | Yes                      | Yes                        | -                 | 1                  | 300    | 1                  | Maximum   | 1                   | LessThanThreshold      | ignore                 | `-/1/300/1/Maximum/1/LessThanThreshold/ignore`      |
| `autoalarm:tunnel-state-anomaly` | No                       | Yes                        | -                 | -                  | 300    | 1                  | Average   | 1                   | LessThanLowerThreshold | ignore                 | `-/-/300/1/Average/1/LessThanLowerThreshold/ignore` |


## Guide to Customizing Alarms with Tags

When setting up non-default alarms with tags, you must provide at least one of the first two values (warning and critical
thresholds) for the tag to function correctly if the default thresholds do not contain values. Otherwise, these alarms
will not be created.

Prometheus alarms will only pull Warning and critical thresholds and periods from the tags. All other values are specific
to CloudWatch alarms and are not used in Prometheus alarms.

### Alarm Types

#### Static Threshold Alarms
- Trigger when metrics cross fixed values
- Best for metrics with consistent, predictable ranges

#### Anomaly Detection Alarms
- Trigger when metrics deviate from historical patterns
- Use tag names containing 'anomaly'
- Threshold values represent standard deviations from the baseline

## Supported Tag Values

### Threshold Configuration

| Parameter              | Static Threshold Alarms                                             | Anomaly Detection Alarms                                |
|------------------------|---------------------------------------------------------------------|---------------------------------------------------------|
| **Warning Threshold**  | Numeric value that triggers warning (e.g., `80` for 80% CPU)        | Number of standard deviations from baseline (e.g., `2`) |
| **Critical Threshold** | Numeric value that triggers critical alert (e.g., `95` for 95% CPU) | Number of standard deviations from baseline (e.g., `3`) |

### Timing Configuration

| Parameter               | Description                                               | Valid Values                                                           | Example           |
|-------------------------|-----------------------------------------------------------|------------------------------------------------------------------------|-------------------|
| **Period**              | Duration in seconds for data evaluation                   | • 10 seconds<br>• 30 seconds<br>• Multiples of 60 (60, 120, 180, etc.) | `300` (5 minutes) |
| **Datapoints to Alarm** | Number of breaching data points required to trigger alarm | Any positive integer. Must be Equal to or less than evaluation periods | `2`               |
| **Evaluation Periods**  | Total evaluation periods to consider                      | Any positive integer                                                   | `3`               |

#### Understanding Datapoints vs Periods

| Scenario        | Period | Datapoints to Alarm | Number of Periods | Result                                                    |
|-----------------|--------|---------------------|-------------------|-----------------------------------------------------------|
| Quick Response  | 60s    | 1                   | 1                 | Alarm triggers after 1 breach in 1 minute                 |
| Sustained Issue | 300s   | 2                   | 3                 | Alarm triggers when 2 out of 3 five-minute periods breach |
| Highly Tolerant | 60s    | 5                   | 10                | Alarm triggers when 5 out of 10 one-minute periods breach |

### Statistic:

**Note**: AWS has limitations on the acceptable characters for the statistic value. you cannot use spaces, '%', or '(/)'.
All stats must be the statistic followed by a number or two numbers separated by a colon. For example, `p95` or `TM2:98`.

You can use the following statistics for alarms - https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html.

| Statistic              | Example Usage                  | Description                                                                                |
|------------------------|--------------------------------|--------------------------------------------------------------------------------------------|
| **SampleCount**        | `SampleCount`                  | Number of data points during the period                                                    |
| **Sum**                | `Sum`                          | Sum of all data point values in the period                                                 |
| **Average**            | `Average`                      | Mean value (Sum/SampleCount) during the period                                             |
| **Minimum**            | `Minimum`                      | Lowest value observed during the period                                                    |
| **Maximum**            | `Maximum`                      | Highest value observed during the period                                                   |
| **Percentile**         | `p95`, `p99`                   | Value below which a percentage of data falls (e.g., p95 = 95% of data is below this value) |
| **Trimmed Mean**       | `tm90`, `TM2:98`, `TM150:1000` | Mean after excluding values outside boundaries. Can use percentages or absolute values     |
| **Interquartile Mean** | `IQM`                          | Trimmed mean of middle 50% of values (equivalent to TM25:75)                               |
| **Winsorized Mean**    | `wm98`, `WM10:90`              | Mean with outliers capped to boundary values instead of excluded                           |
| **Percentile Rank**    | `PR:300`, `PR100:2000`         | Percentage of values meeting a threshold (exclusive lower, inclusive upper)                |
| **Trimmed Count**      | `tc90`, `TC0.005:0.030`        | Number of data points within trimmed mean boundaries                                       |
| **Trimmed Sum**        | `ts90`, `TS80:`                | Sum of data points within trimmed mean boundaries (TM × TC)                                |

### Missing Data Treatment

| Tag Value      | Behavior                       |
|----------------|--------------------------------|
| `missing`      | Data point is missing          |
| `ignore`       | Current alarm state maintained |
| `breaching`    | Treated as threshold breach    |
| `notBreaching` | Treated as within threshold    |

### Valid Comparison Operators
*Note: Ensure that a valid Comparison Operator is used between static threshold and anomaly alarms.

| Alarm Type            | Comparison Operator                        | Description                                              |
|-----------------------|--------------------------------------------|----------------------------------------------------------|
| **Static Threshold**  | `GreaterThanOrEqualToThreshold`            | Alarm when metric ≥ threshold                            |
| **Static Threshold**  | `GreaterThanThreshold`                     | Alarm when metric > threshold                            |
| **Static Threshold**  | `LessThanThreshold`                        | Alarm when metric < threshold                            |
| **Static Threshold**  | `LessThanOrEqualToThreshold`               | Alarm when metric ≤ threshold                            |
| **Anomaly Detection** | `GreaterThanUpperThreshold`                | Alarm when metric exceeds upper band                     |
| **Anomaly Detection** | `LessThanLowerOrGreaterThanUpperThreshold` | Alarm when metric is outside the band (either direction) |
| **Anomaly Detection** | `LessThanLowerThreshold`                   | Alarm when metric falls below lower band                 |

## Using the Nullish Character ("-") and Implicit Values in AutoAlarm

AutoAlarm supports shorthand notation to simplify tag configuration:

### Key Concepts

- **Nullish Character (`-`)**: Disables alarm creation for warning or critical thresholds when used in place of a value.

- **Implicit Values**: Omit values you don't want to change from the [defaults](#supported-services-and-default-alarm-configurations).
  Use empty positions (`//`) to skip to later parameters while keeping defaults for earlier ones.

### Examples
*Note: When using implicit values, ensure that each implicit parameter leading up to the custom parameter is properly seperated by a `/`. See [Tag Value Structure](#Tag-Value-Structure). 
Empty positions between slashes (`//`) preserve the default values for those parameters while allowing you to customize later parameters.

| Tag Key                        | Tag Value                                                         | Result                                                                                                            |
|--------------------------------|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `autoalarm:storage`            | `66/89/120/15/Average/12/GreaterThanOrEqualToThreshold/breaching` | Fully customized warning and critical alarms                                                                      |
| `autoalarm:cpu`                | `-/95/60/5/Maximum/5/GreaterThanThreshold/ignore`                 | Warning alarm disabled with `-`, critical alarm customized                                                        |
| `autoalarm:memory`             | `-/-`                                                             | Both alarms disabled (useful for overriding default Alarms)                                                       |
| `autoalarm:4xx-errors`         | `//3/Minimum///notBreaching`                                      | Only period (3) and statistic (Minimum) customized, uses defaults for thresholds                                  |
| `autoalarm:5xx-errors`         | `-/73////3`                                                       | Warning disabled, critical threshold=73, datapoints=7, other values from defaults                                 |
| `autoalarm:4xx-errors-anomaly` | `3/-/`                                                            | Warning threshold=3, critical alarm disabled, remaining values from defaults                                      |
| `autoalarm:network-in-anomaly` | `/`                                                               | Creates a non-default alarm with default values. Useful shorthand for deploying non default alarms with defaults. |

## ReAlarm Tag Configuration and Behavior:

### Overview

The ReAlarm function is an AWS Lambda-based handler designed to monitor and reset CloudWatch alarms that are in an
"ALARM" state. It is an optional part of the AutoAlarm system, aimed at ensuring alarms are not missed or ignored.

> **Important:** By default, ReAlarm resets **every** CloudWatch alarm in the account that is in `ALARM` state — not
> only AutoAlarm-managed alarms. Individual alarms can opt out by setting the `autoalarm:re-alarm-enabled=false` tag.
> Alarms with AutoScaling actions are excluded automatically.

### Default Values

By default, the ReAlarm function is enabled. When ReAlarm is enabled, it runs on a default schedule of every 120 minutes.

### Configure ReAlarm Behavior with Tags

ReAlarm's behavior can be configured on a per-alarm basis using tags.

- **Customize ReAlarm Schedule**:
    - The ReAlarm schedule by default runs every 120 minutes.
    - ReAlarm can be customized to run at different intervals on a per-alarm basis by setting the `autoalarm:re-alarm-minutes`
      tag to a whole number value.
    - The value must be between **5** and **1440** (one day) minutes, inclusive. Values outside these bounds are
      treated as invalid and any existing per-alarm schedule is removed.
- **Disable ReAlarm for a Resource**:
    - Alarms can be tagged with `autoalarm:re-alarm-enabled=false` to exclude them from the ReAlarm process.
    - When this tag is present on an alarm, ReAlarm will skip resetting it, regardless of its state.
    - This is useful for alarms that should be managed manually or have specific conditions that should not trigger ReAlarm.
    - ReAlarm discovers these tags in bulk via the Resource Groups Tagging API, whose data is eventually consistent —
      a tag added or removed shortly before a scheduled run may not take effect until the next cycle (typically within
      minutes).

**Example**

| Tag                          | Value             | Description                     |
|------------------------------|-------------------|---------------------------------|
| `autoalarm:re-alarm-enabled` | `false`           | Disable ReAlarm for this alarm  |
| `autoalarm:re-alarm-minutes` | `30`, `60`, `240` | Custom reset interval (minutes) |

#### Special Note:

ReAlarm is hardcoded to NOT reset alarms associated with AutoScaling actions. This is to prevent the function from
interfering with scaling operations.

## Additional References:
- For Deployment and install instructions, please see [DEPLOYMENT.md](DEPLOYMENT.md)
- For a more thorough breakdown of Design and Architecture, please see [ARCHITECTURE.MD](ARCHITECTURE.md).
