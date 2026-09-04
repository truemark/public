import {
  Duration,
  RemovalPolicy,
  Resource,
  type ResourceEnvironment,
  type Stack,
} from 'aws-cdk-lib';
import type {Metric, MetricOptions} from 'aws-cdk-lib/aws-cloudwatch';
import {type Connections, SubnetType} from 'aws-cdk-lib/aws-ec2';
import type {Grant, IGrantable} from 'aws-cdk-lib/aws-iam';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  DatabaseCluster,
  DatabaseClusterEngine,
  type DatabaseProxy,
  type DatabaseProxyOptions,
  type DBClusterReference,
  DBClusterStorageType,
  type Endpoint,
  type IClusterEngine,
  type IDatabaseCluster,
  type IParameterGroup,
} from 'aws-cdk-lib/aws-rds';
import type {
  ISecret,
  SecretAttachmentTargetProps,
} from 'aws-cdk-lib/aws-secretsmanager';
import type {Construct} from 'constructs';
import {ExtendedConstruct, StandardTags} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import type {StandardPostgresProps} from './postgres-props';

/**
 * Properties for a StandardPostgresAuroraServerlessCluster.
 */
export interface StandardPostgresAuroraServerlessClusterProps
  extends StandardPostgresProps {
  /**
   * The Aurora PostgreSQL engine version to use.
   *
   * @default the latest version supported by this library
   */
  readonly engineVersion?: AuroraPostgresEngineVersion;

  /**
   * The name given to the cluster.
   *
   * @default CloudFormation-generated name
   */
  readonly clusterIdentifier?: string;

  /**
   * The minimum number of Aurora capacity units the cluster may scale down to.
   * Half-step increments; 0 enables automatic pause on engine versions that
   * support it.
   *
   * @default 0.5
   */
  readonly minCapacity?: number;

  /**
   * The maximum number of Aurora capacity units the cluster may scale up to.
   * Half-step increments, greater than 0.5 and at most 256.
   *
   * @default 4
   */
  readonly maxCapacity?: number;

  /**
   * The time in seconds the cluster may remain idle before it is paused,
   * between 300 (5 minutes) and 86400 (24 hours). Only supported when
   * minCapacity is 0.
   *
   * @default no automatic pause
   */
  readonly secondsUntilAutoPause?: number;

  /**
   * The number of reader instances to create.
   *
   * @default 1
   */
  readonly readers?: number;

  /**
   * Whether reader instances are promoted to writer in the same tier as the
   * writer instance during a failover.
   *
   * @default true
   */
  readonly readersInFailoverTier?: boolean;

  /**
   * The parameter group associated with the instances in the cluster. Distinct
   * from the cluster level parameterGroup.
   *
   * @default the default parameter group for the engine version
   */
  readonly instanceParameterGroup?: IParameterGroup;

  /**
   * Whether the storage of the cluster uses Aurora I/O-Optimized.
   *
   * @default false
   */
  readonly ioOptimized?: boolean;

  /**
   * Whether the instances in the cluster are publicly accessible.
   *
   * @default false
   */
  readonly publiclyAccessible?: boolean;

  /**
   * Whether IAM database authentication is enabled. Required for
   * `grantConnect` to have any effect and for RDS Proxy IAM authentication.
   *
   * @default true
   */
  readonly iamAuthentication?: boolean;

  /**
   * The removal policy applied to the generated master credentials secret.
   *
   * @default - follows the cluster: RETAIN unless the cluster's removal
   * policy is DESTROY
   */
  readonly secretRemovalPolicy?: RemovalPolicy;
}

/**
 * A standard Aurora Serverless v2 PostgreSQL database cluster.
 *
 * The construct implements IDatabaseCluster by delegating to the underlying
 * DatabaseCluster exposed as `cluster`. CDK APIs that inspect the construct
 * tree rather than the interface, such as `ProxyTarget.fromCluster`, do not
 * find the cluster's instances through this wrapper and would create a proxy
 * target group without waiting for them; hand those APIs `cluster` instead,
 * or use `addProxy`, which does so internally.
 */
export class StandardPostgresAuroraServerlessCluster
  extends ExtendedConstruct
  implements IDatabaseCluster
{
  /** The engine version used when props.engineVersion is not provided. */
  static readonly DEFAULT_ENGINE_VERSION = AuroraPostgresEngineVersion.VER_17_4;
  static readonly DEFAULT_MIN_CAPACITY = 0.5;
  static readonly DEFAULT_MAX_CAPACITY = 4;
  static readonly DEFAULT_READERS = 1;
  static readonly MAX_CAPACITY_LIMIT = 256;
  static readonly MIN_AUTO_PAUSE_SECONDS = 300;
  static readonly MAX_AUTO_PAUSE_SECONDS = 86400;

  /** The underlying Aurora Serverless v2 cluster. */
  readonly cluster: DatabaseCluster;

  /** The generated (or provided) master credentials secret, if any. */
  readonly secret?: ISecret;

  // From IDatabaseCluster
  readonly clusterIdentifier: string;
  readonly clusterResourceIdentifier: string;
  readonly instanceIdentifiers: string[];
  readonly clusterEndpoint: Endpoint;
  readonly clusterReadEndpoint: Endpoint;
  readonly instanceEndpoints: Endpoint[];
  readonly engine?: IClusterEngine;
  readonly clusterArn: string;
  readonly connections: Connections;
  readonly dbClusterRef: DBClusterReference;

  // From IResource
  readonly stack: Stack;
  readonly env: ResourceEnvironment;

  constructor(
    scope: Construct,
    id: string,
    props: StandardPostgresAuroraServerlessClusterProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(
        {
          ...(props.standardTags ?? {}),
          suppressTagging:
            props.suppressTagging ?? props.standardTags?.suppressTagging,
        },
        LibStandardTags,
      ),
    });

    if (props.parameterGroup && props.parameters) {
      throw new Error(
        'parameterGroup and parameters cannot be combined; pass either an existing group or parameters for a new one',
      );
    }

    const engine = DatabaseClusterEngine.auroraPostgres({
      version:
        props.engineVersion ??
        StandardPostgresAuroraServerlessCluster.DEFAULT_ENGINE_VERSION,
    });

    // caCertificate, instanceParameterGroup and publiclyAccessible are
    // per-instance settings in the CDK API, applied to the writer and every
    // reader.
    const instanceOptions = {
      parameterGroup: props.instanceParameterGroup,
      caCertificate: props.caCertificate,
      publiclyAccessible: props.publiclyAccessible ?? false,
    };

    const readerCount =
      props.readers ?? StandardPostgresAuroraServerlessCluster.DEFAULT_READERS;
    const readersInFailoverTier = props.readersInFailoverTier ?? true;
    const minCapacity =
      props.minCapacity ??
      StandardPostgresAuroraServerlessCluster.DEFAULT_MIN_CAPACITY;
    const maxCapacity =
      props.maxCapacity ??
      StandardPostgresAuroraServerlessCluster.DEFAULT_MAX_CAPACITY;
    StandardPostgresAuroraServerlessCluster.validate(
      minCapacity,
      maxCapacity,
      readerCount,
      props.secondsUntilAutoPause,
    );

    // removalPolicy is the CDK-native control. skipFinalSnapshot has no
    // direct CDK equivalent - it only downgrades a SNAPSHOT removal policy
    // to DESTROY (no-op otherwise).
    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const effectiveRemovalPolicy =
      props.skipFinalSnapshot && removalPolicy === RemovalPolicy.SNAPSHOT
        ? RemovalPolicy.DESTROY
        : removalPolicy;

    this.cluster = new DatabaseCluster(this, 'Default', {
      engine,
      clusterIdentifier: props.clusterIdentifier,
      credentials: props.credentials,
      defaultDatabaseName: props.databaseName,
      port: props.port,

      vpc: props.vpc,
      vpcSubnets: props.subnetGroup
        ? undefined
        : (props.vpcSubnets ?? {subnetType: SubnetType.PRIVATE_ISOLATED}),
      subnetGroup: props.subnetGroup,
      securityGroups: props.securityGroups,

      parameterGroup: props.parameterGroup,
      parameters: props.parameters,
      networkType: props.networkType,

      writer: ClusterInstance.serverlessV2('Writer', {
        ...instanceOptions,
        scaleWithWriter: true,
      }),
      readers: Array.from({length: readerCount}, (_, i) =>
        ClusterInstance.serverlessV2(`Reader${i + 1}`, {
          ...instanceOptions,
          // scaleWithWriter: true puts the reader in promotion tier 1 and
          // scales it to match the writer; false puts it in tier 2 and lets
          // it scale independently with its own read workload. This is the
          // real CDK mechanism behind readersInFailoverTier - there is no
          // separate promotionTier field on serverless v2 instances.
          scaleWithWriter: readersInFailoverTier,
        }),
      ),
      serverlessV2MinCapacity: minCapacity,
      serverlessV2MaxCapacity: maxCapacity,
      serverlessV2AutoPauseDuration:
        props.secondsUntilAutoPause === undefined
          ? undefined
          : Duration.seconds(props.secondsUntilAutoPause),
      storageType: props.ioOptimized
        ? DBClusterStorageType.AURORA_IOPT1
        : DBClusterStorageType.AURORA,

      storageEncrypted: props.storageEncrypted ?? true,
      storageEncryptionKey: props.storageEncryptionKey,

      backup: {
        retention: props.backupRetention ?? Duration.days(7),
        preferredWindow: props.preferredBackupWindow,
      },
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      autoMinorVersionUpgrade: props.autoMinorVersionUpgrade ?? true,

      deletionProtection: props.deletionProtection ?? true,
      removalPolicy: effectiveRemovalPolicy,
      iamAuthentication: props.iamAuthentication ?? true,

      monitoringInterval: props.monitoringInterval,
      enablePerformanceInsights: props.enablePerformanceInsights ?? false,
      performanceInsightRetention: props.performanceInsightRetention,

      cloudwatchLogsExports: props.cloudwatchLogsExports ?? ['postgresql'],
      cloudwatchLogsRetention:
        props.cloudwatchLogsRetention ?? RetentionDays.ONE_MONTH,
    });

    for (const peer of props.allowFrom ?? []) {
      this.cluster.connections.allowDefaultPortFrom(peer);
    }

    this.secret = this.cluster.secret;
    // A retained cluster is useless without its credentials: keep the generated
    // secret unless the cluster itself is destroyed. DatabaseCluster creates
    // the generated secret as its 'Secret' child; user-supplied secrets are
    // left alone.
    const generatedSecret = this.cluster.node.tryFindChild('Secret');
    if (generatedSecret instanceof Resource) {
      generatedSecret.applyRemovalPolicy(
        props.secretRemovalPolicy ??
          (effectiveRemovalPolicy === RemovalPolicy.DESTROY
            ? RemovalPolicy.DESTROY
            : RemovalPolicy.RETAIN),
      );
    }
    this.clusterIdentifier = this.cluster.clusterIdentifier;
    this.clusterResourceIdentifier = this.cluster.clusterResourceIdentifier;
    this.instanceIdentifiers = this.cluster.instanceIdentifiers;
    this.clusterEndpoint = this.cluster.clusterEndpoint;
    this.clusterReadEndpoint = this.cluster.clusterReadEndpoint;
    this.instanceEndpoints = this.cluster.instanceEndpoints;
    this.engine = this.cluster.engine;
    this.clusterArn = this.cluster.clusterArn;
    this.connections = this.cluster.connections;
    this.dbClusterRef = this.cluster.dbClusterRef;
    this.stack = this.cluster.stack;
    this.env = this.cluster.env;
  }

  /**
   * Validates the capacity range, reader count and auto-pause setting.
   *
   * @param minCapacity minimum ACUs
   * @param maxCapacity maximum ACUs
   * @param readers number of reader instances
   * @param secondsUntilAutoPause idle time before pause, if any
   */
  static validate(
    minCapacity: number,
    maxCapacity: number,
    readers: number,
    secondsUntilAutoPause?: number,
  ): void {
    const isHalfStep = (value: number) => Number.isInteger(value * 2);
    if (minCapacity < 0 || !isHalfStep(minCapacity)) {
      throw new Error(
        `minCapacity must be 0 or a positive half-step value, got ${minCapacity}`,
      );
    }
    if (
      maxCapacity <= 0.5 ||
      maxCapacity >
        StandardPostgresAuroraServerlessCluster.MAX_CAPACITY_LIMIT ||
      !isHalfStep(maxCapacity)
    ) {
      throw new Error(
        `maxCapacity must be a half-step value greater than 0.5 and at most ${StandardPostgresAuroraServerlessCluster.MAX_CAPACITY_LIMIT}, got ${maxCapacity}`,
      );
    }
    if (minCapacity > maxCapacity) {
      throw new Error(
        `minCapacity (${minCapacity}) must not exceed maxCapacity (${maxCapacity})`,
      );
    }
    if (!Number.isInteger(readers) || readers < 0) {
      throw new Error(`readers must be a non-negative integer, got ${readers}`);
    }
    if (secondsUntilAutoPause !== undefined) {
      if (minCapacity !== 0) {
        throw new Error('secondsUntilAutoPause requires minCapacity to be 0');
      }
      if (
        !Number.isInteger(secondsUntilAutoPause) ||
        secondsUntilAutoPause <
          StandardPostgresAuroraServerlessCluster.MIN_AUTO_PAUSE_SECONDS ||
        secondsUntilAutoPause >
          StandardPostgresAuroraServerlessCluster.MAX_AUTO_PAUSE_SECONDS
      ) {
        throw new Error(
          `secondsUntilAutoPause must be an integer between ${StandardPostgresAuroraServerlessCluster.MIN_AUTO_PAUSE_SECONDS} and ${StandardPostgresAuroraServerlessCluster.MAX_AUTO_PAUSE_SECONDS}, got ${secondsUntilAutoPause}`,
        );
      }
    }
  }

  // From IDatabaseCluster

  addProxy(id: string, options: DatabaseProxyOptions): DatabaseProxy {
    return this.cluster.addProxy(id, options);
  }

  grantConnect(grantee: IGrantable, dbUser: string): Grant {
    return this.cluster.grantConnect(grantee, dbUser);
  }

  grantDataApiAccess(grantee: IGrantable): Grant {
    return this.cluster.grantDataApiAccess(grantee);
  }

  // From ISecretAttachmentTarget

  asSecretAttachmentTarget(): SecretAttachmentTargetProps {
    return this.cluster.asSecretAttachmentTarget();
  }

  // From IResource

  applyRemovalPolicy(policy: RemovalPolicy): void {
    this.cluster.applyRemovalPolicy(policy);
  }

  // From IDatabaseCluster (metrics)

  metric(metricName: string, props?: MetricOptions): Metric {
    return this.cluster.metric(metricName, props);
  }

  metricCPUUtilization(props?: MetricOptions): Metric {
    return this.cluster.metricCPUUtilization(props);
  }

  metricDatabaseConnections(props?: MetricOptions): Metric {
    return this.cluster.metricDatabaseConnections(props);
  }

  metricDeadlocks(props?: MetricOptions): Metric {
    return this.cluster.metricDeadlocks(props);
  }

  metricEngineUptime(props?: MetricOptions): Metric {
    return this.cluster.metricEngineUptime(props);
  }

  metricFreeableMemory(props?: MetricOptions): Metric {
    return this.cluster.metricFreeableMemory(props);
  }

  metricFreeLocalStorage(props?: MetricOptions): Metric {
    return this.cluster.metricFreeLocalStorage(props);
  }

  metricNetworkReceiveThroughput(props?: MetricOptions): Metric {
    return this.cluster.metricNetworkReceiveThroughput(props);
  }

  metricNetworkThroughput(props?: MetricOptions): Metric {
    return this.cluster.metricNetworkThroughput(props);
  }

  metricNetworkTransmitThroughput(props?: MetricOptions): Metric {
    return this.cluster.metricNetworkTransmitThroughput(props);
  }

  metricSnapshotStorageUsed(props?: MetricOptions): Metric {
    return this.cluster.metricSnapshotStorageUsed(props);
  }

  metricTotalBackupStorageBilled(props?: MetricOptions): Metric {
    return this.cluster.metricTotalBackupStorageBilled(props);
  }

  metricVolumeBytesUsed(props?: MetricOptions): Metric {
    return this.cluster.metricVolumeBytesUsed(props);
  }

  metricVolumeReadIOPs(props?: MetricOptions): Metric {
    return this.cluster.metricVolumeReadIOPs(props);
  }

  metricVolumeWriteIOPs(props?: MetricOptions): Metric {
    return this.cluster.metricVolumeWriteIOPs(props);
  }
}
