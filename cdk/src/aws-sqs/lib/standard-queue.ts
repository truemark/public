import {Construct} from 'constructs';
import {Duration, RemovalPolicy, ResourceEnvironment, Stack} from 'aws-cdk-lib';
import {
  DeadLetterQueue,
  IQueue,
  QueueEncryption,
  QueueReference,
} from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import {QueueAlarmsOptions} from './queue-alarms';
import {ExtendedQueue} from './extended-queue';
import {MetricOptions, Metric} from 'aws-cdk-lib/aws-cloudwatch';
import {
  PolicyStatement,
  AddToResourcePolicyResult,
  IGrantable,
  Grant,
} from 'aws-cdk-lib/aws-iam';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import {StandardDeadLetterQueue} from './standard-dead-letter-queue';

/**
 * Properties for a StandardQueue
 */
export interface StandardQueueProps
  extends QueueAlarmsOptions, ExtendedConstructProps {
  /**
   * A name for the queue.
   *
   * If specified and this is a FIFO queue, must end in the string '.fifo'.
   *
   * @default CloudFormation-generated name
   */
  readonly queueName?: string;

  /**
   * A name for the dead letter queue.
   *
   * If specified and this is a FIFO queue, must end in the string '.fifo'.
   *
   * @default CloudFormation-generated name
   */
  readonly deadLetterQueueName?: string;

  /**
   * The retention period for the dead letter queue.
   *
   * If not provided, the default is the maximum time allowed which is 14 days.
   */
  readonly deadLetterQueueRetentionPeriod?: Duration;

  /**
   * The time in seconds that the delivery of all messages in the queue is delayed.
   */
  readonly deliveryDelay?: Duration;

  /**
   * The number of seconds Amazon SQS retains a message. Value must be between
   * 60 and 1209600 seconds (14 days).
   *
   * @default Duration.seconds(1209600)
   *
   */
  readonly retentionPeriod?: Duration;

  /**
   * The number of seconds a consumer has to handle the message and delete it
   * from the queue before it becomes visible again for another consumer. Value
   * must be between 0 and 43200 seconds (12 hours).
   *
   * @default Duration.seconds(30)
   */
  readonly visibilityTimeout?: Duration;

  /**
   * The encryption method to use for the queue. Default is QueueEncryption.KMS_MANAGED
   * unless a master key is provided, this will use the AWS managed key for SQS.
   */
  readonly encryption?: QueueEncryption;

  /**
   * The KMS key to use for encryption. If not set, the AWS master key for SQS
   * will be used.
   */
  readonly encryptionMasterKey?: kms.IKey;

  /**
   * The length of time that Amazon SQS reuses a data key before calling KMS again.
   * This value affects pricing as you are charged for KMS usage. Value must be
   * between 60 and 86,400 seconds (24 hours).
   *
   * @default Duration.minutes(15)
   */
  readonly dataKeyReuse?: Duration;

  /**
   * The maximum number of times a message can be unsuccessful before being moved
   * to the dead-letter queue. Set this value to -1 to disable the dead-letter queue.
   *
   * @default 3
   */
  readonly maxReceiveCount?: number;

  /**
   * Overrides the internal identifier used for the SQS Queue.
   *
   * @default "Default"
   */
  readonly queueIdentifier?: string;

  /**
   * Overrides the internal identifier used for the dead letter SQS Queue.
   *
   * @default "Dlq"
   */
  readonly deadLetterQueueIdentifier?: string;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default false
   */
  readonly suppressTagging?: boolean;

  /**
   * Sets the queue as a fifo queue. Default is false.
   *
   * @default false
   */
  readonly fifo?: boolean;

  /**
   * Default wait time for ReceiveMessage calls.
   *
   * Does not wait if set to 0, otherwise waits this amount of seconds
   * by default for messages to arrive.
   *
   * For more information, see Amazon SQS Long Poll.
   *
   *  @default Duration.seconds(20)
   */
  readonly receiveMessageWaitTime?: Duration;
}

export class StandardQueue extends ExtendedConstruct implements IQueue {
  static readonly DEFAULT_MAX_RECEIVE_COUNT = 3;
  static readonly DEFAULT_RETENTION_PERIOD = Duration.seconds(1209600);

  readonly queue: ExtendedQueue;

  // From IQueue
  readonly queueArn: string;
  readonly queueUrl: string;
  readonly queueName: string;
  readonly queueRef: QueueReference;
  readonly encryption: QueueEncryption | undefined;
  readonly encryptionMasterKey?: kms.IKey | undefined;
  readonly fifo: boolean;
  readonly stack: Stack;
  readonly env: ResourceEnvironment;

  constructor(scope: Construct, id: string, props?: StandardQueueProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props?.standardTags, LibStandardTags),
    });

    const maxReceiveCount =
      props?.maxReceiveCount ?? StandardQueue.DEFAULT_MAX_RECEIVE_COUNT;
    const encryption =
      props?.encryption ??
      (props?.encryptionMasterKey === undefined
        ? QueueEncryption.KMS_MANAGED
        : QueueEncryption.KMS);
    const encryptionMasterKey = props?.encryptionMasterKey;
    const dataKeyReuse = props?.dataKeyReuse ?? Duration.minutes(15);

    const deadLetterQueue: DeadLetterQueue | undefined =
      maxReceiveCount <= 0
        ? undefined
        : {
            queue: new StandardDeadLetterQueue(this, 'Dlq', {
              queueName: props?.deadLetterQueueName,
              encryption,
              encryptionMasterKey,
              dataKeyReuse,
              receiveMessageWaitTime: props?.receiveMessageWaitTime,
              retentionPeriod:
                props?.deadLetterQueueRetentionPeriod ?? Duration.days(14),
              fifo: props?.fifo,
            }),
            maxReceiveCount,
          };

    this.queue = new ExtendedQueue(this, 'Default', {
      ...props,
      deadLetterQueue,
      encryption,
      encryptionMasterKey,
      dataKeyReuse,
      fifo: props?.fifo,
      receiveMessageWaitTime:
        props?.receiveMessageWaitTime ?? Duration.seconds(20),
      alarmFriendlyName: props?.alarmFriendlyName ?? id,
      retentionPeriod:
        props?.retentionPeriod ?? StandardQueue.DEFAULT_RETENTION_PERIOD,
      visibilityTimeout: props?.visibilityTimeout ?? Duration.seconds(30),
      alarmNamePrefix:
        props?.alarmNamePrefix ?? Stack.of(this).stackName + '-' + id,
    });

    this.queueArn = this.queue.queueArn;
    this.queueUrl = this.queue.queueUrl;
    this.queueName = this.queue.queueName;
    this.queueRef = this.queue.queueRef;
    this.encryption = this.queue.encryptionType;
    this.encryptionMasterKey = this.queue.encryptionMasterKey;
    this.fifo = this.queue.fifo;
    this.stack = this.queue.stack;
    this.env = this.queue.env;
  }

  // From IQueue

  addToResourcePolicy(statement: PolicyStatement): AddToResourcePolicyResult {
    return this.queue.addToResourcePolicy(statement);
  }

  grantConsumeMessages(grantee: IGrantable): Grant {
    return this.queue.grantConsumeMessages(grantee);
  }

  grantSendMessages(grantee: IGrantable): Grant {
    return this.queue.grantSendMessages(grantee);
  }

  grantPurge(grantee: IGrantable): Grant {
    return this.queue.grantPurge(grantee);
  }

  grant(grantee: IGrantable, ...queueActions: string[]): Grant {
    return this.queue.grant(grantee, ...queueActions);
  }

  metric(metricName: string, props?: MetricOptions): Metric {
    return this.queue.metric(metricName, props);
  }

  metricApproximateAgeOfOldestMessage(props?: MetricOptions): Metric {
    return this.queue.metricApproximateAgeOfOldestMessage(props);
  }

  metricApproximateNumberOfMessagesDelayed(props?: MetricOptions): Metric {
    return this.queue.metricApproximateNumberOfMessagesDelayed(props);
  }

  metricApproximateNumberOfMessagesNotVisible(props?: MetricOptions): Metric {
    return this.queue.metricApproximateNumberOfMessagesNotVisible(props);
  }

  metricApproximateNumberOfMessagesVisible(props?: MetricOptions): Metric {
    return this.queue.metricApproximateNumberOfMessagesVisible(props);
  }

  metricNumberOfEmptyReceives(props?: MetricOptions): Metric {
    return this.queue.metricNumberOfEmptyReceives(props);
  }

  metricNumberOfMessagesDeleted(props?: MetricOptions): Metric {
    return this.queue.metricNumberOfMessagesDeleted(props);
  }

  metricNumberOfMessagesReceived(props?: MetricOptions): Metric {
    return this.queue.metricNumberOfMessagesReceived(props);
  }

  metricNumberOfMessagesSent(props?: MetricOptions): Metric {
    return this.queue.metricNumberOfMessagesSent(props);
  }

  metricSentMessageSize(props?: MetricOptions): Metric {
    return this.queue.metricSentMessageSize(props);
  }

  applyRemovalPolicy(policy: RemovalPolicy): void {
    return this.queue.applyRemovalPolicy(policy);
  }
}
