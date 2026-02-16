import {
  Alarm,
  ComparisonOperator,
  IAlarm,
  IAlarmAction,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import {Construct} from 'constructs';
import {LogMetricFilter, LogMetricFilterProps} from './log-metric-filter';
import {Duration, RemovalPolicy, ResourceEnvironment, Stack} from 'aws-cdk-lib';
import {ITopic} from 'aws-cdk-lib/aws-sns';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';

/**
 * Properties for LogAlarm.
 */
export interface LogMetricAlarmProps extends LogMetricFilterProps {
  /**
   * The period over which statistics are applied
   *
   * Default is 5 minutes.
   */
  readonly period?: Duration;

  // Below are fields from CreateAlarmOptions which we need to override

  /**
   * Name of the alarm
   *
   * @default Automatically generated name
   */
  readonly alarmName?: string;

  /**
   * Description for the alarm
   *
   * @default No description
   */
  readonly alarmDescription?: string;

  /**
   * Comparison to use to check if metric is breaching
   *
   * @default GreaterThanOrEqualToThreshold
   */
  readonly comparisonOperator?: ComparisonOperator;

  /**
   * The value against which the specified statistic is compared.
   *
   * @default 1
   */
  readonly threshold?: number;

  /**
   * The number of periods over which data is compared to the specified threshold.
   *
   * @default 2
   */
  readonly evaluationPeriods?: number;

  /**
   * Specifies whether to evaluate the data and potentially change the alarm state if there are too few data points to be statistically significant.
   *
   * Used only for alarms that are based on percentiles.
   *
   * @default - Not configured.
   */
  readonly evaluateLowSampleCountPercentile?: string;

  /**
   * Sets how this alarm is to handle missing data points.
   *
   * @default TreatMissingData.IGNORE
   */
  readonly treatMissingData?: TreatMissingData;

  /**
   * Whether the actions for this alarm are enabled
   *
   * @default true
   */
  readonly actionsEnabled?: boolean;

  /**
   * The number of datapoints that must be breaching to trigger the alarm. This is used only if you are setting an "M
   * out of N" alarm. In that case, this value is the M. For more information, see Evaluating an Alarm in the Amazon
   * CloudWatch User Guide.
   *
   * @default 1
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation
   */
  readonly datapointsToAlarm?: number;
}

/**
 * CloudWatch alarm that matches patterns on a LogGroup. This class is a higher-level
 * construct than LogMetricAlarm and will create the filter and metric.
 */
export class LogMetricAlarm extends Construct implements IAlarm {
  readonly filter: LogMetricFilter;
  readonly alarm: Alarm;
  readonly metric: Metric;

  // From IAlarm
  readonly alarmArn: string;
  readonly alarmName: string;
  readonly env: ResourceEnvironment;
  readonly stack: Stack;

  constructor(scope: Construct, id: string, props: LogMetricAlarmProps) {
    super(scope, id);

    this.filter = new LogMetricFilter(this, 'Filter', {
      ...props,
    });

    this.metric = this.filter.sumMetric(props.period);

    this.alarm = new Alarm(this, 'Alarm', {
      ...props,
      threshold: props.threshold ?? 1,
      evaluationPeriods: props.evaluationPeriods ?? 2,
      datapointsToAlarm: props.datapointsToAlarm ?? 1,
      treatMissingData: props.treatMissingData ?? TreatMissingData.IGNORE,
      metric: this.metric,
    });

    this.alarmArn = this.alarm.alarmArn;
    this.alarmName = this.alarm.alarmName;
    this.env = this.alarm.env;
    this.stack = this.alarm.stack;
  }

  /**
   * Notify SNS topics if the alarm fires.
   *
   * @param topics the topics to notify
   */
  addAlarmTopic(...topics: ITopic[]): void {
    this.alarm.addAlarmAction(...topics.map((topic) => new SnsAction(topic)));
  }

  /**
   * Notify SNS topics if the alarm returns from breaching a state into an ok state.
   *
   * @param topics the topics to notify
   */
  addOkTopic(...topics: ITopic[]): void {
    this.alarm.addOkAction(...topics.map((topic) => new SnsAction(topic)));
  }

  /**
   * Notify SNS topics if there is insufficient data to evaluate the alarm.
   *
   * @param topics the topics to notify
   */
  addInsufficientDataTopic(...topics: ITopic[]): void {
    this.alarm.addInsufficientDataAction(
      ...topics.map((topic) => new SnsAction(topic)),
    );
  }

  /**
   * Trigger actions if the alarm fires.
   *
   * @param actions the actions to trigger
   */
  addAlarmAction(...actions: IAlarmAction[]): void {
    return this.alarm.addAlarmAction(...actions);
  }

  /**
   * Trigger actions if there is insufficient data to evaluate the alarm.
   *
   * @param actions the actions to trigger
   */
  addInsufficientDataAction(...actions: IAlarmAction[]): void {
    return this.alarm.addInsufficientDataAction(...actions);
  }

  /**
   * Trigger actions if the alarm returns from breaching a state into an ok state.
   *
   * @param actions the actions to trigger
   */
  addOkAction(...actions: IAlarmAction[]): void {
    return this.alarm.addOkAction(...actions);
  }

  // From IAlarm

  applyRemovalPolicy(policy: RemovalPolicy): void {
    this.alarm.applyRemovalPolicy(policy);
  }

  renderAlarmRule(): string {
    return this.alarm.renderAlarmRule();
  }
}
