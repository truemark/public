import type {InstanceType} from 'aws-cdk-lib/aws-ec2';
import type {
  DBClusterStorageType,
  PostgresEngineVersion,
} from 'aws-cdk-lib/aws-rds';
import type {Construct} from 'constructs';
import {ExtendedConstruct, StandardTags} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import type {StandardPostgresProps} from './postgres-props';

/**
 * Properties for a StandardPostgresCluster.
 */
export interface StandardPostgresClusterProps extends StandardPostgresProps {
  /**
   * The PostgreSQL engine version to use.
   *
   * @default the latest version supported by this library
   */
  readonly engineVersion?: PostgresEngineVersion;

  /**
   * The name given to the cluster.
   *
   * @default CloudFormation-generated name
   */
  readonly clusterIdentifier?: string;

  /**
   * The instance type used for the writer and reader instances.
   *
   * @default m5d.large
   */
  readonly instanceType?: InstanceType;

  /**
   * The number of instances in the cluster. A Multi-AZ DB cluster requires one
   * writer and two readers.
   *
   * @default 3
   */
  readonly instances?: number;

  /**
   * The storage type of the cluster.
   *
   * @default DBClusterStorageType.IO1
   */
  readonly storageType?: DBClusterStorageType;

  /**
   * The allocated storage in gibibytes.
   *
   * @default 100
   */
  readonly allocatedStorage?: number;

  /**
   * The provisioned IOPS for the cluster.
   *
   * @default 1000
   */
  readonly iops?: number;

  /**
   * Additional parameters applied to the instance-level parameter group. Distinct
   * from the cluster-level parameterGroup/parameters.
   *
   * @default no additional parameters
   */
  readonly instanceParameterGroupParameters?: Record<string, string>;

  /**
   * Whether the instances in the cluster are publicly accessible.
   *
   * @default false
   */
  readonly publiclyAccessible?: boolean;
}

/**
 * A standard PostgreSQL Multi-AZ RDS database cluster.
 */
export class StandardPostgresCluster extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: StandardPostgresClusterProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    // TODO Implementation
  }
}
