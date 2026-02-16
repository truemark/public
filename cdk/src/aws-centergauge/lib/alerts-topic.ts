import {Construct} from 'constructs';
import {CfnSubscription, Topic} from 'aws-cdk-lib/aws-sns';
import {Alias, IKey} from 'aws-cdk-lib/aws-kms';
import {StandardQueue} from '../../aws-sqs/index';
import {AnyPrincipal, Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for AlertsTopic
 */
export interface AlertsTopicProps extends ExtendedConstructProps {
  /**
   * Overrides the default topic name.
   */
  readonly topicName?: string;

  /**
   * Overrides the use of the default aws/sns KMS key for encryption
   *
   * @default uses AWS managed SNS KMS key
   */
  readonly masterKey?: IKey;

  /**
   * Overrides the default alerts URL.
   *
   * @default https://alerts.centergauge.com/
   */
  readonly url?: string;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;
}

/**
 * Sets up an SNS Topic that will send notifications to the CenterGauge platform.
 */
export class AlertsTopic extends ExtendedConstruct {
  public readonly topic: Topic;
  constructor(scope: Construct, id: string, props: AlertsTopicProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const masterKey =
      props.masterKey ??
      Alias.fromAliasName(this, 'AwsSnsKey', 'alias/aws/sns');

    const dlq = new StandardQueue(this, 'Dlq', {
      maxReceiveCount: -1,
      criticalAlarmOptions: {
        maxSize: 1,
      },
    });

    this.topic = new Topic(this, 'Default', {
      topicName: props.topicName ?? 'CenterGaugeAlerts',
      fifo: false,
      masterKey,
    });

    dlq.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        sid: 'First',
        principals: [new AnyPrincipal()],
        actions: ['sqs:SendMessage'],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': this.topic.topicArn,
          },
        },
      }),
    );

    new CfnSubscription(this, 'Subscription', {
      topicArn: this.topic.topicArn,
      protocol: 'https',
      endpoint: props.url ?? 'https://ingest.centergauge.com/',
      rawMessageDelivery: false,
      deliveryPolicy: {
        healthyRetryPolicy: {
          numRetries: 10,
          numNoDelayRetries: 0,
          minDelayTarget: 30,
          maxDelayTarget: 120,
          numMinDelayRetries: 3,
          numMaxDelayRetries: 0,
          backoffFunction: 'linear',
        },
      },
      redrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlq.queueArn,
      }),
    });
  }
}
