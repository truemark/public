/**
 * @fileoverview ALB alarm configuration definitions.
 *
 * This file contains the default configurations for all supported ALB CloudWatch alarms managed by AutoAlarm.
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
 * _ALB alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const ALB_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: '4xx-count',
    metricName: 'HTTPCode_Target_4XX_Count',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Sum',
      dataPointsToAlarm: 2,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: '4xx-count-anomaly',
    metricName: 'HTTPCode_Target_4XX_Count',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: '5xx-count',
    metricName: 'HTTPCode_Target_5XX_Count',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Sum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: '5xx-count-anomaly',
    metricName: 'HTTPCode_Target_5XX_Count',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 300,
      evaluationPeriods: 2,
      statistic: 'Average',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'request-count',
    metricName: 'RequestCount',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Sum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'request-count-anomaly',
    metricName: 'RequestCount',
    metricNamespace: 'AWS/ApplicationELB',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 3,
      criticalThreshold: 5,
      period: 300,
      evaluationPeriods: 2,
      statistic: 'Average',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  //TODO: Add Target response times
] as const;
