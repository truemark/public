/**
 * @fileoverview RDS alarm configuration definitions.
 *
 * This file contains the default configurations for all supported RDS CloudWatch alarms managed by AutoAlarm.
 *
 * @requires
 * - Approval from Owners Team lead and consultation before adding new alarms
 * - Anomaly Alarms can only use the following comparison operators: GreaterThanUpperThreshold, LessThanLowerOrGreaterThanUpperThreshold, LessThanLowerThreshold
 *
 * @Owners DB WARDEN
 */

import {MetricAlarmConfig} from '../types/index.mjs';
import {ComparisonOperator} from '@aws-sdk/client-cloudwatch';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * _RDS alarm configuration definitions.
 * Implements the {@link MetricAlarmConfig} interface.
 * Used to map a tag key to a CloudWatch metric name and namespace to default alarm configurations {@link MetricAlarmOptions}.
 */
export const RDS_CONFIGS: MetricAlarmConfig[] = [
  // 1) CPUUtilization - Static
  {
    tagKey: 'cpu',
    metricName: 'CPUUtilization',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: 90,
      criticalThreshold: 95,
      period: 60,
      evaluationPeriods: 10,
      statistic: 'Maximum',
      dataPointsToAlarm: 8,
      comparisonOperator: ComparisonOperator.GreaterThanThreshold,
      missingDataTreatment: TreatMissingData.IGNORE,
    },
  },

  // 2) DatabaseConnections - Anomaly
  {
    tagKey: 'db-connections-anomaly',
    metricName: 'DatabaseConnections',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 20,
      statistic: 'Maximum',
      dataPointsToAlarm: 16,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 3) DBLoad - Anomaly
  {
    tagKey: 'dbload-anomaly',
    metricName: 'DBLoad',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 25,
      statistic: 'Maximum',
      dataPointsToAlarm: 20,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 4) FreeableMemory - Static  (Instance size matters)
  {
    tagKey: 'freeable-memory',
    metricName: 'FreeableMemory',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: 512000000,
      criticalThreshold: 256000000,
      period: 300,
      evaluationPeriods: 3,
      statistic: 'Minimum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'LessThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 4a) FreeableMemory - Anomaly  (Instance size shouldn't matter)
  {
    tagKey: 'freeable-memory-anomaly',
    metricName: 'FreeableMemory',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 300,
      evaluationPeriods: 3,
      statistic: 'Minimum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'LessThanLowerThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 5) WriteLatency - Static (Disk Type Matters)  -- Let's discuss these values
  {
    tagKey: 'write-latency',
    metricName: 'WriteLatency',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: 0.5, //0.01
      criticalThreshold: 1.0, //0.05
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 5a) WriteLatency - Anomaly
  {
    tagKey: 'write-latency-anomaly',
    metricName: 'WriteLatency',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 6) ReadLatency - Static  (Disk Type Matters, ie. gp2, gp3, io1, io2, aurora)  --Lets discuss these threshold values
  {
    tagKey: 'read-latency',
    metricName: 'ReadLatency',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: 1.0, //0.01
      criticalThreshold: 2.0, //0.02
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 6) ReadLatency - Anomaly
  {
    tagKey: 'read-latency-anomaly',
    metricName: 'ReadLatency',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 7) SwapUsage - Static  Only static alarms for swapusage
  {
    tagKey: 'swap-usage',
    metricName: 'SwapUsage',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: 100000000,
      criticalThreshold: 256000000,
      period: 300,
      evaluationPeriods: 3,
      statistic: 'Maximum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 8) DatabaseDeadlocks - Static
  {
    tagKey: 'deadlocks',
    metricName: 'DatabaseDeadlocks',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: false,
    defaults: {
      warningThreshold: null,
      criticalThreshold: 0,
      period: 60,
      evaluationPeriods: 2,
      statistic: 'Sum',
      dataPointsToAlarm: 2,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 9) DiskQueueDepth - Static  (These should be set by disk type???)
  {
    tagKey: 'disk-queue-depth',
    metricName: 'DiskQueueDepth',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: false,
    defaults: {
      warningThreshold: 4,
      criticalThreshold: 8,
      period: 60,
      evaluationPeriods: 20,
      statistic: 'Maximum',
      dataPointsToAlarm: 15,
      comparisonOperator: 'GreaterThanThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 9a) DiskQueueDepth - Anomaly
  {
    tagKey: 'disk-queue-depth-anomaly',
    metricName: 'DiskQueueDepth',
    metricNamespace: 'AWS/RDS',
    defaultCreate: true,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 10) ReadThroughput - Anomaly
  {
    tagKey: 'read-throughput-anomaly',
    metricName: 'ReadThroughput',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 11) WriteThroughput - Anomaly
  {
    tagKey: 'write-throughput-anomaly',
    metricName: 'WriteThroughput',
    metricNamespace: 'AWS/RDS',
    defaultCreate: false,
    anomaly: true,
    defaults: {
      warningThreshold: 2,
      criticalThreshold: 4,
      period: 60,
      evaluationPeriods: 12,
      statistic: 'Maximum',
      dataPointsToAlarm: 9,
      comparisonOperator: 'GreaterThanUpperThreshold',
      missingDataTreatment: 'ignore',
    },
  },

  // 13) VolumeBytesUsed - Static  This would be dependent on storage
  // const storageGiB = dbInstance.allocatedStorage ?? 100; // fallback if undefined
  // const bytes = (gib: number) => gib * 1024 ** 3;
  //{
  //  tagKey: 'volume-used',
  //  metricName: 'VolumeBytesUsed',
  //  metricNamespace: 'AWS/RDS',
  //  defaultCreate: false,
  //  anomaly: false,
  //  defaults: {
  //    warningThreshold: bytes(storageGiB) * 0.75,
  //    criticalThreshold: bytes(storageGiB) * 0.90,
  //    period: 300,
  //    evaluationPeriods: 2,
  //    statistic: 'Average',
  //    dataPointsToAlarm: 2,
  //    comparisonOperator: 'GreaterThanThreshold',
  //    missingDataTreatment: 'ignore',
  // },
  //},
  // add more as needed
] as const;
