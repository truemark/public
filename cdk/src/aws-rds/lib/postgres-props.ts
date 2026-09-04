import type {Duration, RemovalPolicy} from 'aws-cdk-lib';
import type {
  IConnectable,
  ISecurityGroup,
  IVpc,
  SubnetSelection,
} from 'aws-cdk-lib/aws-ec2';
import type {IKey} from 'aws-cdk-lib/aws-kms';
import type {RetentionDays} from 'aws-cdk-lib/aws-logs';
import type {
  CaCertificate,
  Credentials,
  IParameterGroup,
  ISubnetGroup,
  NetworkType,
  PerformanceInsightRetention,
} from 'aws-cdk-lib/aws-rds';
import type {ExtendedConstructProps} from '../../aws-cdk';

/**
 * Common properties shared by all standard PostgreSQL constructs in this module.
 */
export interface StandardPostgresProps extends ExtendedConstructProps {
  /**
   * The VPC to place the database in.
   */
  readonly vpc: IVpc;

  /**
   * The subnets to place the database in.
   *
   * @default the private isolated subnets of the VPC
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * An existing subnet group to place the database in. When provided,
   * vpcSubnets is ignored.
   *
   * @default a subnet group is created
   */
  readonly subnetGroup?: ISubnetGroup;

  /**
   * Security groups to attach to the database.
   *
   * @default a security group is created
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * Peers allowed to connect to the database on the database port.
   *
   * @default no ingress is added
   */
  readonly allowFrom?: IConnectable[];

  /**
   * The name of the database created when the instance or cluster is created.
   *
   * @default no database is created
   */
  readonly databaseName?: string;

  /**
   * Credentials for the administrative user.
   *
   * @default a secret is generated for the "postgres" user
   */
  readonly credentials?: Credentials;

  /**
   * The port the database listens on.
   *
   * @default 5432
   */
  readonly port?: number;

  /**
   * The parameter group to associate with the database.
   *
   * @default the default parameter group for the engine version
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * Parameters for a parameter group created by the construct. Cannot be
   * combined with parameterGroup: an existing group's parameters are not
   * readable, so they cannot be merged.
   *
   * @default no parameters; the engine default parameter group is used
   */
  readonly parameters?: Record<string, string>;

  /**
   * The network type of the database.
   *
   * @default NetworkType.IPV4
   */
  readonly networkType?: NetworkType;

  /**
   * The CA certificate used for the database.
   *
   * @default the RDS default for the region
   */
  readonly caCertificate?: CaCertificate;

  /**
   * Whether storage is encrypted at rest.
   *
   * @default true
   */
  readonly storageEncrypted?: boolean;

  /**
   * The KMS key used to encrypt storage at rest.
   *
   * @default the default RDS managed key
   */
  readonly storageEncryptionKey?: IKey;

  /**
   * How long automated backups are retained.
   *
   * @default Duration.days(7)
   */
  readonly backupRetention?: Duration;

  /**
   * The daily UTC time window automated backups are taken in, in the
   * format "hh24:mi-hh24:mi".
   *
   * @default a window is selected at random
   */
  readonly preferredBackupWindow?: string;

  /**
   * The weekly UTC time window maintenance is performed in, in the
   * format "ddd:hh24:mi-ddd:hh24:mi".
   *
   * @default a window is selected at random
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * Whether minor engine version upgrades are applied automatically during
   * the maintenance window.
   *
   * @default true
   */
  readonly autoMinorVersionUpgrade?: boolean;

  /**
   * Whether deletion protection is enabled.
   *
   * @default true
   */
  readonly deletionProtection?: boolean;

  /**
   * The removal policy applied to the database.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Whether a final snapshot is skipped when the database is deleted.
   *
   * @default false
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * The interval enhanced monitoring metrics are collected at.
   *
   * @default no enhanced monitoring
   */
  readonly monitoringInterval?: Duration;

  /**
   * Whether Performance Insights is enabled.
   *
   * @default false
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * How long Performance Insights data is retained.
   *
   * @default PerformanceInsightRetention.DEFAULT
   */
  readonly performanceInsightRetention?: PerformanceInsightRetention;

  /**
   * The log types exported to CloudWatch Logs.
   *
   * @default ["postgresql"]
   */
  readonly cloudwatchLogsExports?: string[];

  /**
   * How long exported logs are retained in CloudWatch Logs.
   *
   * @default RetentionDays.ONE_MONTH
   */
  readonly cloudwatchLogsRetention?: RetentionDays;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default false
   */
  readonly suppressTagging?: boolean;
}
