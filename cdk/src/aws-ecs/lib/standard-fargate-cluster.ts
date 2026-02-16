import {Construct} from 'constructs';
import {Connections, IVpc, Vpc} from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ClusterReference,
  ExecuteCommandConfiguration,
  ExecuteCommandLogging,
  ICluster,
  CloudMapNamespaceOptions,
} from 'aws-cdk-lib/aws-ecs';
import {IKey} from 'aws-cdk-lib/aws-kms';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {RemovalPolicy, ResourceEnvironment, Stack} from 'aws-cdk-lib';
import {INamespace} from 'aws-cdk-lib/aws-servicediscovery';
import {IAutoScalingGroup} from 'aws-cdk-lib/aws-autoscaling';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';

export interface StandardFargateClusterProps extends ExtendedConstructProps {
  // TODO I don't like what I did here
  /**
   * The VPC where your ECS instances will be running.
   * One of vpc, vpcId or vpcName is required.
   */
  readonly vpc?: IVpc;

  /**
   * The ID of the VPC where your ECS instances will be running.
   * One of vpc, vpcId or vpcName is required.
   */
  readonly vpcId?: string;

  /**
   * The name of the VPC where your ECS instances will be running.
   * One of vpc, vpcId or vpcName is required.
   */
  readonly vpcName?: string;

  /**
   * The name for the cluster. Best practice is to not set this value.
   */
  readonly clusterName?: string;

  /**
   * If true CloudWatch Container Insights will be enabled for the cluster
   *
   * @default - true
   */
  readonly containerInsights?: boolean;

  /**
   * Whether to enable Fargate Capacity Providers
   *
   * @default - true
   */
  readonly enableFargateCapacityProviders?: boolean;

  /**
   * The service discovery namespace created in this cluster
   * default service discovery namespace later.
   */
  readonly defaultCloudMapNamespace?: CloudMapNamespaceOptions;

  /**
   * Enables or disables the execute command log for the cluster.
   * This is enabled by default and logs to a CloudWatch log group
   * created by this construct.
   *
   * @default - true
   */
  readonly enableExecuteCommandLog?: boolean;

  /**
   * The KMS key to encrypt data between the local client and container.
   */
  readonly kmsKey?: IKey;

  /**
   * The retention period to use for execute command logs.
   *
   * @default RetentionDays.ONE_MONTH
   */
  readonly executeCommandLogRetention?: RetentionDays;

  /**
   * Allows overriding the default executeCommandConfiguration provided in
   * this construct.
   */
  readonly executeCommandConfigurationOverride?: ExecuteCommandConfiguration;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;
}

/**
 * Standard ECS Cluster that sets up Fargate providers and execute command logging.
 */
export class StandardFargateCluster
  extends ExtendedConstruct
  implements ICluster
{
  readonly vpc: IVpc;
  readonly cluster: Cluster;
  readonly logGroup?: LogGroup;

  // Carry over from ICluster
  readonly clusterName: string;
  readonly clusterArn: string;
  readonly clusterRef: ClusterReference;
  readonly connections: Connections;
  readonly hasEc2Capacity: boolean;
  readonly defaultCloudMapNamespace?: INamespace;
  readonly autoscalingGroup?: IAutoScalingGroup;
  readonly executeCommandConfiguration?: ExecuteCommandConfiguration;
  readonly stack: Stack;
  readonly env: ResourceEnvironment;

  protected resolveVpc(
    scope: StandardFargateCluster,
    props: StandardFargateClusterProps,
  ): IVpc {
    if (
      props.vpc === undefined &&
      props.vpcId === undefined &&
      props.vpcName === undefined
    ) {
      throw new Error('One of vpc, vpcId or vpcName is required');
    }
    return props.vpc !== undefined
      ? props.vpc
      : Vpc.fromLookup(this, 'Vpc', {
          vpcId: props.vpcId,
          vpcName: props.vpcName,
        });
  }

  protected resolveLogGroup(
    scope: StandardFargateCluster,
    props: StandardFargateClusterProps,
  ): LogGroup | undefined {
    if (
      (props.enableExecuteCommandLog ?? true) &&
      props.executeCommandConfigurationOverride === undefined
    ) {
      return new LogGroup(scope, 'ExecuteCommandLogs', {
        encryptionKey: props.kmsKey,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }
    return undefined;
  }

  protected resolveExecuteCommandConfiguration(
    scope: StandardFargateCluster,
    logGroup: LogGroup | undefined,
    props: StandardFargateClusterProps,
  ): ExecuteCommandConfiguration | undefined {
    if (props.enableExecuteCommandLog ?? true) {
      if (props.executeCommandConfigurationOverride !== undefined) {
        return props.executeCommandConfigurationOverride;
      } else {
        return {
          kmsKey: props.kmsKey,
          logConfiguration: {
            cloudWatchEncryptionEnabled: true,
            cloudWatchLogGroup: logGroup,
          },
          logging: ExecuteCommandLogging.OVERRIDE,
        };
      }
    }
    return undefined;
  }

  constructor(
    scope: Construct,
    id: string,
    props: StandardFargateClusterProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    const vpc = this.resolveVpc(this, props);
    const logGroup = this.resolveLogGroup(this, props);
    const executeCommandConfiguration = this.resolveExecuteCommandConfiguration(
      this,
      logGroup,
      props,
    );
    const cluster = new Cluster(this, 'Default', {
      vpc,
      clusterName: props.clusterName,
      containerInsights: props.containerInsights ?? true,
      enableFargateCapacityProviders:
        props.enableFargateCapacityProviders ?? true,
      defaultCloudMapNamespace: props.defaultCloudMapNamespace,
      executeCommandConfiguration,
    });
    this.vpc = vpc;
    this.cluster = cluster;
    this.logGroup = logGroup;
    this.clusterName = this.cluster.clusterName;
    this.clusterArn = this.cluster.clusterArn;
    this.clusterRef = this.cluster.clusterRef;
    this.connections = this.cluster.connections;
    this.hasEc2Capacity = this.cluster.hasEc2Capacity;
    this.defaultCloudMapNamespace = this.cluster.defaultCloudMapNamespace;
    this.autoscalingGroup = this.cluster.autoscalingGroup;
    this.executeCommandConfiguration = this.cluster.executeCommandConfiguration;
    this.stack = this.cluster.stack;
    this.env = this.cluster.env;
  }

  applyRemovalPolicy(policy: RemovalPolicy) {
    this.cluster.applyRemovalPolicy(policy);
  }
}
