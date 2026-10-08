/**
 * @fileoverview ECS alarm configuration definitions.
 *
 * This file contains the default configurations for all supported ECS CloudWatch alarms managed by AutoAlarm.
 *
 * @requires
 * - Approval from Owners Team lead and consultation before adding new alarms
 * - Anomaly Alarms can only use the following comparison operators: GreaterThanUpperThreshold, LessThanLowerOrGreaterThanUpperThreshold, LessThanLowerThreshold
 *
 * @Owners HARMONY-DEVOPS
 */

import {MetricAlarmConfig} from '../types/index.mjs';
import {ComparisonOperator} from '@aws-sdk/client-cloudwatch';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * ECS alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const ECS_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'memory',
    metricName: 'MemoryUtilization',
    metricNamespace: 'AWS/ECS',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 95,
      criticalThreshold: 98,
      period: 60,
      evaluationPeriods: 10,
      statistic: 'Maximum',
      dataPointsToAlarm: 5,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'memory-anomaly',
    metricName: 'MemoryUtilization',
    metricNamespace: 'AWS/ECS',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanUpperThreshold,
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'cpu',
    metricName: 'CPUUtilization',
    metricNamespace: 'AWS/ECS',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 95,
      criticalThreshold: 98,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Maximum',
      dataPointsToAlarm: 5,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'cpu-anomaly',
    metricName: 'CPUUtilization',
    metricNamespace: 'AWS/ECS',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanUpperThreshold,
      missingDataTreatment: 'ignore',
    },
  },
  // add more as needed
] as const;
