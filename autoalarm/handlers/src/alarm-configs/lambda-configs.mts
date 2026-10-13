/**
 * @fileoverview LAMBDA alarm configuration definitions.
 *
 * This file contains the default configurations for all supported LAMBDA CloudWatch alarms managed by AutoAlarm.
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
 * LAMBDA alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const LAMBDA_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'errors',
    metricName: 'Errors',
    metricNamespace: 'AWS/Lambda',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      // "Any error triggers the alarm": Errors is a Sum, so a single error in
      // a period gives Sum=1. Use >= 1 (not > 1, which would require 2 errors,
      // and not > 0 which is equivalent but less explicit) so one error fires.
      criticalThreshold: 1,
      period: 60,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanOrEqualToThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
] as const;
