import {existsSync, statSync} from 'node:fs';
import {Duration, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {SecurityGroup, Vpc} from 'aws-cdk-lib/aws-ec2';
import {Rule, Schedule} from 'aws-cdk-lib/aws-events';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {PolicyStatement, Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import type {Code} from 'aws-cdk-lib/aws-lambda';
import {CfnScheduleGroup} from 'aws-cdk-lib/aws-scheduler';
import {Construct} from 'constructs';
import {ExtendedBucket} from 'truemark-cdk-lib/aws-s3';
import {StandardDeadLetterQueue} from 'truemark-cdk-lib/aws-sqs';
import {CollectorFunction} from './collector-function.js';
import {CollectorRole} from './collector-role.js';
import {RegistrarFunction} from './registrar-function.js';

export interface DatabaseCollectorProps {
  /** VPC the collector function runs in. */
  readonly vpcId: string;
  /**
   * Subnets the collector function is placed in. They need a route to the
   * monitored databases and to the Secrets Manager API.
   */
  readonly subnetIds: string[];
  /**
   * Prefix of the tags that opt a database in and configure it.
   *
   * @default 'database-collector:'
   */
  readonly tagPrefix?: string;
  /**
   * Database user the collector logs in as when using IAM authentication.
   *
   * @default 'database_collector'
   */
  readonly databaseUser?: string;
  /**
   * Name of the collector's IAM role.
   *
   * @default - 'database-collector-' followed by the region
   */
  readonly roleName?: string;
  /**
   * CloudWatch namespace the collected metrics are published under. Set to
   * an empty string to write structured logs without publishing metrics.
   *
   * @default 'DatabaseCollector'
   */
  readonly metricsNamespace?: string;
  /**
   * SSM Parameter Store path that custom query sets referenced as `<name>`
   * or `ssm:<name>` are read from: the set is the parameter `<path>/<name>`.
   *
   * @default '/database-collector/query-sets'
   */
  readonly querySetParameterPath?: string;
  /**
   * Local directory whose `*.yaml` files are uploaded to the query set
   * bucket under `query-sets/` on every deploy. Files already in the bucket
   * that are not in the directory are left alone.
   *
   * @default - nothing is uploaded
   */
  readonly querySetsDir?: string;
  /**
   * Overrides the collector deployment package.
   *
   * @default - the zip built from ../collector
   */
  readonly collectorCode?: Code;
}

/**
 * Collects additional metrics from tagged databases once per minute.
 *
 * Tag changes reach the registrar function, which keeps one EventBridge
 * Scheduler schedule per tagged database. Each schedule invokes the collector
 * function with that database as its input.
 */
export class DatabaseCollector extends Construct {
  /** Role the collector connects to databases with. */
  readonly collectorRole: CollectorRole;
  /** Security group to allow in each monitored database's security group. */
  readonly collectorSecurityGroup: SecurityGroup;
  /** Bucket custom query sets are read from, as `query-sets/<name>.yaml`. */
  readonly querySetBucket: ExtendedBucket;
  /** SSM Parameter Store path custom query sets are read from. */
  readonly querySetParameterPath: string;
  readonly collectorFunction: CollectorFunction;
  readonly registrarFunction: RegistrarFunction;

  constructor(scope: Construct, id: string, props: DatabaseCollectorProps) {
    super(scope, id);

    if (props.subnetIds.length === 0) {
      throw new Error('At least one subnet ID is required');
    }

    const stack = Stack.of(this);
    const tagPrefix = props.tagPrefix ?? 'database-collector:';
    this.querySetParameterPath = normalizeParameterPath(
      props.querySetParameterPath ?? '/database-collector/query-sets',
    );

    // Only the VPC ID and subnet IDs are known, so the availability zone
    // names are placeholders. They are never rendered into the template.
    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.subnetIds.map((_, i) => `placeholder-${i}`),
      privateSubnetIds: props.subnetIds,
    });

    this.collectorSecurityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Database Collector function',
      allowAllOutbound: true,
    });

    this.collectorRole = new CollectorRole(this, 'CollectorRole', {
      roleName: props.roleName ?? `database-collector-${stack.region}`,
      databaseUser: props.databaseUser ?? 'database_collector',
      tagPrefix,
    });

    // Custom query sets. Versioning keeps the history of every set, so a bad
    // edit can be rolled back.
    this.querySetBucket = new ExtendedBucket(this, 'QuerySetBucket', {
      versioned: true,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.querySetBucket.grantRead(
      this.collectorRole,
      `${QUERY_SET_KEY_PREFIX}*`,
    );
    if (props.querySetsDir !== undefined) {
      if (
        !existsSync(props.querySetsDir) ||
        !statSync(props.querySetsDir).isDirectory()
      ) {
        throw new Error(
          `querySetsDir ${props.querySetsDir} is not a directory`,
        );
      }
      this.querySetBucket.deploy({
        source: props.querySetsDir,
        prefix: QUERY_SET_KEY_PREFIX,
        exclude: '*',
        include: '*.yaml',
        // Sets added to the bucket by other means are kept.
        prune: false,
      });
    }
    this.collectorRole.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          stack.formatArn({
            service: 'ssm',
            resource: 'parameter',
            // The ARN has no slash of its own between "parameter" and the path.
            resourceName: `${this.querySetParameterPath.slice(1)}/*`,
          }),
        ],
      }),
    );

    this.collectorFunction = new CollectorFunction(this, 'CollectorFunction', {
      role: this.collectorRole,
      vpc,
      vpcSubnets: {subnets: vpc.privateSubnets},
      securityGroups: [this.collectorSecurityGroup],
      code: props.collectorCode,
      metricsNamespace: props.metricsNamespace ?? 'DatabaseCollector',
      querySetBucketName: this.querySetBucket.bucketName,
      querySetParameterPath: this.querySetParameterPath,
    });

    // Receives invocations that could not be delivered: collector invocations
    // from EventBridge Scheduler and tag events for the registrar. A handler
    // that was invoked and then failed or timed out does not end up here.
    const deadLetterQueue = new StandardDeadLetterQueue(
      this,
      'DeadLetterQueue',
    );

    const scheduleGroup = new CfnScheduleGroup(this, 'ScheduleGroup', {
      name: `${stack.stackName}-${stack.region}`,
    });

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description:
        'Used by EventBridge Scheduler to invoke the Database Collector function',
    });
    this.collectorFunction.alias.grantInvoke(schedulerRole);
    deadLetterQueue.grantSendMessages(schedulerRole);

    this.registrarFunction = new RegistrarFunction(this, 'RegistrarFunction', {
      environment: {
        TAG_PREFIX: tagPrefix,
        SCHEDULE_GROUP_NAME: scheduleGroup.ref,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        COLLECTOR_FUNCTION_ARN: this.collectorFunction.alias.functionArn,
        DEAD_LETTER_QUEUE_ARN: deadLetterQueue.queueArn,
      },
    });
    this.registrarFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: [
          stack.formatArn({
            service: 'scheduler',
            resource: 'schedule',
            resourceName: `${scheduleGroup.ref}/*`,
          }),
        ],
      }),
    );
    this.registrarFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['scheduler:ListSchedules'],
        resources: ['*'],
      }),
    );
    this.registrarFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
      }),
    );
    this.registrarFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'tag:GetResources',
          'rds:DescribeDBInstances',
          'rds:ListTagsForResource',
          'secretsmanager:DescribeSecret',
        ],
        resources: ['*'],
      }),
    );

    const registrarTarget = new LambdaFunction(this.registrarFunction, {
      deadLetterQueue,
    });

    new Rule(this, 'TagRule', {
      description: 'Routes database tag changes to Database Collector',
      eventPattern: {
        source: ['aws.tag'],
        detailType: ['Tag Change on Resource'],
        detail: {
          service: ['rds', 'secretsmanager'],
          'resource-type': ['db', 'secret'],
          'changed-tag-keys': [{prefix: tagPrefix}],
        },
      },
      targets: [registrarTarget],
    });

    // Catches tag changes whose events were missed or failed.
    new Rule(this, 'ReconcileRule', {
      description: 'Reconciles Database Collector schedules with tags',
      schedule: Schedule.rate(Duration.hours(1)),
      targets: [registrarTarget],
    });
  }
}

/** Key prefix of query sets in the bucket; must match the collector's Handler. */
const QUERY_SET_KEY_PREFIX = 'query-sets/';

/** Checks an SSM parameter path and drops a trailing slash. */
function normalizeParameterPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  if (!/^(\/[A-Za-z0-9_.-]+)+$/.test(normalized)) {
    throw new Error(
      `querySetParameterPath must look like /a/b, not ${JSON.stringify(path)}`,
    );
  }
  return normalized;
}
