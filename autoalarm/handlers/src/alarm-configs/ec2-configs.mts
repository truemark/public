/**
 * @fileoverview EC2 alarm configuration definitions.
 *
 * This file contains the default configurations for all supported EC2 CloudWatch alarms managed by AutoAlarm.
 *
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
 * _EC2 alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const EC2_CONFIGS: MetricAlarmConfig[] = [
  {
    tagKey: 'cpu',
    metricName: 'CPUUtilization',
    metricNamespace: 'AWS/EC2',
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
    metricNamespace: 'AWS/EC2',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Average',
      dataPointsToAlarm: 5,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'memory',
    metricName: '', // Empty string to account for divergent metric names between windows and linux instances for EC2 storage and memory configs. Assigned programmatically in ec2-modules.
    metricNamespace: 'CWAgent',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 95,
      criticalThreshold: 98,
      period: 60,
      evaluationPeriods: 10,
      statistic: 'Maximum',
      dataPointsToAlarm: 10,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'memory-anomaly',
    metricName: '', // Empty string to account for divergent metric names between windows and linux instances for EC2 storage and memory configs. Assigned programmatically in ec2-modules.
    metricNamespace: 'CWAgent',
    defaultCreate: false,
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
    tagKey: 'storage',
    metricName: '', // Empty string to account for divergent metric names between windows and linux instances for EC2 storage and memory configs. Assigned programmatically in ec2-modules.
    metricNamespace: 'CWAgent',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 90,
      criticalThreshold: 95,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Maximum',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'storage-anomaly',
    metricName: '', // Empty string to account for divergent metric names between windows and linux instances for EC2 storage and memory configs. Assigned programmatically in ec2-modules.
    metricNamespace: 'CWAgent',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 3,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Average',
      dataPointsToAlarm: 1,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  // TODO: network in and out still need to be passed off by devops
  //  and are disabled by default and not referenced in README.
  //  construct does not currently listen for tags on these.
  {
    tagKey: 'network-in',
    metricName: 'NetworkIn',
    metricNamespace: 'AWS/EC2',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Sum',
      dataPointsToAlarm: 5,
      comparisonOperator: 'LessThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'network-in-anomaly',
    metricName: 'NetworkIn',
    metricNamespace: 'AWS/EC2',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Average',
      dataPointsToAlarm: 5,
      comparisonOperator: 'LessThanLowerThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'network-out',
    metricName: 'NetworkOut',
    metricNamespace: 'AWS/EC2',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: null,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Sum',
      dataPointsToAlarm: 5,
      comparisonOperator: 'LessThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  {
    tagKey: 'network-out-anomaly',
    metricName: 'NetworkOut',
    metricNamespace: 'AWS/EC2',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 5,
      period: 60,
      evaluationPeriods: 5,
      statistic: 'Average',
      dataPointsToAlarm: 5,
      comparisonOperator: 'LessThanLowerThreshold',
      missingDataTreatment: 'ignore',
    },
  },
  // add more as needed
] as const;
