/**
 * @fileoverview TRANSIT_GATEWAY alarm configuration definitions.
 *
 * This file contains the default configurations for all supported TRANSIT_GATEWAY CloudWatch alarms managed by AutoAlarm.
 *
 * @requires
 * - Approval from Owners Team lead and consultation before adding new alarms
 * - Anomaly Alarms can only use the following comparison operators: GreaterThanUpperThreshold, LessThanLowerOrGreaterThanUpperThreshold, LessThanLowerThreshold
 *
 * @Owners NETWORKING
 */

import {MetricAlarmConfig} from '../types/index.mjs';
import {ComparisonOperator} from '@aws-sdk/client-cloudwatch';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * _TRANSIT_GATEWAY alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const TRANSIT_GATEWAY_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'bytes-in',
    metricName: 'BytesIn',
    metricNamespace: 'AWS/TransitGateway',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 187500000000,
      criticalThreshold: 225000000000,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'bytes-in-anomaly',
    metricName: 'BytesIn',
    metricNamespace: 'AWS/TransitGateway',
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
    tagKey: 'bytes-out',
    metricName: 'BytesOut',
    metricNamespace: 'AWS/TransitGateway',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 187500000000,
      criticalThreshold: 225000000000,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'bytes-out-anomaly',
    metricName: 'BytesOut',
    metricNamespace: 'AWS/TransitGateway',
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
