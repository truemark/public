import {Construct} from 'constructs';
import {IAlarm, IAlarmAction, Metric} from 'aws-cdk-lib/aws-cloudwatch';
import {RemovalPolicy, ResourceEnvironment, Stack} from 'aws-cdk-lib';
import {ExtendedAlarm, ExtendedCreateAlarmOptions} from './extended-alarm';
import {ITopic} from 'aws-cdk-lib/aws-sns';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';

export interface MetricAlarmBaseProps extends ExtendedCreateAlarmOptions {
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
}

export abstract class MetricAlarmBase<P extends MetricAlarmBaseProps>
  extends Construct
  implements IAlarm
{
  readonly alarm: ExtendedAlarm;
  readonly metric: Metric;

  // From IAlarm
  readonly alarmArn: string;
  readonly alarmName: string;
  readonly env: ResourceEnvironment;
  readonly stack: Stack;

  protected abstract createMetric(props: P): Metric;

  protected abstract createAlarm(metric: Metric, props: P): ExtendedAlarm;

  constructor(scope: Construct, id: string, props: P) {
    super(scope, id);
    this.metric = this.createMetric(props);
    this.alarm = this.createAlarm(this.metric, props);
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

  // From IAlarm
  renderAlarmRule(): string {
    return this.alarm.renderAlarmRule();
  }
}
