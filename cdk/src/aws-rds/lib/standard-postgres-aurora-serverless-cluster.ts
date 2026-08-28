import type {
  AuroraPostgresEngineVersion,
  IParameterGroup,
} from 'aws-cdk-lib/aws-rds';
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
   *
   * @default 0.5
   */
  readonly minCapacity?: number;

  /**
   * The maximum number of Aurora capacity units the cluster may scale up to.
   *
   * @default 4
   */
  readonly maxCapacity?: number;

  /**
   * The time the cluster may remain idle before it is paused. Only supported
   * when minCapacity is 0.
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
}

/**
 * A standard Aurora Serverless v2 PostgreSQL database cluster.
 */
export class StandardPostgresAuroraServerlessCluster extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: StandardPostgresAuroraServerlessClusterProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    // TODO Implementation
  }
}
