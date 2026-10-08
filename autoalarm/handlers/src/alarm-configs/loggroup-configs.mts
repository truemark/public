/**
 * @fileoverview LogGroup alarm configuration definitions.
 *
 * This file contains the default configurations for all supported LogGroup CloudWatch alarms managed by AutoAlarm.
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
 * LogGroup alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const LOGGROUP_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'incoming-bytes',
    metricName: 'IncomingBytes',
    metricNamespace: 'AWS/Logs',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Maximum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.LessThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'incoming-bytes-anomaly',
    metricName: 'IncomingBytes',
    metricNamespace: 'AWS/Logs',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanUpperThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
];
