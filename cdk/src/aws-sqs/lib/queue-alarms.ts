import {Duration} from 'aws-cdk-lib';
import {Queue} from 'aws-cdk-lib/aws-sqs';
import {Construct} from 'constructs';
import {
  AlarmsBase,
  AlarmsCategoryOptions,
  AlarmsOptions,
} from '../../aws-monitoring/index';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * Category options for CloudWatch alarms for Queues.
 */
export interface QueueAlarmsCategoryOptions extends AlarmsCategoryOptions {
  /**
   * Minimum number of messages visible.
   */
  readonly minSize?: number;

  /**
   * Maximum number of messages visible.
   */
  readonly maxSize?: number;

  /**
   * Maximum approximate age of the oldest message in the queue.
   *
   * @default 15 for critical alarm
   */
  readonly maxAgeInSeconds?: number;

  /**
   * Maximum time to drain the queue.
   */
  readonly maxTimeToDrain?: Duration;

  /**
   * Minimum number of incoming messages.
   */
  readonly minIncoming?: number;

  /**
   * Maximum number of incoming messages.
   */
  readonly maxIncoming?: number;

  /**
   * Maximum number of visible messages in the dead-letter queue
   *
   * @default 0 for critical alarm
   */
  readonly deadLetterQueueMaxSize?: number;

  /**
   * Maximum age of the oldest messages in the dead-letter queue
   */
  readonly deadLetterQueueMaxAgeInSeconds?: number;

  /**
   * Maximum number of incoming messages in the dead-letter queue
   */
  readonly deadLetterQueueMaxIncoming?: number;
}

/**
 * Options for CloudWatch alarms for Queues.
 */
export interface QueueAlarmsOptions extends AlarmsOptions<QueueAlarmsCategoryOptions> {
  /**
   * Flag to create alarms.
   *
   * @default true
   */
  readonly createAlarms?: boolean;

  /**
   * Name to use for alarm, default is construct ID.
   */
  readonly alarmFriendlyName?: string;
}

/**
 * Properties for QueueAlarms
 */
export interface QueueAlarmsProps extends QueueAlarmsOptions {
  /**
   * The queue to observe.
   */
  readonly queue: Queue;
}

/**
 * Creates CloudWatch alarms for Queues.
 */
export class QueueAlarms extends AlarmsBase<
  QueueAlarmsCategoryOptions,
  QueueAlarmsProps
> {
  private addQueueMonitoring() {
    if (this.monitoringFacade === undefined) {
      throw new Error('monitoringFacade is undefined');
    }
    if (this.props.queue.deadLetterQueue === undefined) {
      this.monitoringFacade.monitorSqsQueue({
        alarmFriendlyName: this.props.alarmFriendlyName,
        queue: this.props.queue,
        addQueueMinSizeAlarm: this.toRecord('minSize', 'minMessageCount'),
        addQueueMaxSizeAlarm: this.toRecord('maxSize', 'maxMessageCount'),
        addQueueMaxMessageAgeAlarm: this.toRecord(
          'maxAgeInSeconds',
          'maxAgeInSeconds',
          15,
        ),
        addQueueMaxTimeToDrainMessagesAlarm: this.toRecord(
          'maxTimeToDrain',
          'maxTimeToDrain',
        ),
        addQueueMinIncomingMessagesAlarm: this.toRecord(
          'minIncoming',
          'minIncomingMessagesCount',
        ),
        addQueueMaxIncomingMessagesAlarm: this.toRecord(
          'maxIncoming',
          'maxIncomingMessagesCount',
        ),
      });
    } else {
      this.monitoringFacade.monitorSqsQueueWithDlq({
        alarmFriendlyName: this.props.alarmFriendlyName,
        queue: this.props.queue,
        deadLetterQueue: this.props.queue.deadLetterQueue.queue,
        addQueueMinSizeAlarm: this.toRecord('minSize', 'minMessageCount'),
        addQueueMaxSizeAlarm: this.toRecord('maxSize', 'maxMessageCount'),
        addQueueMaxMessageAgeAlarm: this.toRecord(
          'maxAgeInSeconds',
          'maxAgeInSeconds',
          15,
        ),
        addQueueMaxTimeToDrainMessagesAlarm: this.toRecord(
          'maxTimeToDrain',
          'maxTimeToDrain',
        ),
        addQueueMinIncomingMessagesAlarm: this.toRecord(
          'minIncoming',
          'minIncomingMessagesCount',
        ),
        addQueueMaxIncomingMessagesAlarm: this.toRecord(
          'maxIncoming',
          'maxIncomingMessagesCount',
        ),
        addDeadLetterQueueMaxSizeAlarm: this.toRecord(
          'deadLetterQueueMaxSize',
          'maxMessageCount',
          0,
        ),
        addDeadLetterQueueMaxMessageAgeAlarm: this.toRecord(
          'deadLetterQueueMaxAgeInSeconds',
          'maxAgeInSeconds',
          undefined,
          undefined,
          TreatMissingData.NOT_BREACHING,
        ),
        addDeadLetterQueueMaxIncomingMessagesAlarm: this.toRecord(
          'deadLetterQueueMaxIncoming',
          'maxIncomingMessagesCount',
          undefined,
          undefined,
          TreatMissingData.NOT_BREACHING,
        ),
        addDeadLetterQueueToSummaryDashboard: true,
      });
    }
  }

  constructor(scope: Construct, id: string, props: QueueAlarmsProps) {
    super(scope, id, props);
    if (props.createAlarms ?? true) {
      this.addQueueMonitoring();
    }
  }
}
