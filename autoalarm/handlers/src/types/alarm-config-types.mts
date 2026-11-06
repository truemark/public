import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';
import {
  ComparisonOperator,
  MetricAlarm,
  Statistic,
} from '@aws-sdk/client-cloudwatch';

//=============================================================================
// Statistic Typing
//=============================================================================
/**
 * Includes the following extended statistic patterns:
 *
 * - Interquartile Mean (`IQM`): Mean of the middle 50% of data points.
 * - Percentiles (`p90`): Simple percentile-based statistics.
 * - Trimmed Mean (`tm90`, `TM(10%:90%)`): Statistical average computed by trimming outlier data points beyond specified percentile bounds.
 * - Winsorized Mean (`wm90`, `WM(10%:90%)`): Modified average where data outside of bounds are clamped, not discarded.
 * - Trimmed Count (`tc90`, `TC(10%:90%)`): Count of data points remaining after trimming percentile ranges.
 * - Trimmed Sum (`ts90`, `TS(10%:90%)`): Sum of values within boarders after data trimming.
 * - Percentile Rank (`PR(100:2000)`): Percentage of total data points falling between specified absolute numeric bounds.
 *
 * @see {@link https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html}
 */
export type ValidExtendedStat =
  | 'IQM'
  | `p${number}`
  | `tm${number}`
  | `tc${number}`
  | `ts${number}`
  | `wm${number}`
  | `TM(${string})`
  | `WM(${string})`
  | `TC(${string})`
  | `TS(${string})`
  | `PR(${string})`;

/**
 * **Important**:
 * When calling AWS CloudWatch APIs (such as `PutMetricAlarm`) and specifying a `MetricName`,
 * you must specify either a standard `Statistic` (such as `"Average"`) or an `ExtendedStatistic`
 * (such as `"p90"` or `"TM(5%:95%)"`), **but never both**.
 *
 *
 * @see {@link Statistic} - Type for standard statistics
 * @see {@link ValidExtendedStat} - Type for extended statistics
 */
export type ValidStatistic = Statistic | ValidExtendedStat;

//=============================================================================
// Missing Data Treatment Typing
//=============================================================================

/**
 * Specifies how CloudWatch handles missing data points when evaluating an alarm.
 *
 * @Important DO NOT CHANGE THIS TYPE: It is derived from the AWS SDK and
 * the CDK library. This type allows us to match the putMetricAlarm interface
 * used to create alarms by enforcing valid values for missing data treatment
 * in the CDK lib and matching the type for the interface used to create alarms
 * in the AWS SDK lib which is typed as 'string | undefined'.
 *
 * @see {@link TreatMissingData}
 * @see {@link MetricAlarm} - AWS SDK interface used for creating alarms - `TreatMissingData` property
 */
export type MissingDataTreatment = TreatMissingData[keyof TreatMissingData] &
  MetricAlarm['TreatMissingData'];

//=============================================================================
// Metric Alarm Options and Config Interfaces
//=============================================================================
/**
 * Options for configuring CloudWatch metric alarms.
 *
 * @see {@link MetricAlarmConfig}
 * @see {@link https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation-criteria}
 * @see {@link https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html}
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-cloudwatch/Interface/PutMetricAlarmCommandInput/}
 *
 * @interface MetricAlarmOptions
 *
 */
export interface MetricAlarmOptions {
  /** Anomaly: Based on a standard deviation. Higher number means thicker band, lower number means thinner band.
   * Non-Anomaly: The value against which the specified statistic is compared.
   */
  warningThreshold: number | null;
  /**
   * Anomaly: Based on a standard deviation. Higher number means thicker band, lower number means thinner band.
   * Non-Anomaly: The value against which the specified statistic is compared.
   */
  criticalThreshold: number | null;
  /**
   * The polling period in seconds or minutes. Verify in AWS documentation before assuming the number is milliseconds, seconds or minutes.
   * Varies across services.
   */
  period: number;
  /**
   * The number of periods that are evaluated when tracking datapoints to alarm.
   * Creates a rolling observability window of n times the period.
   */
  evaluationPeriods: number;
  /**
   * The number of data points to alarm across all evaluation periods.
   */
  dataPointsToAlarm: number;
  /**
   * Valid Cloudwatch Alarm statistics see {@link ValidStatistic} for all valid statistic values
   *
   */
  statistic: ValidStatistic;
  /**
   * Specifies how missing data points are treated during alarm evaluation. See {@link TreatMissingData} for valid
   * missing data treatment options
   *
   */
  missingDataTreatment: MissingDataTreatment;
  /**
   * Represents Both an Enum and valid string literal values for CloudWatch alarm comparison operators.
   * This type extracts the actual string values from the `ComparisonOperator` enum
   * for type-safe handling of comparison operator strings.
   *
   * ---
   * @see {@link https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.ComparisonOperator.html}
   * @see {@link https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html}
   * @see {@link ComparisonOperator} - Enum and Type declaration
   */
  comparisonOperator: ComparisonOperator;
}

/**
 * Configuration for creating CloudWatch metric alarms.
 * Defines the core settings and default options for a specific metric alarm.
 *
 * @interface MetricAlarmConfig
 *
 */
export interface MetricAlarmConfig {
  /**
   *   The tag key used to identify the Metric Alarm configuration.
   *   Resources with this tag will have alarms created according to this configuration.
   */
  tagKey: string;
  /**
   *   The name of the CloudWatch metric to monitor with this alarm.
   *   Must be a valid CloudWatch metric name.
   */
  metricName: string;
  /**
   *  The namespace of the CloudWatch metric.
   *  Metrics are grouped by namespaces (e.g., "AWS/EC2", "AWS/Lambda", etc...).
   */
  metricNamespace: string;
  /**
   *  Indicates whether alarms should be created by default when tag autoalarm:enabled = true.
   */
  defaultCreate: boolean;
  /**
   *  Indicates whether this alarm is based on anomaly detection.
   *  If true, the alarm will use anomaly detection models instead of standard metrics. If false, it defaults to static threshold alarms.
   */
  anomaly: boolean;
  /**
   * These are the Default values provided in the Alarm Config object.
   * @see {@link MetricAlarmOptions} for the structure of these options
   */
  defaults: MetricAlarmOptions;
}
