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
import {Duration, Stack} from 'aws-cdk-lib';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {NoBreachingExtendedQueue} from './extended-libs-subconstruct';

export class SqsHandlerSubConstruct extends Construct {
  public readonly lambdaFunction: ExtendedNodejsFunction;
  public readonly eventSourceQueues: {
    [key: string]: NoBreachingExtendedQueue;
  } = {};

  constructor(
    scope: Construct,
    id: string,
    mainFunctionQueueArn: string,
    mainFunctionQueueURL: string,
  ) {
    super(scope, id);
    /**
     * Set up the IAM role and policies for the sqs handler function
     */
    const role = this.createRole(mainFunctionQueueArn);

    /**
     * Create Node function definition
     */
    this.lambdaFunction = this.createFunction(role, mainFunctionQueueURL);

    /**
     * Create all the queues for all the services that AutoAlarm supports
     */
    this.eventSourceQueues = this.createQueues();
  }

  /**
   * private method to create role and IAM policy for the function
   */
  private createRole(mainFunctionQueueArn: string): IRole {
    /**
     * Set up the IAM role and policies for the sqs handler function
     */
    const sqsHandlerExecutionRole = new Role(this, 'sqsHandlerExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for AutoAlarm Lambda function',
    });

    // Grant permissions to send messages to the main function queue
    sqsHandlerExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [mainFunctionQueueArn],
        actions: [
          // SendMessageBatch is authorized by sqs:SendMessage; there is no
          // separate sqs:SendMessageBatch IAM action.
          'sqs:SendMessage',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
        ],
      }),
    );

    // Grant permissions get queue info from source event queues

    // Grant permissions to write logs to CloudWatch. The log group is created
    // and managed by CDK (ExtendedNodejsFunction), so logs:CreateLogGroup is
    // not needed; the function name is CDK-generated, so writes are scoped to
    // the Lambda log-group namespace rather than '*'.
    sqsHandlerExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/lambda/*:*`,
        ],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      }),
    );

    return sqsHandlerExecutionRole;
  }

  /**
   * Private method to create all the queues for all the services that AutoAlarm supports
   */
  private createQueues(): {[key: string]: NoBreachingExtendedQueue} {
    //Create a string array of all the autoAlarmQueue names
    const autoAlarmQueues = [
      'AutoAlarm-Alb',
      'AutoAlarm-Cloudfront',
      'AutoAlarm-Ec2',
      'AutoAlarm-Ecs',
      'AutoAlarm-Lambda',
      'AutoAlarm-Logs',
      'AutoAlarm-OpenSearchRule',
      'AutoAlarm-Rds',
      'AutoAlarm-RdsCluster',
      'AutoAlarm-Route53resolver',
      'AutoAlarm-Sqs',
      'AutoAlarm-Sfn',
      'AutoAlarm-TargetGroup',
      'AutoAlarm-TransitGateway',
      'AutoAlarm-Vpn',
    ];

    //Create a custom object that contains/will constain all our fifo queues
    const queues: {[key: string]: NoBreachingExtendedQueue} = {};

    /**
     * Loop through the autoAlarmQueues array and create a new ExtendedQueue object for each queue and add it to queues object
     * Grant consume messages to the mainFunction for each queue
     * Finally add an event source to the mainFunction for each queue
     */
    for (const queueName of autoAlarmQueues) {
      // Create DLQ for each queue and let cdk handle the name generation after the queue name
      const dlq = new NoBreachingExtendedQueue(
        this,
        `${queueName.replace('AutoAlarm-', '')}-Failed`,
        queueName,
        {
          fifo: true,
          retentionPeriod: Duration.days(14),
        },
      );

      // Create queue with its own DLQ
      queues[queueName] = new NoBreachingExtendedQueue(
        this,
        queueName.replace('AutoAlarm-', ''),
        queueName,
        {
          fifo: true,
          contentBasedDeduplication: true,
          retentionPeriod: Duration.days(14),
          // ~6x the consumer Lambda timeout (900s) per AWS guidance for
          // Lambda event source queues.
          visibilityTimeout: Duration.seconds(5400),
          deadLetterQueue: {queue: dlq, maxReceiveCount: 3},
        },
      );

      queues[queueName].grantConsumeMessages(this.lambdaFunction);
      this.lambdaFunction.addEventSource(
        new SqsEventSource(queues[queueName], {
          batchSize: 10,
          reportBatchItemFailures: true,
          enabled: true,
        }),
      );
    }

    return queues;
  }

  /**
   * Private method to create the ReAlarm Producer function
   * @param role - The IAM role for the ReAlarm Producer function
   * @param mainFunctionQueueURL - The URL of the mainfunction queue to be passed as an environment variable
   */
  private createFunction(
    role: IRole,
    mainFunctionQueueURL: string,
  ): ExtendedNodejsFunction {
    return new ExtendedNodejsFunction(this, 'SQSHandlerFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'sqs-handler.mts',
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 768,
      role: role,
      environment: {
        TARGET_FIFO_QUEUE_URL: mainFunctionQueueURL,
      },
      deploymentOptions: {
        createDeployment: false,
      },
    });
  }
}
