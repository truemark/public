import type {InstanceType} from 'aws-cdk-lib/aws-ec2';
import type {
  AuroraPostgresEngineVersion,
  IParameterGroup,
} from 'aws-cdk-lib/aws-rds';
import type {Construct} from 'constructs';
import {ExtendedConstruct, StandardTags} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import type {StandardPostgresProps} from './postgres-props';

/**
 * Properties for a StandardPostgresAuroraCluster.
 */
export interface StandardPostgresAuroraClusterProps
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
   * The instance type of the writer instance.
   *
   * @default t4g.medium
   */
  readonly writerInstanceType?: InstanceType;

  /**
   * The instance type of the reader instances.
   *
   * @default same as writerInstanceType
   */
  readonly readerInstanceType?: InstanceType;

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
   * The number of days automated cluster snapshots are retained in the backtrack
   * window. Set to 0 to disable backtrack.
   *
   * @default 0
   */
  readonly backtrackWindowDays?: number;

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
}

/**
 * A standard provisioned Aurora PostgreSQL database cluster.
 */
export class StandardPostgresAuroraCluster extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: StandardPostgresAuroraClusterProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    // TODO Implementation
  }
}
