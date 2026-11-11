/**
 * @fileoverview CLOUDFRONT alarm configuration definitions.
 *
 * This file contains the default configurations for all supported CLOUDFRONT CloudWatch alarms managed by AutoAlarm.
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
 * _CLOUDFRONT alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const CLOUDFRONT_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: '4xx-errors',
    metricName: '4xxErrorRate',
    metricNamespace: 'AWS/CloudFront',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 5, // Adjust threshold based on your needs
      criticalThreshold: 10, // Adjust threshold based on your needs
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: '4xx-errors-anomaly',
    metricName: '4xxErrorRate',
    metricNamespace: 'AWS/CloudFront',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: '5xx-errors',
    metricName: '5xxErrorRate',
    metricNamespace: 'AWS/CloudFront',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 1,
      criticalThreshold: 5,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: '5xx-errors-anomaly',
    metricName: '5xxErrorRate',
    metricNamespace: 'AWS/CloudFront',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  // add more as needed
] as const;
