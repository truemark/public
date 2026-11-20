import {Duration, RemovalPolicy} from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import type {IKey} from 'aws-cdk-lib/aws-kms';
import {Queue, QueueEncryption} from 'aws-cdk-lib/aws-sqs';
import type {Construct} from 'constructs';

/**
 * Properties for a StandardDeadLetterQueue.
 */
export interface StandardDeadLetterQueueProps {
  /**
   * A name for the queue. Default is a CloudFormation-generated name.
   */
  readonly queueName?: string;

  /**
   * The number of seconds that Amazon SQS retains a message. Default is 14 days.
   *
   * You can specify an integer value from 60 seconds (1 minute) to 1209600
   * seconds (14 days). The default value is 14 days.
   */
  readonly retentionPeriod?: Duration;

  /**
   * Whether the contents of the queue are encrypted, and by what type of key. Default is SQS_MANAGED.
   */
  readonly encryption?: QueueEncryption;

  /**
   * External KMS key to use for queue encryption. Only used is encryption is set to KMS.
   */
  readonly encryptionMasterKey?: IKey;

  /**
   * The length of time that Amazon SQS reuses a data key before calling KMS again. Default is Duration.minutes(5).
   */
  readonly dataKeyReuse?: Duration;

  /**
   * Policy to apply when the queue is removed from the stack. Default is RemovalPolicy.DESTROY.
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Enforce encryption of data in transit. Default is true.
   */
  readonly enforceSSL?: boolean;

  /**
   * The number of messages in this queue before an alarm is triggered. Default is 1.
   */
  readonly alarmThreshold?: number;

  /**
   * Create the alarm on the number of visible messages in this queue. Set to
   * false when something else already alarms on this queue's depth.
   *
   * @default true
   */
  readonly createAlarm?: boolean;

  /**
   * The duration of the wait time for receiving messages. Default is Duration.seconds(20).
   */
  readonly receiveMessageWaitTime?: Duration;

  /**
   * Sets the queue as a fifo queue. Default is false.
   *
   * @default false
   */
  readonly fifo?: boolean;
}

/**
 * Standard dead letter queue implementation with an alarm that triggers when messages are received,
 * unless `createAlarm` is false.
 */
export class StandardDeadLetterQueue extends Queue {
  private readonly _alarm?: Alarm;

  /**
   * The alarm on the number of visible messages in this queue.
   *
   * @throws if the queue was created with `createAlarm: false`
   */
  get alarm(): Alarm {
    // A getter rather than an optional field keeps the published type `Alarm`,
    // so existing consumers that read it without a guard still compile.
    if (this._alarm === undefined) {
      throw new Error(
        `${this.node.path} has no alarm: it was created with createAlarm: false`,
      );
    }
    return this._alarm;
  }

  constructor(
    scope: Construct,
    id: string,
    props?: StandardDeadLetterQueueProps,
  ) {
    super(scope, id, {
      queueName: props?.queueName,
      retentionPeriod: props?.retentionPeriod ?? Duration.days(14),
      encryption: props?.encryption ?? QueueEncryption.SQS_MANAGED,
      encryptionMasterKey: props?.encryptionMasterKey,
      dataKeyReuse: props?.dataKeyReuse,
      removalPolicy: props?.removalPolicy ?? RemovalPolicy.DESTROY,
      enforceSSL: props?.enforceSSL ?? true,
      receiveMessageWaitTime:
        props?.receiveMessageWaitTime ?? Duration.seconds(20),
      ...(props?.fifo && {fifo: true}),
    });

    if (props?.createAlarm ?? true) {
      this._alarm = new Alarm(this, 'Alarm', {
        metric: this.metricApproximateNumberOfMessagesVisible(),
        threshold: props?.alarmThreshold ?? 1,
        evaluationPeriods: 1,
        treatMissingData: TreatMissingData.IGNORE,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }
  }
}
