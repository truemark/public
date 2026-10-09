import {RemovalPolicy, Stack} from 'aws-cdk-lib';
import {
  CfnServiceLinkedRole,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
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

  /**
   * The ARN of the customer-managed KMS key encrypting the source
   * (originating-Region) Security Lake bucket. Required when the enclosing
   * `StandardSecurityLake` is configured with a customer-managed KMS key via
   * `kmsKeyId` and this construct creates the replication role (i.e. when
   * `roleArn` is not provided); S3 needs `kms:Decrypt` on this key to read
   * objects before replicating them. Not required when `kmsKeyId` is unset
   * or set to `S3_MANAGED_KEY`.
   *
   * @default - no KMS decrypt statement is added (sufficient when the data
   *   lake uses S3-managed or AWS-managed encryption)
   */
  readonly sourceKmsKeyArn?: string;

  /**
   * The ARNs of the customer-managed KMS keys encrypting the destination
   * (rollup-Region) Security Lake buckets. Required when the enclosing
   * `StandardSecurityLake` is configured with a customer-managed KMS key via
   * `kmsKeyId` and this construct creates the replication role; S3 needs
   * `kms:Encrypt` / `kms:GenerateDataKey` on these keys to write replicated
   * objects. Not required when `kmsKeyId` is unset or set to
   * `S3_MANAGED_KEY`.
   *
   * @default - no KMS encrypt statement is added
   */
  readonly destinationKmsKeyArns?: string[];
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
   * The ARN of the customer-managed KMS key used to encrypt Security Lake
   * data. Required when `kmsKeyId` is set to a customer-managed key and this
   * construct creates the metastore manager role (i.e. when
   * `metaStoreManagerRoleArn` is not provided). The metastore manager
   * Lambda must decrypt and (re)encrypt Security Lake metadata; the AWS
   * managed policy `AmazonSecurityLakeMetastoreManager` does not include
   * KMS permissions, so without this grant the stack deploys but partition
   * updates and subscriber queries silently fail. Not required when
   * `kmsKeyId` is unset or set to `S3_MANAGED_KEY`.
   *
   * @default - no KMS statement is added (sufficient when the data lake
   * uses Security Lake defaults or SSE-S3)
   */
  readonly metaStoreManagerKmsKeyArn?: string;

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
      // The Lake Formation SLR is an account singleton that is frequently
      // shared with other stacks and consoles. Retain it on
      // stack-delete/opt-out so toggling this flag off (or removing this
      // construct) does not strip Lake Formation access account-wide.
      this.lakeFormationServiceLinkedRole.applyRemovalPolicy(
        RemovalPolicy.RETAIN,
      );
    }

    // Metastore manager role.
    let metaStoreManagerRoleArn = props?.metaStoreManagerRoleArn;
    const usesCustomerManagedKey =
      props?.kmsKeyId !== undefined && props.kmsKeyId !== 'S3_MANAGED_KEY';
    if (!metaStoreManagerRoleArn) {
      // When the data lake is encrypted with a customer-managed KMS key,
      // the metastore manager Lambda must be able to Decrypt / Encrypt /
      // GenerateDataKey against that key. The AWS managed policy
      // `AmazonSecurityLakeMetastoreManager` does NOT include KMS actions,
      // so without this grant CFN deployment succeeds but partition
      // updates and subscriber queries fail at runtime. The key ARN is
      // not derivable at synth time, so require the caller to supply it
      // explicitly via `metaStoreManagerKmsKeyArn` or pre-provision their
      // own metastore manager role via `metaStoreManagerRoleArn`.
      if (usesCustomerManagedKey && !props?.metaStoreManagerKmsKeyArn) {
        throw new Error(
          'StandardSecurityLake: a customer-managed `kmsKeyId` requires ' +
            '`metaStoreManagerKmsKeyArn` so the generated metastore manager ' +
            'role can be granted the necessary KMS permissions. ' +
            'Alternatively, pre-provision the metastore manager role ' +
            'yourself and pass its ARN via `metaStoreManagerRoleArn`.',
        );
      }
      const metaStoreInlinePolicies: {[name: string]: PolicyDocument} = {};
      if (usesCustomerManagedKey && props?.metaStoreManagerKmsKeyArn) {
        metaStoreInlinePolicies.AmazonSecurityLakeMetastoreManagerKmsPolicy =
          new PolicyDocument({
            statements: [
              new PolicyStatement({
                sid: 'AllowMetaStoreManagerKmsAccess',
                actions: [
                  'kms:Decrypt',
                  'kms:Encrypt',
                  'kms:GenerateDataKey',
                  'kms:DescribeKey',
                ],
                resources: [props.metaStoreManagerKmsKeyArn],
              }),
            ],
          });
      }
      this.metaStoreManagerRole = new Role(this, 'MetaStoreManagerRole', {
        // The partition-updater Lambda functions created by Security Lake are
        // hard-coded to assume a role named
        // `AmazonSecurityLakeMetaStoreManagerV2` under the `/service-role/`
        // path and do not honor an arbitrary role ARN. Without a matching
        // role name, CFN deployment and `CreateDataLake` succeed but the
        // partition updater silently fails and subscribers cannot query
        // replicated objects. The role name is account-global; for
        // multi-Region deploys in the same account pass
        // `metaStoreManagerRoleArn` for all but one Region.
        path: '/service-role/',
        roleName: 'AmazonSecurityLakeMetaStoreManagerV2',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        description:
          'Role used by Amazon Security Lake metastore manager Lambda to manage the AWS Glue metastore.',
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonSecurityLakeMetastoreManager',
          ),
        ],
        inlinePolicies: metaStoreInlinePolicies,
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
        const account = Stack.of(this).account;
        const sourceRegion = Stack.of(this).region;
        const destinationRegions = props.replication.regions;

        // When the data lake is encrypted with a customer-managed KMS key
        // (anything other than Security Lake defaults or SSE-S3), the
        // replication role must also be allowed to Decrypt the source key
        // and Encrypt/GenerateDataKey against each destination key. The key
        // ARNs are not derivable at synth time, so require the caller to
        // supply them explicitly or pre-provision their own replication
        // role via `replication.roleArn`.
        if (
          usesCustomerManagedKey &&
          (!props.replication.sourceKmsKeyArn ||
            !props.replication.destinationKmsKeyArns ||
            props.replication.destinationKmsKeyArns.length === 0)
        ) {
          throw new Error(
            'StandardSecurityLake: replication with a customer-managed `kmsKeyId` ' +
              'requires both `replication.sourceKmsKeyArn` and ' +
              '`replication.destinationKmsKeyArns` so the generated replication ' +
              'role can be granted the necessary KMS permissions. Alternatively, ' +
              'pre-provision the replication role yourself and pass its ARN via ' +
              '`replication.roleArn`.',
          );
        }

        const kmsStatements: PolicyStatement[] = [];
        if (
          usesCustomerManagedKey &&
          props.replication.sourceKmsKeyArn &&
          props.replication.destinationKmsKeyArns
        ) {
          kmsStatements.push(
            new PolicyStatement({
              sid: 'AllowDecryptSourceKmsKey',
              actions: ['kms:Decrypt'],
              resources: [props.replication.sourceKmsKeyArn],
            }),
            new PolicyStatement({
              sid: 'AllowEncryptDestinationKmsKeys',
              actions: ['kms:Encrypt', 'kms:GenerateDataKey'],
              resources: props.replication.destinationKmsKeyArns,
            }),
          );
        }

        this.replicationRole = new Role(this, 'ReplicationRole', {
          // Security Lake requires the replication role to live under the
          // service-role/ path and start with `SecurityLake`. IAM role names
          // are account-global, so include the source Region in the suffix to
          // avoid collisions when the construct is deployed to multiple
          // Regions in the same account.
          path: '/service-role/',
          roleName: `SecurityLakeS3ReplicationRole-${sourceRegion}`,
          // Amazon S3 performs the cross-Region replication, so it (not the
          // Security Lake service) must be allowed to assume this role.
          assumedBy: new ServicePrincipal('s3.amazonaws.com'),
          description:
            'Role used by Amazon S3 to replicate Amazon Security Lake objects across Regions.',
          // No AWS managed policy exists for this role; attach the inline
          // policy documented by Security Lake.
          // https://docs.aws.amazon.com/security-lake/latest/userguide/add-rollup-region.html
          inlinePolicies: {
            AmazonSecurityLakeS3ReplicationRolePolicy: new PolicyDocument({
              statements: [
                new PolicyStatement({
                  sid: 'AllowReadS3ReplicationSetting',
                  actions: [
                    's3:ListBucket',
                    's3:GetReplicationConfiguration',
                    's3:GetObjectVersionForReplication',
                    's3:GetObjectVersion',
                    's3:GetObjectVersionAcl',
                    's3:GetObjectVersionTagging',
                    's3:GetObjectRetention',
                    's3:GetObjectLegalHold',
                  ],
                  resources: [
                    `arn:${Stack.of(this).partition}:s3:::aws-security-data-lake-${sourceRegion}*`,
                    `arn:${Stack.of(this).partition}:s3:::aws-security-data-lake-${sourceRegion}*/*`,
                  ],
                  conditions: {
                    StringEquals: {'s3:ResourceAccount': [account]},
                  },
                }),
                new PolicyStatement({
                  sid: 'AllowS3Replication',
                  actions: [
                    's3:ReplicateObject',
                    's3:ReplicateDelete',
                    's3:ReplicateTags',
                    's3:GetObjectVersionTagging',
                  ],
                  resources: destinationRegions.flatMap((r) => [
                    `arn:${Stack.of(this).partition}:s3:::aws-security-data-lake-${r}*/*`,
                  ]),
                  conditions: {
                    StringEquals: {'s3:ResourceAccount': [account]},
                  },
                }),
                ...kmsStatements,
              ],
            }),
          },
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
          accounts: source.accounts ?? [Stack.of(this).account],
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
