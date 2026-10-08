/**
 * @fileoverview ROUTE53_RESOLVER alarm configuration definitions.
 *
 * This file contains the default configurations for all supported ROUTE53_RESOLVER CloudWatch alarms managed by AutoAlarm.
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
 * _ROUTE53_RESOLVER alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const ROUTE53_RESOLVER_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'inbound-query-volume',
    metricName: 'InboundQueryVolume',
    metricNamespace: 'AWS/Route53Resolver',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 1500000,
      criticalThreshold: 2000000,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'inbound-query-volume-anomaly',
    metricName: 'InboundQueryVolume',
    metricNamespace: 'AWS/Route53Resolver',
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
    tagKey: 'outbound-query-volume',
    metricName: 'OutboundQueryAggregateVolume',
    metricNamespace: 'AWS/Route53Resolver',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 1500000,
      criticalThreshold: 2000000,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Sum',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'outbound-query-volume-anomaly',
    metricName: 'OutboundQueryAggregateVolume',
    metricNamespace: 'AWS/Route53Resolver',
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
