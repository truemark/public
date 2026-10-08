import {Construct} from 'constructs';
import {AutoAlarm} from './main-function-subsconstruct';
import {ReAlarmProducer} from './realarm-producer-subconstruct';
import {ReAlarmConsumer} from './realarm-consumer-subconstruct';
import {Duration, Stack} from 'aws-cdk-lib';
import {Queue, QueueEncryption} from 'aws-cdk-lib/aws-sqs';
import {PolicyStatement, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {ReAlarmTagEventHandler} from './realarm-tag-event-subconstruct';
import {EventRules} from './service-eventbridge-subconstruct';
import {SqsHandlerSubConstruct} from './sqs-handler-subconstruct';
import {CronOptions} from 'aws-cdk-lib/aws-events';

interface AutoAlarmConstructProps {
  readonly prometheusWorkspaceId?: string;
  readonly enableReAlarm?: boolean;
  readonly reAlarmSchedule?: CronOptions;
}

export class AutoAlarmConstruct extends Construct {
  protected readonly autoAlarm: AutoAlarm;
  protected readonly sqsHandler: SqsHandlerSubConstruct;
  protected readonly reAlarmProducer: ReAlarmProducer;
  protected readonly reAlarmConsumer: ReAlarmConsumer;
  protected readonly reAlarmTagEventHandler: ReAlarmTagEventHandler;
  protected readonly eventBridgeRules: EventRules;
  constructor(scope: Construct, id: string, props: AutoAlarmConstructProps) {
    super(scope, id);
    //the following four consts are used to pass the correct ARN for whichever prometheus ID is being used as well as to the lambda.
    const prometheusWorkspaceId = props.prometheusWorkspaceId || '';
    const accountId = Stack.of(this).account;
    const region = Stack.of(this).region;
    const prometheusArn = `arn:aws:aps:${region}:${accountId}:workspace/${prometheusWorkspaceId}`;

    const enableReAlarm = props.enableReAlarm ?? true;

    /**
     * Shared dead-letter queue for all EventBridge rule targets. Events that
     * EventBridge cannot deliver to a target after its retry policy is
     * exhausted land here instead of being dropped.
     *
     * We add a single account-scoped resource policy here rather than letting
     * CDK auto-generate one statement per EventBridge rule target (25+ rules
     * would exceed the SQS 20 KB policy size limit).  Sub-constructs receive
     * an imported queue reference so CDK's automatic per-rule grants are
     * suppressed while the DeadLetterConfig.Arn is still set correctly on
     * every EventBridge target.
     */
    const eventRuleTargetDLQ = new Queue(this, 'EventRuleTargetDLQ', {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });

    eventRuleTargetDLQ.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal('events.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [eventRuleTargetDLQ.queueArn],
        conditions: {
          StringEquals: {'aws:SourceAccount': accountId},
        },
      }),
    );

    // Imported reference: addToResourcePolicy is a no-op on imported queues,
    // preventing CDK from appending per-rule SQS policy statements.
    const eventRuleTargetDLQRef = Queue.fromQueueArn(
      this,
      'EventRuleTargetDLQRef',
      eventRuleTargetDLQ.queueArn,
    );

    if (enableReAlarm) {
      /**
       * If reAlarm is enabled, create the ReAlarm Consumer, Producer and tag event handler objects
       * Each of these objects contain all resources for each lambda: function, role, queue, and event rules (where applicable)
       * ---------------------
       * 1. ReAlarm Consumer: Consume from Consumer Queue, and resets alarms.
       * 2. ReAlarm Producer: Consume from Producer Queue, grabs all alarms, applies pre-filtering and routes to consumer queue.
       * 3. ReAlarm Tag Event Handler: Creates/deletes EventBridge rules for ReAlarm custom schedule tag changes.
       */
      this.reAlarmConsumer = new ReAlarmConsumer(this, 'ReAlarmConsumer');

      this.reAlarmProducer = new ReAlarmProducer(
        this,
        'ReAlarmProducer',
        region,
        accountId,
        this.reAlarmConsumer.reAlarmConsumerQueue.queueArn,
        this.reAlarmConsumer.reAlarmConsumerQueue.queueUrl,
        eventRuleTargetDLQRef,
        props.reAlarmSchedule,
      );

      this.reAlarmTagEventHandler = new ReAlarmTagEventHandler(
        this,
        'ReAlarmTagHandler',
        region,
        accountId,
        this.reAlarmProducer.lambdaFunction.functionArn,
        eventRuleTargetDLQRef,
      );

      /**
       * Allow reAlarm tag event handler lambda function to consume messages from the event rule queue
       * Allow the producer to send messages to the consumer queue
       * Allow the consumer to consume messages from the consumer queue
       * Add the consumer function as an event source for the consumer queue
       * Store Producer function ARN for use in Event Rule Lambda function
       */
      this.reAlarmTagEventHandler.reAlarmTagEventQueue.grantConsumeMessages(
        this.reAlarmTagEventHandler.lambdaFunction,
      );
      this.reAlarmConsumer.reAlarmConsumerQueue.grantSendMessages(
        this.reAlarmProducer.lambdaFunction,
      );
      this.reAlarmConsumer.reAlarmConsumerQueue.grantConsumeMessages(
        this.reAlarmConsumer.lambdaFunction,
      );
    }

    /**
     * Create the MainFunction, mainfunction queue and associated resources
     */
    this.autoAlarm = new AutoAlarm(
      this,
      'MainHandler',
      region,
      accountId,
      prometheusArn,
      prometheusWorkspaceId,
    );

    /**
     * Create the SQS handler function and all the source queues for each service AutoAlarm supports.
     * Grant send messages to the mainFunction queue.
     */
    this.sqsHandler = new SqsHandlerSubConstruct(
      this,
      'SqsHandler',
      this.autoAlarm.mainFunctionQueue.queueArn,
      this.autoAlarm.mainFunctionQueue.queueUrl,
    );

    this.autoAlarm.mainFunctionQueue.grantSendMessages(
      this.sqsHandler.lambdaFunction,
    );

    /**
     * Create the EventBridge rules for each service and set the proper queue as the target for each rule
     */
    this.eventBridgeRules = new EventRules(
      this,
      'ServiceEventRules',
      this.sqsHandler.eventSourceQueues,
      eventRuleTargetDLQRef,
    );
  }
}
