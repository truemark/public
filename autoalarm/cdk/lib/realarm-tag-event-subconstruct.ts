import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {
  Effect,
  IRole,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {Construct} from 'constructs';
import * as path from 'path';
import {Duration} from 'aws-cdk-lib';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {Rule} from 'aws-cdk-lib/aws-events';
import {SqsQueue} from 'aws-cdk-lib/aws-events-targets';
import {IQueue} from 'aws-cdk-lib/aws-sqs';
import {NoBreachingExtendedQueue} from './extended-libs-subconstruct';

export class ReAlarmTagEventHandler extends Construct {
  public readonly lambdaFunction: ExtendedNodejsFunction;
  public readonly reAlarmTagEventQueue: NoBreachingExtendedQueue;
  private readonly eventRuleTargetDLQ: IQueue;

  constructor(
    scope: Construct,
    id: string,
    region: string,
    accountId: string,
    reAlarmProducerFuncionArn: string,
    eventRuleTargetDLQ: IQueue,
  ) {
    super(scope, id);
    this.eventRuleTargetDLQ = eventRuleTargetDLQ;
    /**
     * Create all the required Queues for the ReAlarm tag event handler function
     */
    const queues = this.createQueues();
    this.reAlarmTagEventQueue = queues.reAlarmTagEventQueue;

    /**
     * Set up the IAM role and policies for the ReAlarm Tag Event function
     */
    const role = this.createRole(
      region,
      accountId,
      queues.reAlarmTagEventQueue.queueArn,
    );

    /**
     * Create the ReAlarm Event Rule function
     */
    this.lambdaFunction = this.initializeReAlarmTagEventFunction(
      role,
      reAlarmProducerFuncionArn,
    );

    /**
     * Add tag event queue as event source for the ReAlarm Tag Event function
     */
    this.lambdaFunction.addEventSource(
      new SqsEventSource(queues.reAlarmTagEventQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        enabled: true,
        // Caps concurrent pollers to protect EventBridge/CloudWatch
        // control-plane TPS. Tunable starting point.
        maxConcurrency: 10,
      }),
    );

    /**
     * Set up the EventBridge rule to target the ReAlarm Tag Event queue
     */
    this.createEventBridgeRules();
  }

  /**
   * private method to create Fifo Queues for the ReAlarm Tag Event Handler
   */
  private createQueues(): {
    reAlarmTagEventQueue: NoBreachingExtendedQueue;
    reAlarmTagEventDLQ: NoBreachingExtendedQueue;
  } {
    const reAlarmTagEventHandlerDLQ = new NoBreachingExtendedQueue(
      this,
      'ReAlarmTagHandler-Failed',
      'ReAlarmTagEventHandler',
      {
        fifo: true,
        retentionPeriod: Duration.days(14),
      },
    );

    const reAlarmTagEventHandlerQueue = new NoBreachingExtendedQueue(
      this,
      'ReAlarmTagHandlerQueue',
      'ReAlarmTagEventHandler',
      {
        fifo: true,
        contentBasedDeduplication: true,
        retentionPeriod: Duration.days(14),
        // ~6x the consumer Lambda timeout (900s) per AWS guidance for Lambda
        // event source queues.
        visibilityTimeout: Duration.seconds(5400),
        deadLetterQueue: {queue: reAlarmTagEventHandlerDLQ, maxReceiveCount: 3},
      },
    );
    return {
      reAlarmTagEventQueue: reAlarmTagEventHandlerQueue,
      reAlarmTagEventDLQ: reAlarmTagEventHandlerDLQ,
    };
  }

  /**
   * Private method to set up the IAM role and policies for the ReAlarm Event Rule function
   */
  private createRole(
    region: string,
    accountId: string,
    queueArn: string,
  ): IRole {
    const reAlarmEventRuleLambdaExecutionRole = new Role(
      this,
      'reAlarmEventRuleLambdaExecutionRole',
      {
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        description: 'Execution role for ReAlarm Event Rule Lambda function',
      },
    );

    reAlarmEventRuleLambdaExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'events:PutRule',
          'events:PutTargets',
          'events:DeleteRule',
          'events:RemoveTargets',
        ],
        resources: [
          `arn:aws:events:${region}:${accountId}:rule/AutoAlarm-ReAlarm-*`,
        ],
      }),
    );

    reAlarmEventRuleLambdaExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudwatch:DescribeAlarms',
          'cloudwatch:ListTagsForResource',
        ],
        resources: ['*'],
      }),
    );

    // The log group is created and managed by CDK (ExtendedNodejsFunction),
    // so logs:CreateLogGroup is not needed; the function name is
    // CDK-generated, so writes are scoped to the Lambda log-group namespace
    // rather than '*'.
    reAlarmEventRuleLambdaExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/*:*`,
        ],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      }),
    );

    reAlarmEventRuleLambdaExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
        ],
        resources: [queueArn],
      }),
    );

    return reAlarmEventRuleLambdaExecutionRole;
  }

  /**
   *  private method initialize the ReAlarm Event Rule function
   */
  private initializeReAlarmTagEventFunction(
    role: IRole,
    reAlarmProducerQueueArn: string,
  ): ExtendedNodejsFunction {
    return new ExtendedNodejsFunction(this, 'ReAlarmTagEventFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'realarm-tag-event-handler.mts',
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 768,
      role: role,
      environment: {
        PRODUCER_FUNCTION_ARN: reAlarmProducerQueueArn,
      },
      deploymentOptions: {
        createDeployment: false,
      },
    });
  }

  /**
   * private method to create eventbridge rule and set reAlarmTagEventQueue as target
   */
  private createEventBridgeRules(): void {
    const reAlarmEventTagRule = new Rule(this, 'ReAlarmEventTagRule', {
      eventPattern: {
        source: ['aws.tag'],
        detailType: ['Tag Change on Resource'],
        detail: {
          'service': ['cloudwatch'],
          'resource-type': ['alarm'],
          'changed-tag-keys': [
            'autoalarm:re-alarm-minutes',
            'autoalarm:re-alarm-enabled',
          ],
        },
      },
      description:
        'Trigger the ReAlarm Event Rule Lambda function for tag changes',
    });

    reAlarmEventTagRule.addTarget(
      new SqsQueue(this.reAlarmTagEventQueue, {
        messageGroupId: 'ReAlarmTagEventHandler',
        // Capture events EventBridge could not deliver to the target queue
        // after its retry policy is exhausted.
        deadLetterQueue: this.eventRuleTargetDLQ,
      }),
    );
  }
}
