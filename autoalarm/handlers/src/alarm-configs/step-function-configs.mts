/**
 * @fileoverview STEP_FUNCTION alarm configuration definitions.
 *
 * This file contains the default configurations for all supported STEP_FUNCTION CloudWatch alarms managed by AutoAlarm.
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
 * _STEP_FUNCTION alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const STEP_FUNCTION_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'executions-failed',
    metricName: 'ExecutionsFailed',
    metricNamespace: 'AWS/States',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: 1,
      period: 60,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'executions-failed-anomaly',
    metricName: 'ExecutionsFailed',
    metricNamespace: 'AWS/States',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'executions-timed-out',
    metricName: 'ExecutionsTimedOut',
    metricNamespace: 'AWS/States',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: 1,
      period: 60,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'executions-timed-out-anomaly',
    metricName: 'ExecutionsTimedOut',
    metricNamespace: 'AWS/States',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  // add more as needed
] as const;
