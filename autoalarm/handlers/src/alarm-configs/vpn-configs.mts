/**
 * @fileoverview VPN alarm configuration definitions.
 *
 * This file contains the default configurations for all supported VPN CloudWatch alarms managed by AutoAlarm.
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
 * _VPN alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const VPN_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'tunnel-state',
    metricName: 'TunnelState',
    metricNamespace: 'AWS/VPN',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      // TunnelState is 0/1 (Maximum across tunnels). Fires when Maximum < 1, i.e. all tunnels are down.
      criticalThreshold: 1,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Maximum',
      dataPointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.LessThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },
  {
    tagKey: 'tunnel-state-anomaly',
    metricName: 'TunnelState',
    metricNamespace: 'AWS/VPN',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 300,
      evaluationPeriods: 1,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'LessThanLowerThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  // add more as needed
] as const;
