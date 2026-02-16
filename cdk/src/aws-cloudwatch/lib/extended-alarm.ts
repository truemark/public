import {Alarm, AlarmProps, IAlarmAction} from 'aws-cdk-lib/aws-cloudwatch';
import {ITopic} from 'aws-cdk-lib/aws-sns';
import {Construct} from 'constructs';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';

/**
 * Extra options for ExtendedAlarmProps
 */
export interface ExtendedCreateAlarmOptions {
  /**
   * Topics to notify if alarm is breached.
   */
  readonly alarmTopics?: ITopic[];

  /**
   * Topics to notify when alarm returns to an ok status.
   */
  readonly okTopics?: ITopic[];

  /**
   * Topics to notify when alarm has insufficient data.
   */
  readonly insufficientDataTopic?: ITopic[];

  /**
   * Actions to trigger when alarm is breached.
   */
  readonly alarmActions?: IAlarmAction[];

  /**
   * Actions to take when alarm returns to an ok status.
   */
  readonly okActions?: IAlarmAction[];

  /**
   * Actions to take when an alarm has insufficient data.
   */
  readonly insufficientDataActions?: IAlarmAction[];
}

/**
 * Properties for ExtendedAlarm
 */
export interface ExtendedAlarmProps
  extends ExtendedCreateAlarmOptions, AlarmProps {}

/**
 * Adds convenience properties and methods to Alarm.
 */
export class ExtendedAlarm extends Alarm {
  constructor(scope: Construct, id: string, props: ExtendedAlarmProps) {
    super(scope, id, props);
    if (props.alarmTopics) {
      this.addAlarmTopic(...props.alarmTopics);
    }
    if (props.okTopics) {
      this.addOkTopic(...props.okTopics);
    }
    if (props.insufficientDataTopic) {
      this.addInsufficientDataTopic(...props.insufficientDataTopic);
    }
    if (props.alarmActions) {
      this.addAlarmAction(...props.alarmActions);
    }
    if (props.okActions) {
      this.addAlarmAction(...props.okActions);
    }
    if (props.insufficientDataActions) {
      this.addAlarmAction(...props.insufficientDataActions);
    }
  }

  /**
   * Convenience method for adding SNS topics as alarm actions.
   *
   * @param topics the topics to notify
   */
  addAlarmTopic(...topics: ITopic[]): void {
    this.addAlarmAction(...topics.map((topic) => new SnsAction(topic)));
  }

  /**
   * Convenience method for adding SNS topics as ok actions.
   *
   * @param topics the topics to notify
   */
  addOkTopic(...topics: ITopic[]): void {
    this.addOkAction(...topics.map((topic) => new SnsAction(topic)));
  }

  /**
   * Convenience method for adding SNS topics as insufficient data actions.
   *
   * @param topics the topics to notify
   */
  addInsufficientDataTopic(...topics: ITopic[]): void {
    this.addInsufficientDataAction(
      ...topics.map((topic) => new SnsAction(topic)),
    );
  }
}
