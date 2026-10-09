import {
  CfnServiceLinkedRole,
  ManagedPolicy,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {CfnAwsLogSource, CfnDataLake} from 'aws-cdk-lib/aws-securitylake';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
} from '../../aws-cdk/index';

/**
 * The AWS-native log sources that Amazon Security Lake can ingest.
 *
 * @see https://docs.aws.amazon.com/security-lake/latest/userguide/internal-sources.html
 */
export enum AwsLogSourceName {
  CLOUD_TRAIL_MGMT = 'CLOUD_TRAIL_MGMT',
  LAMBDA_EXECUTION = 'LAMBDA_EXECUTION',
  ROUTE53 = 'ROUTE53',
  S3_DATA = 'S3_DATA',
  SH_FINDINGS = 'SH_FINDINGS',
  VPC_FLOW = 'VPC_FLOW',
  EKS_AUDIT = 'EKS_AUDIT',
  WAF = 'WAF',
}

/**
 * Properties for an individual AWS log source to enable on the data lake.
 */
export interface AwsLogSourceProps {
  /**
   * The name of the AWS log source to enable.
   */
  readonly sourceName: AwsLogSourceName | string;

  /**
   * The version of the AWS log source to enable.
   *
   * @default - '2.0'
   */
  readonly sourceVersion?: string;

  /**
   * The AWS accounts whose data should be collected for this source. If not
   * provided, the data lake owner account is used.
   *
   * @default - [Stack.of(this).account]
   */
  readonly accounts?: string[];
}

/**
 * Lifecycle transition for Security Lake data.
 */
export interface SecurityLakeTransitionProps {
  /**
   * The number of days before data transitions to the given storage class.
   */
  readonly days: number;

  /**
   * The target S3 storage class. Supported values include `STANDARD_IA`,
   * `ONEZONE_IA`, `INTELLIGENT_TIERING`, `GLACIER_IR`, `GLACIER` and
   * `DEEP_ARCHIVE`.
   */
  readonly storageClass: string;
}

/**
 * Lifecycle configuration options for Security Lake managed S3 storage.
 */
export interface SecurityLakeLifecycleProps {
  /**
   * The number of days before Security Lake data is expired/deleted.
   *
   * @default - data is retained indefinitely
   */
  readonly expirationDays?: number;

  /**
   * Transitions applied to Security Lake data.
   *
   * @default - no transitions
   */
  readonly transitions?: SecurityLakeTransitionProps[];
}

/**
 * Replication configuration for Security Lake data.
 */
export interface SecurityLakeReplicationProps {
  /**
   * One or more rollup Regions to replicate data to.
   */
  readonly regions: string[];

  /**
   * The ARN of the IAM role Security Lake uses to replicate objects. If not
   * provided, a role will be created automatically.
   *
   * @default - a new role is created
   */
  readonly roleArn?: string;
}

/**
 * Properties for StandardSecurityLake.
 */
export interface StandardSecurityLakeProps extends ExtendedConstructProps {
  /**
   * The KMS key id to use to encrypt data stored by Security Lake. Use the
   * literal string `S3_MANAGED_KEY` to use S3 managed keys (SSE-S3). Omit to
   * let Security Lake use its default managed key.
   *
   * @default - Security Lake managed encryption
   */
  readonly kmsKeyId?: string;

  /**
   * The ARN of the role used by Security Lake to manage the AWS Glue
   * metastore. If omitted, a role is created with the
   * `AmazonSecurityLakeMetastoreManager` AWS managed policy attached.
   *
   * @default - a role is created
   */
  readonly metaStoreManagerRoleArn?: string;

  /**
   * Lifecycle configuration for the Security Lake managed S3 storage.
   *
   * @default - Security Lake defaults
   */
  readonly lifecycle?: SecurityLakeLifecycleProps;

  /**
   * Replication configuration for the Security Lake managed S3 storage.
   *
   * @default - no replication
   */
  readonly replication?: SecurityLakeReplicationProps;

  /**
   * The AWS native log sources to enable on the data lake. Sources are
   * created sequentially using `DependsOn` as required by Security Lake.
   *
   * @default - no log sources are enabled
   */
  readonly logSources?: AwsLogSourceProps[];

  /**
   * Whether to create the `AWSServiceRoleForLakeFormationDataAccess`
   * service-linked role. Security Lake requires this role to exist in the
   * account before a data lake can be created; however the role is a
   * singleton per account and is frequently auto-created on first use of
   * Lake Formation. Enable this only when you know the role does not yet
   * exist in the account, otherwise stack creation will fail with
   * `has been taken in this account`.
   *
   * The data lake will `DependsOn` this role when it is created so ordering
   * is handled automatically.
   *
   * @default false
   */
  readonly createLakeFormationServiceLinkedRole?: boolean;
}

/**
 * Standard Amazon Security Lake. Wraps the Security Lake L1 constructs to
 * stand up a data lake with an optional set of AWS native log sources
 * enabled, a metastore manager role, lifecycle policy and replication.
 *
 * Where this construct does not meet your needs, use the underlying
 * `CfnDataLake` and `CfnAwsLogSource` constructs directly.
 */
export class StandardSecurityLake extends ExtendedConstruct {
  /**
   * The underlying `CfnDataLake` resource.
   */
  readonly dataLake: CfnDataLake;

  /**
   * The IAM role used by Security Lake to manage the Glue metastore. When
   * `metaStoreManagerRoleArn` is provided this will be `undefined`.
   */
  readonly metaStoreManagerRole?: Role;

  /**
   * The IAM role used by Security Lake to replicate objects. Only created
   * when replication is enabled and no `roleArn` was supplied.
   */
  readonly replicationRole?: Role;

  /**
   * The Lake Formation `AWSServiceRoleForLakeFormationDataAccess`
   * service-linked role, when it was provisioned by this construct.
   */
  readonly lakeFormationServiceLinkedRole?: CfnServiceLinkedRole;

  /**
   * The `CfnAwsLogSource` resources created by this construct, in the order
   * they were declared.
   */
  readonly logSources: CfnAwsLogSource[] = [];

  constructor(scope: Construct, id: string, props?: StandardSecurityLakeProps) {
    super(scope, id, props);

    // Optional Lake Formation service-linked role. Security Lake requires
    // this SLR to exist in the account before a data lake can be created.
    if (props?.createLakeFormationServiceLinkedRole) {
      this.lakeFormationServiceLinkedRole = new CfnServiceLinkedRole(
        this,
        'LakeFormationServiceLinkedRole',
        {
          awsServiceName: 'lakeformation.amazonaws.com',
          description:
            'Service-linked role used by AWS Lake Formation to access registered S3 locations. Required by Amazon Security Lake.',
        },
      );
    }

    // Metastore manager role.
    let metaStoreManagerRoleArn = props?.metaStoreManagerRoleArn;
    if (!metaStoreManagerRoleArn) {
      this.metaStoreManagerRole = new Role(this, 'MetaStoreManagerRole', {
        assumedBy: new ServicePrincipal('securitylake.amazonaws.com'),
        description:
          'Role used by Amazon Security Lake to manage the AWS Glue metastore.',
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonSecurityLakeMetastoreManager',
          ),
        ],
      });
      metaStoreManagerRoleArn = this.metaStoreManagerRole.roleArn;
    }

    // Encryption configuration.
    const encryptionConfiguration:
      | CfnDataLake.EncryptionConfigurationProperty
      | undefined =
      props?.kmsKeyId !== undefined ? {kmsKeyId: props.kmsKeyId} : undefined;

    // Lifecycle configuration.
    let lifecycleConfiguration:
      | CfnDataLake.LifecycleConfigurationProperty
      | undefined;
    if (props?.lifecycle) {
      lifecycleConfiguration = {
        expiration:
          props.lifecycle.expirationDays !== undefined
            ? {days: props.lifecycle.expirationDays}
            : undefined,
        transitions: props.lifecycle.transitions?.map((t) => ({
          days: t.days,
          storageClass: t.storageClass,
        })),
      };
    }

    // Replication configuration.
    let replicationConfiguration:
      | CfnDataLake.ReplicationConfigurationProperty
      | undefined;
    if (props?.replication) {
      let replicationRoleArn = props.replication.roleArn;
      if (!replicationRoleArn) {
        this.replicationRole = new Role(this, 'ReplicationRole', {
          assumedBy: new ServicePrincipal('securitylake.amazonaws.com'),
          description:
            'Role used by Amazon Security Lake to replicate objects across Regions.',
          managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName(
              'AmazonSecurityLakeS3ReplicationRolePolicy',
            ),
          ],
        });
        replicationRoleArn = this.replicationRole.roleArn;
      }
      replicationConfiguration = {
        regions: props.replication.regions,
        roleArn: replicationRoleArn,
      };
    }

    this.dataLake = new CfnDataLake(this, 'DataLake', {
      metaStoreManagerRoleArn,
      encryptionConfiguration,
      lifecycleConfiguration,
      replicationConfiguration,
    });
    if (this.lakeFormationServiceLinkedRole) {
      this.dataLake.addDependency(this.lakeFormationServiceLinkedRole);
    }

    // Create AWS log sources sequentially using DependsOn, as required by
    // Security Lake when more than one source is created in the same
    // template.
    let previous: CfnAwsLogSource | undefined;
    for (const source of props?.logSources ?? []) {
      const logSource = new CfnAwsLogSource(
        this,
        `LogSource${source.sourceName}`,
        {
          dataLakeArn: this.dataLake.attrArn,
          sourceName: source.sourceName,
          sourceVersion: source.sourceVersion ?? '2.0',
          accounts: source.accounts,
        },
      );
      logSource.addDependency(this.dataLake);
      if (previous) {
        logSource.addDependency(previous);
      }
      previous = logSource;
      this.logSources.push(logSource);
    }
  }
}
