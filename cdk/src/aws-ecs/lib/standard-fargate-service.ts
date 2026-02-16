import {Construct} from 'constructs';
import {
  CapacityProviderStrategy,
  ContainerImage,
  CpuArchitecture,
  DeploymentControllerType,
  FargatePlatformVersion,
  FargateService,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
  OperatingSystemFamily,
  Protocol,
  ScalableTaskCount,
  Secret,
} from 'aws-cdk-lib/aws-ecs';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {LogConfiguration} from './log-configuration';
import {SecurityGroup, SubnetSelection, SubnetType} from 'aws-cdk-lib/aws-ec2';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {Duration, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {
  Role,
  PolicyStatement,
  ServicePrincipal,
  IRole,
} from 'aws-cdk-lib/aws-iam';
import {BasicStepScalingPolicyProps} from 'aws-cdk-lib/aws-autoscaling';
import {IMetric} from 'aws-cdk-lib/aws-cloudwatch';
import {ScalingSchedule} from 'aws-cdk-lib/aws-applicationautoscaling';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';
import * as path from 'node:path';
import * as fs from 'fs';
import {OtelConfig} from './otel-configuration';

/**
 * Properties for StandardFargateService.
 */
export interface StandardFargateServiceProps extends ExtendedConstructProps {
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
   * The name of the service as it appears in the console or in the AWS CLI.
   *
   * @default - CloudFormation-generated name.
   */
  readonly serviceName?: string;

  /**
   * Log configuration for this service.
   */
  readonly logConfiguration?: LogConfiguration;

  /**
   * Disables X-Ray for this service. Default is false.
   *
   * @default - false
   */
  readonly disableXray?: boolean;

  /**
   * Enables the ability to push custom metrics to CloudWatch from the service.
   *
   * @default - true
   */
  readonly enablePublishMetrics?: boolean;

  /**
   * The cluster to place services in.
   */
  readonly cluster: ICluster;

  /**
   * The container port.
   *
   * @default 8080
   */
  readonly port?: number;

  /**
   * Whether the port is TCP or UDP.
   *
   * @default Protocol.TCP
   */
  readonly protocol?: Protocol;

  /**
   * Container image to deploy in this service.
   */
  readonly image: ContainerImage;

  /**
   * Subnets to put the service in. If this is left empty, subnet type PRIVATE_WITH_EGRESS is used.
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * Environment variables to pass to this service.
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
   * The maximum number of tasks, specified as a percentage of the Amazon ECS
   * service's DesiredCount value, that can run in a service during a
   * deployment.
   *
   * @default - 200
   */
  readonly maxHealthyPercent?: number;

  /**
   * The minimum number of tasks, specified as a percentage of
   * the Amazon ECS service's DesiredCount value, that must
   * continue to run and remain healthy during a deployment.
   *
   * @default - 100
   */
  readonly minHealthyPercent?: number;

  /**
   * Enable rollback on deployment failure
   *
   * @default - true
   */
  readonly enableRollback?: boolean;

  /**
   * Specifies which deployment controller to use for the service
   *
   * @default - DeploymentControllerType.ECS
   */
  readonly deploymentControllerType?: DeploymentControllerType;

  /**
   * Whether to enable the ability to execute into a container
   *
   * @default - true
   */
  readonly enableExecuteCommand?: boolean;

  /**
   * The platform version on which to run your service.
   *
   * @default - FargatePlatformVersion.LATEST
   */
  readonly platformVersion?: FargatePlatformVersion;

  /**
   * Whether to assign a public IP address to the containers.
   *
   * @default - false
   */
  readonly assignPublicIp?: boolean;

  /**
   * Specifies whether to enable Amazon ECS managed tags for the tasks within the service
   *
   * @default - true
   */
  readonly enableECSManagedTags?: boolean;

  /**
   * Desired count for this service. If not set, defaults to minCapacity.
   *
   * @default - minCapacity
   */
  readonly desiredCount?: number;

  /**
   * Minimum capacity to scale to.
   *
   * @default - 1
   */
  readonly minCapacity?: number;

  /**
   * Maximum capacity to scale to.
   *
   * @default - 2
   */
  readonly maxCapacity?: number;

  /**
   * Period after a scale in activity completes before another scale in activity can start.
   *
   * @default - Duration.seconds(10)
   */
  readonly scaleInCooldown?: Duration;

  /**
   * Period after a scale out activity completes before another scale out activity can start.
   *
   * @default - Duration.seconds(60)
   */
  readonly scaleOutCooldown?: Duration;

  /**
   * The target value for CPU utilization across all tasks in the service.
   * Set this to 0 to disable CPU scaling.
   *
   * @default - 60
   */
  readonly scaleCpuTargetUtilizationPercent?: number;

  /**
   * The target value for memory utilization across all tasks in the service.
   * Disabled by default.
   */
  readonly scaleMemoryTargetUtilizationPercent?: number;

  /**
   * Capacity weight for the FARGATE capacity provider. Default is to not use capacity providers.
   */
  readonly capacityWeight?: number;

  /**
   * The minimum number of tasks to run on the FARGATE capacity provider. Default is to not use capacity providers.
   */
  readonly capacityBase?: number;

  /**
   * Capacity weight for the FARGATE_SPOT capacity provider. Default is to not use capacity providers.
   */
  readonly spotCapacityWeight?: number;

  /**
   * The minimum number of tasks to run on the FARGATE_SPOT capacity provider. Default is to not use capacity providers.
   */
  readonly spotCapacityBase?: number;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;

  /**
   * Setting this to true will enable outbound IPv6 for the service. Default is false.
   *
   * @default - false
   */
  readonly allowAllIpv6Outbound?: boolean;

  /**
   * The period of time, in seconds, that the Amazon ECS service scheduler ignores unhealthy
   * Elastic Load Balancing target health checks after a task has first started. Do not use this
   * property unless you are working with an Application Load Balancer. Default is undefined.
   */
  readonly healthCheckGracePeriod?: Duration;

  /**
   * Setting the Standard OpenTelemetry (OTEL) configuration for ECS services.
   *
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
}

/**
 * Standard class for creating a FargateService. It's recommended to use the StandardApplicationFargateService or
 * StandardNetworkFargateService instead of this class.
 */
export class StandardFargateService extends ExtendedConstruct {
  readonly taskDefinition: FargateTaskDefinition;
  readonly logGroup?: LogGroup;
  readonly service: FargateService;
  readonly port: number;
  readonly scaling: ScalableTaskCount;
  readonly scaleInCooldown: Duration;
  readonly scaleOutCooldown: Duration;
  readonly securityGroup: SecurityGroup;

  protected resolveLogGroup(
    scope: Construct,
    props: StandardFargateServiceProps,
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
    props: StandardFargateServiceProps,
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
    props: StandardFargateServiceProps,
  ): SubnetSelection {
    if (props.vpcSubnets === undefined) {
      return {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      };
    }
    return props.vpcSubnets;
  }

  protected resolvedCapacityProviderStrategies(
    props: StandardFargateServiceProps,
  ): CapacityProviderStrategy[] | undefined {
    const strategies: CapacityProviderStrategy[] = [];
    if (
      props.capacityWeight !== undefined ||
      props.capacityBase !== undefined
    ) {
      strategies.push({
        capacityProvider: 'FARGATE',
        base: props.capacityBase,
        weight: props.capacityWeight,
      });
    }
    if (
      props.spotCapacityWeight !== undefined ||
      props.spotCapacityBase !== undefined
    ) {
      strategies.push({
        capacityProvider: 'FARGATE_SPOT',
        base: props.spotCapacityBase,
        weight: props.spotCapacityWeight,
      });
    }
    return strategies.length > 0 ? strategies : undefined;
  }

  constructor(
    scope: Construct,
    id: string,
    props: StandardFargateServiceProps,
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
    const port = props.port ?? 8080;
    const protocol = props.protocol ?? Protocol.TCP;

    taskDefinition.addContainer('Container', {
      image: props.image,
      portMappings: [
        {
          containerPort: port,
          hostPort: port,
          protocol,
        },
      ],
      logging,
      environment: props.environment,
      dockerLabels: props.dockerLabels,
      secrets: props.secrets,
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
        healthCheck: {
          command: ['CMD', '/healthcheck'],
          interval: Duration.seconds(10),
          timeout: Duration.seconds(5),
          retries: 5,
          startPeriod: Duration.seconds(30),
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
    const desiredCount = props.desiredCount ?? props.minCapacity ?? 1;
    const capacityProviderStrategies =
      this.resolvedCapacityProviderStrategies(props);

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.cluster.vpc,
      allowAllIpv6Outbound: props.allowAllIpv6Outbound ?? false,
      allowAllOutbound: true,
    });

    const service = new FargateService(this, 'Default', {
      cluster: props.cluster,
      taskDefinition,
      serviceName: props.serviceName,
      maxHealthyPercent: props.maxHealthyPercent ?? 200,
      minHealthyPercent: props.minHealthyPercent ?? 100,
      desiredCount,
      circuitBreaker: {
        rollback: props.enableRollback ?? true,
      },
      deploymentController: {
        type: props.deploymentControllerType ?? DeploymentControllerType.ECS,
      },
      vpcSubnets,
      platformVersion: props.platformVersion ?? FargatePlatformVersion.LATEST,
      enableExecuteCommand: props.enableExecuteCommand ?? true,
      assignPublicIp: props.assignPublicIp ?? false,
      enableECSManagedTags: props.enableECSManagedTags ?? true,
      healthCheckGracePeriod: props.healthCheckGracePeriod,
      capacityProviderStrategies,
      securityGroups: [securityGroup],
    });

    const scaling = service.autoScaleTaskCount({
      minCapacity: props.minCapacity ?? 1,
      maxCapacity: props.maxCapacity ?? 2,
    });
    const scaleInCooldown = props.scaleInCooldown ?? Duration.seconds(10);
    const scaleOutCooldown = props.scaleOutCooldown ?? Duration.seconds(60);

    if (props.scaleCpuTargetUtilizationPercent !== 0) {
      scaling.scaleOnCpuUtilization('CpuScaling', {
        scaleInCooldown,
        scaleOutCooldown,
        targetUtilizationPercent: props.scaleCpuTargetUtilizationPercent ?? 60,
      });
    }

    if (props.scaleMemoryTargetUtilizationPercent !== undefined) {
      scaling.scaleOnMemoryUtilization('MemoryScaling', {
        scaleInCooldown,
        scaleOutCooldown,
        targetUtilizationPercent: props.scaleMemoryTargetUtilizationPercent,
      });
    }

    this.port = port;
    this.taskDefinition = taskDefinition;
    this.logGroup = logGroup;
    this.service = service;
    this.scaling = scaling;
    this.scaleInCooldown = scaleInCooldown;
    this.scaleOutCooldown = scaleOutCooldown;
    this.securityGroup = securityGroup;
  }

  /**
   * Helper method to conduct scaling based on tracking custom metrics.
   *
   * @param id the id to give the scaling
   * @param metric the metric to track
   * @param targetValue the target value
   */
  scaleToTrackCustomMetric(id: string, metric: IMetric, targetValue: number) {
    this.scaling.scaleToTrackCustomMetric(id, {
      scaleInCooldown: this.scaleInCooldown,
      scaleOutCooldown: this.scaleOutCooldown,
      metric,
      targetValue,
    });
  }

  /**
   * Convenience method to scale based on a metric.
   *
   * @param id the id to give the scaling policy
   * @param props scaling properties
   */
  scaleOnMetric(id: string, props: BasicStepScalingPolicyProps) {
    this.scaling.scaleOnMetric(id, props);
  }

  /**
   * Convenience method to scale based on a schedule.
   *
   * @param id the id to give the scaling policy
   * @param props scaling properties
   */
  scaleOnSchedule(id: string, props: ScalingSchedule) {
    this.scaling.scaleOnSchedule(id, props);
  }
}
