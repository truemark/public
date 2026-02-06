import {Construct} from 'constructs';
import {
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
  OperatingSystemFamily,
  Secret,
} from 'aws-cdk-lib/aws-ecs';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {LogConfiguration} from './log-configuration';
import {SecurityGroup, SubnetSelection, SubnetType} from 'aws-cdk-lib/aws-ec2';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {ArnFormat, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {
  Role,
  PolicyStatement,
  ServicePrincipal,
  IRole,
  IPrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import * as path from 'node:path';
import * as fs from 'fs';
import {OtelConfig} from './otel-configuration';

/**
 * Properties for StandardFargateRunTask.
 */
export interface StandardFargateRunTaskProps extends ExtendedConstructProps {
  /**
   * The CPU allocated to the task.
   *
   * @default - 2048
   */
  readonly cpu?: number;

  /**
   * The memory allocated to the task.
   *
   * @default - 4096
   */
  readonly memoryLimitMiB?: number;

  /**
   * Optional ephemeral storage allocated to the task.
   *
   * @default - 20
   */
  readonly ephemeralStorageGiB?: number;

  /**
   * CPU architecture to use for the task
   *
   * @default - CpuArchitecture.ARM64
   */
  readonly cpuArchitecture?: CpuArchitecture;

  /**
   * The name of the task definition family.
   *
   * @default - CloudFormation-generated name.
   */
  readonly family?: string;

  /**
   * Log configuration for this task.
   */
  readonly logConfiguration?: LogConfiguration;

  /**
   * Disables X-Ray for this task. Default is false.
   *
   * @default - false
   */
  readonly disableXray?: boolean;

  /**
   * The cluster to associate with this task definition.
   */
  readonly cluster: ICluster;

  /**
   * Container image to use in this task.
   */
  readonly image: ContainerImage;

  /**
   * Subnets to use for running the task. If this is left empty, subnet type PRIVATE_WITH_EGRESS is used.
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * Environment variables to pass to the container.
   */
  readonly environment?: Record<string, string>;

  /**
   * A key/value map of labels to add to the container.
   */
  readonly dockerLabels?: Record<string, string>;

  /**
   * The secret environment variables to pass to the container.
   */
  readonly secrets?: Record<string, Secret>;

  /**
   * Whether to assign a public IP address to the task.
   *
   * @default - false
   */
  readonly assignPublicIp?: boolean;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;

  /**
   * Setting this to true will enable outbound IPv6 for the task. Default is false.
   *
   * @default - false
   */
  readonly allowAllIpv6Outbound?: boolean;

  /**
   * Setting the Standard OpenTelemetry (OTEL) configuration for ECS tasks.
   */
  readonly otel?: OtelConfig;

  /**
   * The name of the IAM role that grants containers in the task permission to call other AWS resources.
   * Best practice is not to assign a value to this field, and let the CDK create a role for you. This field is
   * ignored if taskRole is specified.
   *
   * @default - A task role is automatically created for you.
   */
  readonly taskRoleName?: string;

  /**
   * The IAM role that grants containers in the task permission to call other AWS resources.
   * Best practice is not to assign a value to this field, and let the CDK create a role for you.
   *
   * @default - A task role is automatically created for you.
   */
  readonly taskRole?: IRole;

  /**
   * Principals that should be granted permission to execute this task.
   * Commonly used with Step Functions state machines.
   *
   * @default - No principals are granted permission.
   */
  readonly grantPrincipal?: IPrincipal;

  /**
   * The name of the container. This is useful for referencing the container in Step Functions.
   *
   * @default - 'Container'
   */
  readonly containerName?: string;

  /**
   * Optional command override for the container.
   */
  readonly command?: string[];

  /**
   * Optional entry point override for the container.
   */
  readonly entryPoint?: string[];
}

/**
 * Standard class for creating a Fargate task definition optimized for RunTask operations.
 * This construct is designed for event-driven, on-demand task execution (e.g., Step Functions)
 * rather than long-running services. Use StandardFargateService for always-running services.
 *
 * Key differences from StandardFargateService:
 * - Creates only a TaskDefinition (no Service or auto-scaling)
 * - Optimized for on-demand execution
 * - Supports granting RunTask permissions to principals (e.g., Step Functions)
 * - No continuous cost when not running
 *
 * Example usage with Step Functions:
 * ```typescript
 * const runTask = new StandardFargateRunTask(this, 'MyTask', {
 *   cluster: cluster,
 *   image: ContainerImage.fromRegistry('my-image'),
 *   grantPrincipal: stateMachine.role,
 * });
 * ```
 */
export class StandardFargateRunTask extends ExtendedConstruct {
  readonly taskDefinition: FargateTaskDefinition;
  readonly logGroup?: LogGroup;
  readonly securityGroup: SecurityGroup;
  readonly vpcSubnets: SubnetSelection;
  readonly assignPublicIp: boolean;
  readonly containerName: string;

  protected resolveLogGroup(
    scope: Construct,
    props: StandardFargateRunTaskProps,
  ): LogGroup | undefined {
    if (props.logConfiguration?.enabled ?? true) {
      return new LogGroup(scope, 'LogGroup', {
        retention: props.logConfiguration?.retention ?? RetentionDays.FIVE_DAYS,
        logGroupName: props.logConfiguration?.logGroupName,
        encryptionKey: props.logConfiguration?.encryptionKey,
        removalPolicy:
          props.logConfiguration?.removalPolicy ?? RemovalPolicy.DESTROY,
      });
    }
    return undefined;
  }

  protected resolveLogDriver(
    scope: Construct,
    props: StandardFargateRunTaskProps,
    logGroup: LogGroup | undefined,
  ): LogDriver | undefined {
    if (props.logConfiguration?.enabled ?? true) {
      return LogDriver.awsLogs({
        streamPrefix: scope.node.id,
        logGroup,
      });
    }
    return undefined;
  }

  protected resolveVpcSubnets(
    scope: Construct,
    props: StandardFargateRunTaskProps,
  ): SubnetSelection {
    if (props.vpcSubnets === undefined) {
      return {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      };
    }
    return props.vpcSubnets;
  }

  constructor(
    scope: Construct,
    id: string,
    props: StandardFargateRunTaskProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    let taskRole = props.taskRole;
    if (!taskRole && props.taskRoleName) {
      taskRole = new Role(this, 'TaskRole', {
        roleName: props.taskRoleName,
        assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      });
    }

    const taskDefinition = new FargateTaskDefinition(this, 'Resource', {
      taskRole,
      cpu: props.cpu ?? 2048,
      memoryLimitMiB: props.memoryLimitMiB ?? 4096,
      ephemeralStorageGiB: props.ephemeralStorageGiB,
      family: props.family,
      runtimePlatform: {
        operatingSystemFamily: OperatingSystemFamily.LINUX,
        cpuArchitecture: props.cpuArchitecture ?? CpuArchitecture.ARM64,
      },
    });

    if (!props.disableXray) {
      taskDefinition.addToTaskRolePolicy(
        new PolicyStatement({
          resources: ['*'],
          actions: ['cloudwatch:PutMetricData'],
        }),
      );
    }

    const logGroup = this.resolveLogGroup(this, props);
    const logging = this.resolveLogDriver(this, props, logGroup);
    const containerName = props.containerName ?? 'Container';

    taskDefinition.addContainer(containerName, {
      image: props.image,
      logging,
      environment: props.environment,
      dockerLabels: props.dockerLabels,
      secrets: props.secrets,
      command: props.command,
      entryPoint: props.entryPoint,
    });

    // Add Otel container if enabled
    const otel = props.otel;
    if (otel && otel.enabled) {
      let otelConfigPathLocal: string;
      if (otel.configPath) {
        otelConfigPathLocal = otel.configPath;
      } else {
        otelConfigPathLocal = path.resolve(
          __dirname,
          '../../resources/ecs-otel-task-metrics-config.yaml',
        );
      }

      const otelContainerName = otel.containerName ?? 'otel-collector';
      taskDefinition.addContainer('Otel', {
        containerName: otelContainerName,
        image: ContainerImage.fromRegistry(
          otel.collectorImage ??
            'public.ecr.aws/aws-observability/aws-otel-collector:latest',
        ),
        cpu: otel.containerCpu ?? 256,
        memoryLimitMiB: otel.containerMemoryLimitMiB ?? 512,
        logging: LogDriver.awsLogs({
          streamPrefix: otelContainerName,
          logGroup: logGroup,
        }),
        ...(otel.ssmConfigContentParam && {
          secrets: {
            AOT_CONFIG_CONTENT: Secret.fromSsmParameter(
              StringParameter.fromStringParameterName(
                this,
                'OtelSSMConfigParam',
                otel.ssmConfigContentParam,
              ),
            ),
          },
        }),
        environment: {
          ...(otel.environmentVariables ?? {}),
          ...(props.otel?.applicationMetricsNamespace &&
            props.otel?.applicationMetricsLogGroup && {
              ECS_APPLICATION_METRICS_NAMESPACE:
                props.otel?.applicationMetricsNamespace,
              ECS_APPLICATION_METRICS_LOG_GROUP:
                props.otel?.applicationMetricsLogGroup,
            }),
          ...(!otel.ssmConfigContentParam &&
            otelConfigPathLocal && {
              AOT_CONFIG_CONTENT: fs.readFileSync(otelConfigPathLocal, 'utf8'),
            }),
        },
      });

      // Add SSM permissions to read parameters
      if (otel.ssmConfigContentParam) {
        taskDefinition.addToTaskRolePolicy(
          new PolicyStatement({
            resources: [
              `arn:aws:ssm:${Stack.of(this).region}:${
                Stack.of(this).account
              }:parameter${otel.ssmConfigContentParam}`,
            ],
            actions: ['ssm:GetParameters', 'ssm:GetParametersByPath'],
          }),
        );
      }

      // Add AMP permissions for remote write to Prometheus
      if (otel.ampWorkSpaceId) {
        taskDefinition.addToTaskRolePolicy(
          new PolicyStatement({
            resources: [
              `arn:aws:aps:${Stack.of(this).region}:${
                Stack.of(this).account
              }:workspace/${otel.ampWorkSpaceId}`,
            ],
            actions: ['aps:RemoteWrite'],
          }),
        );
      } else {
        taskDefinition.addToTaskRolePolicy(
          new PolicyStatement({
            resources: ['*'],
            actions: ['aps:RemoteWrite'],
          }),
        );
      }

      // Add permission to permit otel events
      taskDefinition.addToTaskRolePolicy(
        new PolicyStatement({
          resources: ['*'],
          actions: [
            'logs:PutLogEvents',
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:DescribeLogStreams',
            'logs:DescribeLogGroups',
            'logs:PutRetentionPolicy',
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
            'xray:GetSamplingStatisticSummaries',
            'aps:PutMetricData',
            'aps:GetSeries',
            'aps:GetLabels',
          ],
        }),
      );
    }

    const vpcSubnets = this.resolveVpcSubnets(this, props);
    const assignPublicIp = props.assignPublicIp ?? false;

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.cluster.vpc,
      allowAllIpv6Outbound: props.allowAllIpv6Outbound ?? false,
      allowAllOutbound: true,
    });

    // Assign properties before calling grantRunTask
    this.taskDefinition = taskDefinition;
    this.logGroup = logGroup;
    this.securityGroup = securityGroup;
    this.vpcSubnets = vpcSubnets;
    this.assignPublicIp = assignPublicIp;
    this.containerName = containerName;

    // Grant RunTask permissions to the specified principal (e.g., Step Functions)
    if (props.grantPrincipal) {
      this.grantRunTask(props.grantPrincipal);
    }
  }

  /**
   * Grant the specified principal permission to run this task.
   * This is typically used to allow Step Functions or other AWS services to execute the task.
   *
   * @param principal The principal to grant permissions to (e.g., a Step Function's role)
   */
  grantRunTask(principal: IPrincipal): void {
    // Grant permission to run the task
    // Use wildcard to allow any revision of this task definition family
    const taskDefArnPattern = Stack.of(this).formatArn({
      service: 'ecs',
      resource: 'task-definition',
      resourceName: `${this.taskDefinition.family}:*`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    principal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [taskDefArnPattern],
      }),
    );

    // Grant permission to pass the task and execution roles
    const roles = [this.taskDefinition.executionRole?.roleArn];
    if (this.taskDefinition.taskRole) {
      roles.push(this.taskDefinition.taskRole.roleArn);
    }

    principal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: roles.filter((r): r is string => r !== undefined),
      }),
    );
  }

  /**
   * Get the network configuration for use with RunTask API or Step Functions.
   * This provides the subnets, security groups, and public IP configuration.
   */
  getNetworkConfiguration() {
    return {
      awsvpcConfiguration: {
        subnets: this.vpcSubnets,
        securityGroups: [this.securityGroup.securityGroupId],
        assignPublicIp: this.assignPublicIp ? 'ENABLED' : 'DISABLED',
      },
    };
  }
}
