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
import {NoBreachingExtendedQueue} from './extended-libs-subconstruct';

export class AutoAlarm extends Construct {
  public readonly lambdaFunction: ExtendedNodejsFunction;
  public readonly mainFunctionQueue: NoBreachingExtendedQueue;

  constructor(
    scope: Construct,
    id: string,
    region: string,
    accountId: string,
    prometheusArn: string,
    prometheusWorkspaceId: string,
  ) {
    super(scope, id);
    /**
     * Set up the IAM role and policies for the main function
     */
    const role = this.createRole(
      region,
      accountId,
      prometheusArn,
      prometheusWorkspaceId,
    );

    /**
     * Create Node function definition
     */
    this.lambdaFunction = this.createFunction(
      role,
      prometheusWorkspaceId,
      accountId,
    );

    /**
     * Create all the queues for all the services that AutoAlarm supports
     */
    this.mainFunctionQueue = this.createMainFunctionQueue();
  }

  /**
   * Private method to create all the main function queue.
   */
  private createMainFunctionQueue(): NoBreachingExtendedQueue {
    // Create DLQ for each queue and let cdk handle the name generation after the queue name
    const dlq = new NoBreachingExtendedQueue(
      this,
      'Main-Handler-Failed',
      'Main-Handler',
      {
        fifo: true,
        retentionPeriod: Duration.days(14),
      },
    );

    // Create queue with its own DLQ
    const mainHandlerQueue = new NoBreachingExtendedQueue(
      this,
      'Main-Handler',
      'Main-Handler',
      {
        fifo: true,
        contentBasedDeduplication: true,
        retentionPeriod: Duration.days(14),
        // ~6x the consumer Lambda timeout (900s) per AWS guidance for Lambda
        // event source queues.
        visibilityTimeout: Duration.seconds(5400),
        deadLetterQueue: {queue: dlq, maxReceiveCount: 3},
      },
    );

    mainHandlerQueue.grantConsumeMessages(this.lambdaFunction);
    this.lambdaFunction.addEventSource(
      new SqsEventSource(mainHandlerQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        enabled: true,
        // Caps concurrent pollers to protect CloudWatch control-plane TPS
        // (PutMetricAlarm/DeleteAlarms). Tunable starting point.
        maxConcurrency: 20,
      }),
    );

    return mainHandlerQueue;
  }

  /**
   * private method to create role and IAM policy for the function
   */
  private createRole(
    region: string,
    accountId: string,
    prometheusArn: string,
    prometheusWorkspaceId: string,
  ): IRole {
    /**
     * Set up the IAM role and policies for the main function
     */
    const autoAlarmExecutionRole = new Role(this, 'autoAlarmExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for AutoAlarm Lambda function',
    });

    // Attach policies for Prometheus
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'aps:QueryMetrics',
          'aps:ListRuleGroupsNamespaces',
          'aps:DescribeRuleGroupsNamespace',
          'aps:CreateRuleGroupsNamespace',
          'aps:PutRuleGroupsNamespace',
          'aps:DeleteRuleGroupsNamespace',
          'aps:DescribeWorkspace',
        ],
        resources: [
          prometheusArn,
          `arn:aws:aps:${region}:${accountId}:*/${prometheusWorkspaceId}/*`,
        ],
      }),
    );

    // Mutating alarm actions scoped to AutoAlarm-managed alarms only.
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricAlarm',
          'cloudwatch:DeleteAlarms',
          'cloudwatch:TagResource',
          'cloudwatch:UntagResource',
        ],
        resources: [
          `arn:aws:cloudwatch:${region}:${accountId}:alarm:AutoAlarm-*`,
        ],
      }),
    );

    // DescribeAlarms with AlarmNamePrefix is evaluated by IAM against alarm:*
    // (AWS does not support resource-level scoping for prefix-based list calls).
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:DescribeAlarms'],
        resources: [`arn:aws:cloudwatch:${region}:${accountId}:alarm:*`],
      }),
    );

    // Resource Groups Tagging API lookup used for identity-first alarm
    // reconciliation (alarms are tagged with autoalarm:service and
    // autoalarm:resource-id at creation). tag:GetResources does not support
    // resource-level scoping and must remain on '*'.
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['tag:GetResources'],
        resources: ['*'],
      }),
    );

    // EC2 describe and CloudWatch metric/anomaly-detector actions do not
    // support resource-level scoping and must remain on '*'.
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'ec2:DescribeInstances',
          'ec2:DescribeTags',
          'cloudwatch:ListMetrics',
          'cloudwatch:PutAnomalyDetector',
          'cloudwatch:DeleteAnomalyDetector',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for ECS:
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'ecs:ListClusters',
          'ecs:ListServices',
          'ecs:DescribeClusters',
          'ecs:DescribeServices',
          'ecs:ListTagsForResource',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for CloudWatch Logs. The log group itself is created and
    // managed by CDK (ExtendedNodejsFunction), so logs:CreateLogGroup is not
    // needed; the function name is CDK-generated, so we scope writes to the
    // Lambda log-group namespace rather than '*'.
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/*:*`,
        ],
      }),
    );

    // logs:ListTagsForResource is used to read autoalarm tags on monitored log
    // groups and does not support useful resource-level scoping here.
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:ListTagsForResource'],
        resources: ['*'],
      }),
    );

    // Attach policies for ALB and Target Groups
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeTags',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeTargetHealth',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for SQS
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
          'sqs:ListQueues',
          'sqs:ListQueueTags',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for OpenSearch
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'es:DescribeElasticsearchDomain',
          'es:ListDomainNames',
          'es:ListTags',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for Transit Gateway
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ec2:DescribeTransitGateways'],
        resources: ['*'],
      }),
    );

    // Attach policies for RDS
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'rds:DescribeDBInstances',
          'rds:ListTagsForResource',
          'rds:DescribeDBClusters',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for Route53Resolver
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'route53resolver:ListResolverEndpoints',
          'route53resolver:ListTagsForResource',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for CloudFront
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudfront:GetDistribution',
          'cloudfront:ListDistributions',
          'cloudfront:ListTagsForResource',
        ],
        resources: ['*'],
      }),
    );

    // Attach policies for VPN
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ec2:DescribeVpnConnections'],
        resources: ['*'],
      }),
    );

    // Attach policies for Step Functions to list statemachine and get tags
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['states:ListStateMachines', 'states:ListTagsForResource'],
        resources: ['*'],
      }),
    );

    // Attach policy for Lambda to read function tags (ListTags) so AutoAlarm
    // can manage alarms for tagged functions. Only ListTags is needed — the
    // handler never calls GetFunction (tags come from the ListTags response).
    autoAlarmExecutionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:ListTags'],
        resources: ['*'],
      }),
    );

    return autoAlarmExecutionRole;
  }

  /**
   * private method initialize the main function
   */
  private createFunction(
    role: IRole,
    prometheusWorkspaceId: string,
    accountId: string,
  ): ExtendedNodejsFunction {
    // Create the main function
    return new ExtendedNodejsFunction(this, 'mainFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'main-handler.mts',
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 768,
      role: role,
      environment: {
        PROMETHEUS_WORKSPACE_ID: prometheusWorkspaceId,
        ACCT_ID: accountId,
      },
      bundling: {
        nodeModules: ['@smithy/util-retry'],
      },
      deploymentOptions: {
        createDeployment: false,
      },
    });
  }
}
