import {IQueue, Queue, QueueProps} from 'aws-cdk-lib/aws-sqs';
import {Construct} from 'constructs';
import {QueueAlarms, QueueAlarmsOptions} from './queue-alarms';
import {Arn} from 'aws-cdk-lib';

/**
 * Properties for ObservedQueue.
 */
export interface ExtendedQueueProps extends QueueProps, QueueAlarmsOptions {}

/**
 * Queue with CloudWatch alarms.
 */
export class ExtendedQueue extends Queue {
  readonly queueAlarms: QueueAlarms;

  constructor(scope: Construct, id: string, props: ExtendedQueueProps) {
    super(scope, id, props);

    this.queueAlarms = new QueueAlarms(this, 'Alarms', {
      queue: this,
      ...props,
    });
  }

  /**
   * Helper method to find a queue by name. This method assumes the queue is in the same account and region as the stack.
   *
   * @param scope the scope
   * @param id the identifier to use
   * @param queueName the name of the queue
   */
  static fromQueueName(
    scope: Construct,
    id: string,
    queueName: string,
  ): IQueue {
    return Queue.fromQueueArn(
      scope,
      id,
      Arn.format({
        service: 'sqs',
        resource: queueName,
      }),
    );
  }
}
