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
import {ArnFormat, Duration, Stack} from 'aws-cdk-lib';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {NoBreachingExtendedQueue} from './extended-libs-subconstruct';

export class ReAlarmConsumer extends Construct {
  public readonly lambdaFunction: ExtendedNodejsFunction;
  public readonly reAlarmConsumerFunctionArn: string;
  public readonly reAlarmConsumerQueue: NoBreachingExtendedQueue;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    /**
     * Create the ReAlarm Consumer queue and expose it for use across the stack
     */
    const queues = this.createQueues();
    this.reAlarmConsumerQueue = queues.consumerQueue;

    /**
     * Set up the IAM role and policies for the ReAlarm Consumer function
     *
     */
    const role = this.createRole(this.reAlarmConsumerQueue.queueArn);

    /**
     * Create the ReAlarm Consumer function
     * @param role - The IAM role for the ReAlarm Consumer function
     */
    this.lambdaFunction = this.initializeReAlarmConsumerFunction(role);

    /**
     * Set the ARN of the ReAlarm Consumer function and expose it for use across the stack
     */
    this.reAlarmConsumerFunctionArn = this.lambdaFunction.functionArn;

    /**
     * Add consumer queue as event source for the consumer function
     */
    this.lambdaFunction.addEventSource(
      new SqsEventSource(this.reAlarmConsumerQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        enabled: true,
        // Caps concurrent pollers to protect CloudWatch control-plane TPS
        // (SetAlarmState). Tunable starting point.
        maxConcurrency: 10,
      }),
    );
  }

  /**
   * private method to create the ReAlarm Consumer queue and DLQ
   */
  private createQueues(): {
    consumerQueue: NoBreachingExtendedQueue;
    consumerDLQ: NoBreachingExtendedQueue;
  } {
    const reAlarmConsumerDLQ = new NoBreachingExtendedQueue(
      this,
      'reAlarmConsumerFunction-Failed',
      'reAlarmConsumerFunction',
      {
        fifo: true,
        retentionPeriod: Duration.days(14),
      },
    );

    const reAlarmConsumerQueue = new NoBreachingExtendedQueue(
      this,
      'reAlarmConsumerFunction',
      'reAlarmConsumerFunction',
      {
        fifo: true,
        contentBasedDeduplication: true,
        retentionPeriod: Duration.days(14),
        // ~6x the consumer Lambda timeout (900s) per AWS guidance for Lambda
        // event source queues.
        visibilityTimeout: Duration.seconds(5400),
        deadLetterQueue: {queue: reAlarmConsumerDLQ, maxReceiveCount: 3},
      },
    );
    return {
      consumerQueue: reAlarmConsumerQueue,
      consumerDLQ: reAlarmConsumerDLQ,
    };
  }

  /**
   * private method to create the IAM role for the ReAlarm Consumer function
   */
  private createRole(reAlarmConsumerQueueArn: string): IRole {
    /**
     * Set up the IAM roles for the ReAlarm Consumer function
     * Allow the consumer to describe alarms
     * Allow the consumer to set alarm state
     * Allow the consumer to write to CloudWatch Logs
     * Allow Consumer to consume messages from the Consumer queue
     */
    const reAlarmConsumerRole = new Role(this, 'reAlarmConsumerRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for ReAlarm Consumer Lambda function',
    });

    // ReAlarm intentionally operates on every alarm in the account (opt-out
    // via the autoalarm:re-alarm-enabled=false tag), but SetAlarmState can
    // still be scoped to alarm ARNs in this account/region rather than '*'.
    reAlarmConsumerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:SetAlarmState'],
        resources: [
          Stack.of(this).formatArn({
            service: 'cloudwatch',
            resource: 'alarm',
            resourceName: '*',
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    // DescribeAlarms is a read/list operation that must run against all
    // alarms in the account. ListTagsForResource is no longer needed: the
    // producer resolves all tag-derived facts (bulk Tagging API sweep /
    // single-alarm lookup) and embeds them in each SQS message.
    reAlarmConsumerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:DescribeAlarms'],
        resources: ['*'],
      }),
    );

    // The log group is created and managed by CDK (ExtendedNodejsFunction),
    // so logs:CreateLogGroup is not needed; the function name is
    // CDK-generated, so writes are scoped to the Lambda log-group namespace
    // rather than '*'.
    reAlarmConsumerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/lambda/*:*`,
        ],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      }),
    );

    reAlarmConsumerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
        ],
        resources: [reAlarmConsumerQueueArn],
      }),
    );

    return reAlarmConsumerRole;
  }

  /**
   * private method initialize the ReAlarm Consumer function
   */
  private initializeReAlarmConsumerFunction(
    role: IRole,
  ): ExtendedNodejsFunction {
    // Create the ReAlarm Consumer function
    return new ExtendedNodejsFunction(this, 'ConsumerFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'realarm-consumer-handler.mts',
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 768,
      role: role,
      deploymentOptions: {
        createDeployment: false,
      },
      bundling: {
        nodeModules: ['@smithy/util-retry'],
      },
    });
  }

  /**
   * private method to up the EventBridge rule to trigger the ReAlarm Consumer function
   */
}
