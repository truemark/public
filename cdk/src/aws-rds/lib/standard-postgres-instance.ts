import type {InstanceType} from 'aws-cdk-lib/aws-ec2';
import type {
  IInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import type {Construct} from 'constructs';
import {ExtendedConstruct, StandardTags} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import type {StandardPostgresProps} from './postgres-props';

/**
 * Properties for a StandardPostgresInstance.
 */
export interface StandardPostgresInstanceProps extends StandardPostgresProps {
  /**
   * The PostgreSQL engine version to use.
   *
   * @default the latest version supported by this library
   */
  readonly engineVersion?: PostgresEngineVersion;

  /**
   * Overrides the engine used for the instance. When provided, engineVersion
   * is ignored.
   *
   * @default DatabaseInstanceEngine.postgres with engineVersion
   */
  readonly engine?: IInstanceEngine;

  /**
   * The instance type of the database instance.
   *
   * @default t4g.medium
   */
  readonly instanceType?: InstanceType;

  /**
   * The name given to the database instance.
   *
   * @default CloudFormation-generated name
   */
  readonly instanceIdentifier?: string;

  /**
   * Whether the instance is deployed in multiple availability zones.
   *
   * @default true
   */
  readonly multiAz?: boolean;

  /**
   * The storage type of the instance.
   *
   * @default StorageType.GP3
   */
  readonly storageType?: StorageType;

  /**
   * The allocated storage in gibibytes.
   *
   * @default 100
   */
  readonly allocatedStorage?: number;

  /**
   * The upper limit storage may be autoscaled to in gibibytes. Set to the same
   * value as allocatedStorage to disable storage autoscaling.
   *
   * @default 1000
   */
  readonly maxAllocatedStorage?: number;

  /**
   * The provisioned IOPS for the instance. Only applies to io1 and io2 storage
   * and to gp3 storage above the free IOPS threshold.
   *
   * @default no provisioned IOPS
   */
  readonly iops?: number;

  /**
   * The storage throughput in mebibytes per second. Only applies to gp3 storage.
   *
   * @default determined by RDS
   */
  readonly storageThroughput?: number;

  /**
   * The number of read replicas to create.
   *
   * @default 0
   */
  readonly readReplicas?: number;

  /**
   * The instance type used for read replicas.
   *
   * @default same as instanceType
   */
  readonly readReplicaInstanceType?: InstanceType;

  /**
   * Whether the instance is publicly accessible.
   *
   * @default false
   */
  readonly publiclyAccessible?: boolean;
}

/**
 * A standard PostgreSQL RDS database instance.
 */
export class StandardPostgresInstance extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: StandardPostgresInstanceProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    // TODO Implementation
  }
}
