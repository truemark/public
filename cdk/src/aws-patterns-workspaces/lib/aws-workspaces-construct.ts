import * as fs from 'node:fs';
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  type SecretValue,
  Stack,
} from 'aws-cdk-lib';
import * as directoryservice from 'aws-cdk-lib/aws-directoryservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Networking configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesNetworkingProps {
  /**
   * Existing VPC ID. If omitted, a new VPC is created.
   */
  readonly existingVpcId?: string;

  /**
   * Subnet IDs within an existing VPC. Falls back to the VPC's private subnets if omitted.
   * Only used when existingVpcId is provided.
   */
  readonly existingSubnetIds?: string[];

  /**
   * CIDR block for the new VPC. Only used when creating a new VPC.
   *
   * @default '10.0.0.0/16'
   */
  readonly vpcCidr?: string;

  /**
   * Availability zones for the new VPC's subnets. WorkSpaces requires at least 2 AZs.
   * Only used when creating a new VPC.
   *
   * @default ['<region>a', '<region>b']
   */
  readonly availabilityZones?: string[];
}

/**
 * Directory configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesDirectoryProps {
  /**
   * Existing directory ID. If provided, no new directory is created.
   */
  readonly existingDirectoryId?: string;

  /**
   * Whether to create an AWS Managed Microsoft AD.
   * Only used when existingDirectoryId is not provided.
   *
   * @default false
   */
  readonly createManagedAd?: boolean;

  /**
   * Domain name for the Managed AD. Required when createManagedAd is true.
   * Example: 'corp.example.com'
   */
  readonly adDomainName?: string;

  /**
   * Short NetBIOS name for the Managed AD domain.
   * Example: 'CORP'
   */
  readonly adShortName?: string;

  /**
   * Admin password for the Managed AD. Should come from Secrets Manager.
   * Required when createManagedAd is true.
   */
  readonly adAdminPassword?: SecretValue;
}

/**
 * Logging configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesLoggingProps {
  /**
   * Enable CloudWatch log group for WorkSpaces events.
   *
   * @default true
   */
  readonly enableCloudWatchLogs?: boolean;

  /**
   * Enable VPC flow logs. Only applies when the construct creates a new VPC.
   *
   * @default true
   */
  readonly enableFlowLogs?: boolean;

  /**
   * Retention period for logs in days.
   *
   * @default 90
   */
  readonly retentionDays?: number;
}

/**
 * Storage configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesStorageProps {
  /**
   * Custom name for the HIPAA storage bucket. Only used when creating a new bucket.
   */
  readonly bucketName?: string;

  /**
   * Import an existing S3 bucket by name instead of creating a new one.
   * When provided, bucketName is ignored.
   */
  readonly existingBucketName?: string;

  /**
   * Custom name for the access log bucket. Only used when creating a new bucket.
   */
  readonly accessLogBucketName?: string;

  /**
   * Import an existing access log bucket by name instead of creating a new one.
   * When provided, accessLogBucketName is ignored.
   */
  readonly existingAccessLogBucketName?: string;
}

/**
 * SSM package installation configuration. Provide either a script file path or a package
 * list. Only creates an SSM Association when at least one is supplied.
 * Uses the AWS-managed AWS-RunShellScript document.
 */
export interface AwsWorkspacesPackagesProps {
  /**
   * Absolute path to a shell script file to run via State Manager.
   * The file is read at CDK synth time and its contents are passed to AWS-RunShellScript.
   * Use path.join(__dirname, '../scripts/my-install.sh') to resolve relative to your stack.
   * When provided, packages is ignored.
   */
  readonly scriptPath?: string;

  /**
   * OS packages to install via the system package manager (dnf/yum).
   * Generates a simple `dnf install -y <packages> || yum install -y <packages>` command.
   * Ignored when scriptPath is provided.
   */
  readonly packages?: string[];
}

/**
 * Infrastructure configuration for AwsWorkspaces — directory registration, SSM patch
 * management, SSH hardening, golden image activation, and optional package installation.
 */
export interface AwsWorkspacesInfrastructureProps {
  /**
   * Set to true if workspaces_DefaultRole already exists in the account.
   * The role will be imported rather than created, avoiding a conflict.
   * Ensure the pre-existing role has AmazonWorkSpacesServiceAccess,
   * AmazonWorkSpacesSelfServiceAccess, AmazonSSMManagedInstanceCore,
   * and KMS permissions for the stack's encryption key.
   *
   * @default false
   */
  readonly workspacesDefaultRoleExists?: boolean;

  /**
   * Operating system for the SSM Patch Baseline. Valid values include:
   * AMAZON_LINUX_2023, UBUNTU, ROCKY_LINUX, REDHAT_ENTERPRISE_LINUX, DEBIAN, etc.
   *
   * @default 'AMAZON_LINUX_2023'
   */
  readonly operatingSystem?: string;

  /**
   * OS package installation via State Manager Association.
   * Only created when packages is provided and the list is non-empty.
   */
  readonly packages?: AwsWorkspacesPackagesProps;

  /**
   * RADIUS-based MFA configuration. When provided, enables multi-factor authentication
   * on the WorkSpaces directory. Requires a RADIUS server reachable from the directory VPC.
   */
  readonly mfa?: AwsWorkspacesMfaProps;
}

/**
 * RADIUS-based MFA configuration for AwsWorkspaces.
 * Enables multi-factor authentication on the WorkSpaces directory via a RADIUS server.
 * The RADIUS server must be reachable from the directory's VPC before this is applied.
 */
export interface AwsWorkspacesMfaProps {
  /**
   * IP addresses or DNS names of the RADIUS server(s).
   * Provide two entries for redundancy.
   */
  readonly radiusServers: string[];

  /**
   * UDP port for RADIUS authentication requests.
   *
   * @default 1812
   */
  readonly radiusPort?: number;

  /**
   * Timeout in seconds for each RADIUS request.
   *
   * @default 20
   */
  readonly radiusTimeout?: number;

  /**
   * Number of times a RADIUS request is retried after a timeout.
   *
   * @default 0
   */
  readonly radiusRetries?: number;

  /**
   * RADIUS authentication protocol.
   *
   * @default 'MS-CHAPv2'
   */
  readonly authenticationProtocol?: 'PAP' | 'CHAP' | 'MS-CHAPv1' | 'MS-CHAPv2';

  /**
   * Text label shown to users when prompted for their MFA token.
   *
   * @default 'MFA'
   */
  readonly displayLabel?: string;

  /**
   * Shared secret between the directory and the RADIUS server.
   * Use SecretValue.secretsManager() or SecretValue.ssmSecure() — do not use unsafePlainText.
   */
  readonly sharedSecret: SecretValue;

  /**
   * Whether to pass the same username to the RADIUS server as used for directory authentication.
   * Set to false when the RADIUS server expects a different username format.
   *
   * @default false
   */
  readonly useSameUsername?: boolean;
}

/**
 * Encryption configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesEncryptionProps {
  /**
   * Import an existing KMS key by ARN instead of creating a new one.
   * The existing key's policy must already allow CloudWatch Logs, VPC Flow Logs,
   * S3, and WorkSpaces service principals as required by the environment.
   * Use when migrating from an existing deployment that already owns the key.
   */
  readonly existingKeyArn?: string;
}

/**
 * Properties for AwsWorkspaces.
 */
export interface AwsWorkspacesProps extends ExtendedConstructProps {
  /**
   * Networking configuration. A new isolated VPC is created when omitted.
   */
  readonly networking?: AwsWorkspacesNetworkingProps;

  /**
   * Directory configuration. Provide an existing directory or create a Managed AD.
   */
  readonly directory: AwsWorkspacesDirectoryProps;

  /**
   * Logging configuration.
   */
  readonly logging?: AwsWorkspacesLoggingProps;

  /**
   * Storage configuration.
   */
  readonly storage?: AwsWorkspacesStorageProps;

  /**
   * Encryption configuration. A new HIPAA-compliant KMS key is created when omitted.
   */
  readonly encryption?: AwsWorkspacesEncryptionProps;

  /**
   * Infrastructure configuration. When provided, enables directory registration,
   * SSM patch baseline, SSH hardening, SSM hybrid activation for golden images,
   * and optional package installation.
   */
  readonly infrastructure?: AwsWorkspacesInfrastructureProps;
}

function mapRetentionDays(days: number): logs.RetentionDays {
  if (days <= 1) return logs.RetentionDays.ONE_DAY;
  if (days <= 3) return logs.RetentionDays.THREE_DAYS;
  if (days <= 5) return logs.RetentionDays.FIVE_DAYS;
  if (days <= 7) return logs.RetentionDays.ONE_WEEK;
  if (days <= 14) return logs.RetentionDays.TWO_WEEKS;
  if (days <= 30) return logs.RetentionDays.ONE_MONTH;
  if (days <= 60) return logs.RetentionDays.TWO_MONTHS;
  if (days <= 90) return logs.RetentionDays.THREE_MONTHS;
  if (days <= 120) return logs.RetentionDays.FOUR_MONTHS;
  if (days <= 150) return logs.RetentionDays.FIVE_MONTHS;
  if (days <= 180) return logs.RetentionDays.SIX_MONTHS;
  if (days <= 365) return logs.RetentionDays.ONE_YEAR;
  if (days <= 400) return logs.RetentionDays.THIRTEEN_MONTHS;
  if (days <= 545) return logs.RetentionDays.EIGHTEEN_MONTHS;
  if (days <= 731) return logs.RetentionDays.TWO_YEARS;
  if (days <= 1827) return logs.RetentionDays.FIVE_YEARS;
  if (days <= 2557) return logs.RetentionDays.SEVEN_YEARS;
  if (days <= 3653) return logs.RetentionDays.TEN_YEARS;
  return logs.RetentionDays.INFINITE;
}

/**
 * Deploys HIPAA-compliant AWS WorkSpaces infrastructure: isolated VPC (or existing), KMS
 * encryption, CloudWatch and VPC flow logging, WORM-protected S3 storage, AWS Managed AD
 * or existing directory, and an optional infrastructure layer that registers the directory
 * with WorkSpaces, manages SSM patch compliance, hardens WorkSpaces security groups, and
 * provisions golden-image SSM hybrid activation credentials.
 *
 * Use AwsWorkspacesUser to create individual WorkSpaces that reference this foundation.
 *
 * NOTE: This construct creates an IAM role named 'workspaces_DefaultRole'. This name is
 * account-global and required by WorkSpaces. Deploying into an account that already has
 * this role will fail unless infrastructure.workspacesDefaultRoleExists is set to true.
 */
export class AwsWorkspaces extends ExtendedConstruct {
  static readonly DEFAULT_PATCH_OS = 'AMAZON_LINUX_2023';

  readonly vpc: ec2.IVpc;
  readonly privateSubnets: ec2.ISubnet[];
  readonly encryptionKey: kms.IKey;
  readonly bucket: s3.IBucket;
  readonly accessLogBucket: s3.IBucket;
  readonly directoryId: string;
  readonly workspacesRole: iam.IRole;
  /** Patch group name for tagging AwsWorkspacesUser instances. */
  readonly patchGroupName: string;
  /** Parameter Store path prefix for SSM hybrid activation credentials. */
  readonly ssmActivationParamPrefix: string;
  /**
   * IAM role assigned to WorkSpaces registered via SSM hybrid activation.
   * Only set when infrastructure props are provided.
   * Callers may attach managed policies to grant additional permissions required by
   * State Manager associations running on hybrid-activated WorkSpaces (e.g. S3 downloads,
   * SSM Parameter Store reads for third-party agent installation scripts).
   */
  readonly ssmHybridActivationRole?: iam.Role;

  constructor(scope: Construct, id: string, props: AwsWorkspacesProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const stack = Stack.of(this);
    this.patchGroupName = `${stack.stackName}-workspaces`;
    this.ssmActivationParamPrefix = `/workspaces/${stack.stackName}/ssm-activation`;

    // KMS key — import existing or create new with CloudWatch Logs + VPC Flow Logs permissions.
    // When importing, the existing key policy must already allow the necessary service principals.
    let key: kms.IKey;
    if (props.encryption?.existingKeyArn) {
      key = kms.Key.fromKeyArn(this, 'Key', props.encryption.existingKeyArn);
    } else {
      key = new kms.Key(this, 'Key', {
        enableKeyRotation: true,
        alias: `${stack.stackName}-workspace-encryption`,
        description: 'KMS key for WorkSpaces environment encryption',
        removalPolicy: RemovalPolicy.DESTROY,
        policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowRootAccess',
              effect: iam.Effect.ALLOW,
              principals: [new iam.AccountRootPrincipal()],
              actions: ['kms:*'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              sid: 'AllowCloudWatchLogs',
              effect: iam.Effect.ALLOW,
              principals: [
                new iam.ServicePrincipal(`logs.${stack.region}.amazonaws.com`),
              ],
              actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey*',
                'kms:DescribeKey',
              ],
              resources: ['*'],
              conditions: {
                ArnLike: {
                  'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${stack.region}:${stack.account}:*`,
                },
              },
            }),
            new iam.PolicyStatement({
              sid: 'AllowVPCFlowLogs',
              effect: iam.Effect.ALLOW,
              principals: [
                new iam.ServicePrincipal('delivery.logs.amazonaws.com'),
              ],
              actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey*',
                'kms:DescribeKey',
              ],
              resources: ['*'],
            }),
          ],
        }),
      });
    }
    this.encryptionKey = key;

    // Networking — create isolated VPC or import existing
    const networking = props.networking;
    let isNewVpc = false;
    if (networking?.existingVpcId) {
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
        vpcId: networking.existingVpcId,
      });
      if (
        networking.existingSubnetIds &&
        networking.existingSubnetIds.length >= 2
      ) {
        this.privateSubnets = networking.existingSubnetIds.map(
          (subnetId, index) =>
            ec2.Subnet.fromSubnetId(this, `Subnet${index}`, subnetId),
        );
      } else {
        this.privateSubnets = this.vpc.privateSubnets;
      }
    } else {
      isNewVpc = true;
      const vpcCidr = networking?.vpcCidr ?? '10.0.0.0/16';
      const availabilityZones = networking?.availabilityZones ?? [
        `${stack.region}a`,
        `${stack.region}b`,
      ];
      const vpc = new ec2.Vpc(this, 'Vpc', {
        ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
        availabilityZones,
        natGateways: 0,
        subnetConfiguration: [
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
          },
        ],
        enableDnsHostnames: true,
        enableDnsSupport: true,
      });
      this.vpc = vpc;
      this.privateSubnets = vpc.isolatedSubnets;
    }

    // Logging — CloudWatch log groups and, for new VPCs, dual-destination flow logs
    const enableCloudWatchLogs = props.logging?.enableCloudWatchLogs ?? true;
    const enableFlowLogs = props.logging?.enableFlowLogs ?? true;
    const logRetention = mapRetentionDays(props.logging?.retentionDays ?? 90);

    if (isNewVpc && enableFlowLogs) {
      const flowLogGroup = new logs.LogGroup(this, 'FlowLogGroup', {
        logGroupName: `/aws/vpc/flowlogs/${stack.stackName}`,
        retention: logRetention,
        encryptionKey: key,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      const flowLogBucket = new s3.Bucket(this, 'FlowLogBucket', {
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: key,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        lifecycleRules: [
          {
            id: 'TransitionToIA',
            transitions: [
              {
                storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                transitionAfter: Duration.days(90),
              },
              {
                storageClass: s3.StorageClass.GLACIER,
                transitionAfter: Duration.days(365),
              },
            ],
          },
        ],
      });

      const flowLogRole = new iam.Role(this, 'FlowLogRole', {
        assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      });
      flowLogGroup.grantWrite(flowLogRole);

      new ec2.FlowLog(this, 'FlowLogCW', {
        resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
        destination: ec2.FlowLogDestination.toCloudWatchLogs(
          flowLogGroup,
          flowLogRole,
        ),
        trafficType: ec2.FlowLogTrafficType.ALL,
      });

      new ec2.FlowLog(this, 'FlowLogS3', {
        resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
        destination: ec2.FlowLogDestination.toS3(
          flowLogBucket,
          'vpc-flow-logs',
        ),
        trafficType: ec2.FlowLogTrafficType.ALL,
      });
    }

    if (enableCloudWatchLogs) {
      new logs.LogGroup(this, 'WorkspacesLogGroup', {
        logGroupName: `/aws/workspaces/${stack.stackName}`,
        retention: logRetention,
        encryptionKey: key,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }

    // Storage — access log bucket (S3-managed encryption, retained) + HIPAA main bucket (KMS, WORM, retained)
    // Access log bucket uses S3-managed encryption — KMS is not permitted for log delivery destinations.
    // EventBridge is wired via L1 CfnBucket.notificationConfiguration to avoid CDK's
    // BucketNotificationsHandler Lambda, which would attach an inline policy violating
    // HIPAA iam-no-inline-policy-check.
    if (props.storage?.existingAccessLogBucketName) {
      this.accessLogBucket = s3.Bucket.fromBucketName(
        this,
        'AccessLogBucket',
        props.storage.existingAccessLogBucketName,
      );
    } else {
      const accessLogBucket = new s3.Bucket(this, 'AccessLogBucket', {
        bucketName: props.storage?.accessLogBucketName,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [
          {
            id: 'ExpireOldLogs',
            expiration: Duration.days(365),
            noncurrentVersionExpiration: Duration.days(90),
            transitions: [
              {
                storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                transitionAfter: Duration.days(90),
              },
            ],
          },
        ],
      });
      (
        accessLogBucket.node.defaultChild as s3.CfnBucket
      ).notificationConfiguration = {
        eventBridgeConfiguration: {eventBridgeEnabled: true},
      };
      this.accessLogBucket = accessLogBucket;
    }

    if (props.storage?.existingBucketName) {
      this.bucket = s3.Bucket.fromBucketName(
        this,
        'StorageBucket',
        props.storage.existingBucketName,
      );
    } else {
      const bucket = new s3.Bucket(this, 'StorageBucket', {
        bucketName: props.storage?.bucketName,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: key,
        bucketKeyEnabled: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        objectLockEnabled: true,
        serverAccessLogsBucket: this.accessLogBucket,
        serverAccessLogsPrefix: 'access-logs/',
        removalPolicy: RemovalPolicy.RETAIN,
        autoDeleteObjects: false,
        lifecycleRules: [
          {
            id: 'TransitionOldVersions',
            noncurrentVersionTransitions: [
              {
                storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                transitionAfter: Duration.days(30),
              },
              {
                storageClass: s3.StorageClass.GLACIER,
                transitionAfter: Duration.days(90),
              },
            ],
            noncurrentVersionExpiration: Duration.days(365),
          },
          {
            id: 'AbortIncompleteUploads',
            abortIncompleteMultipartUploadAfter: Duration.days(7),
          },
        ],
        cors: [],
      });
      (bucket.node.defaultChild as s3.CfnBucket).notificationConfiguration = {
        eventBridgeConfiguration: {eventBridgeEnabled: true},
      };
      this.bucket = bucket;
    }

    // Directory — use existing or create AWS Managed Microsoft AD
    const dir = props.directory;
    if (dir.existingDirectoryId) {
      this.directoryId = dir.existingDirectoryId;
    } else if (dir.createManagedAd) {
      if (!dir.adDomainName) {
        throw new Error(
          'adDomainName is required when directory.createManagedAd is true',
        );
      }
      if (!dir.adAdminPassword) {
        throw new Error(
          'adAdminPassword is required when directory.createManagedAd is true',
        );
      }
      if (this.privateSubnets.length < 2) {
        throw new Error(
          'At least 2 subnets in different AZs are required for Managed AD',
        );
      }
      const managedAd = new directoryservice.CfnMicrosoftAD(this, 'ManagedAD', {
        name: dir.adDomainName,
        // unsafeUnwrap is required — CfnMicrosoftAD expects a plain string, not a SecretValue token
        password: dir.adAdminPassword.unsafeUnwrap(),
        vpcSettings: {
          vpcId: this.vpc.vpcId,
          subnetIds: this.privateSubnets
            .slice(0, 2)
            .map((subnet) => subnet.subnetId),
        },
        edition: 'Standard',
        shortName: dir.adShortName,
      });
      this.directoryId = managedAd.ref;
    } else {
      throw new Error(
        'Either directory.existingDirectoryId must be provided, or directory.createManagedAd must be true',
      );
    }

    // WorkSpaces IAM role — exact name required by the WorkSpaces service.
    // Uses only managed policies; no inline policies to satisfy iam-no-inline-policy-check.
    const roleExists =
      props.infrastructure?.workspacesDefaultRoleExists ?? false;
    const existingRoleArn = `arn:aws:iam::${stack.account}:role/workspaces_DefaultRole`;

    if (roleExists) {
      this.workspacesRole = iam.Role.fromRoleArn(
        this,
        'WorkspacesDefaultRole',
        existingRoleArn,
      );
    } else {
      const workspacesCustomPolicy = new iam.ManagedPolicy(
        this,
        'WorkspacesCustomPolicy',
        {
          managedPolicyName: `${stack.stackName}-workspaces-default-custom`,
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowKmsForWorkspaces',
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:CreateGrant',
                'kms:Decrypt',
                'kms:DescribeKey',
                'kms:Encrypt',
                'kms:GenerateDataKey*',
                'kms:ReEncrypt*',
              ],
              resources: [key.keyArn],
            }),
            new iam.PolicyStatement({
              sid: 'AllowSSMAssociationManagement',
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:CreateAssociation',
                'ssm:UpdateAssociation',
                'ssm:DescribeAssociation',
                'ssm:ListAssociations',
              ],
              resources: ['*'],
            }),
          ],
        },
      );

      this.workspacesRole = new iam.Role(this, 'WorkspacesDefaultRole', {
        roleName: 'workspaces_DefaultRole',
        assumedBy: new iam.ServicePrincipal('workspaces.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonWorkSpacesServiceAccess',
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonWorkSpacesSelfServiceAccess',
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonSSMManagedInstanceCore',
          ),
          workspacesCustomPolicy,
        ],
      });
    }

    // Directory registration — always runs when a directory is supplied or created.
    // Required before any CfnWorkspace can be provisioned; WorkSpaces returns
    // ResourceNotFound.Directory if the directory has not been registered.
    // CfnWorkspacesDirectory does not exist as a CDK L2 construct so we call the API directly.
    // All AwsCustomResource instances in this construct share a single Lambda/role via
    // CustomResourceRole. The infrastructure block extends this policy with SSM/KMS permissions.
    const customResourcePolicy = new iam.ManagedPolicy(
      this,
      'CustomResourcePolicy',
      {
        managedPolicyName: `${stack.stackName}-workspaces-custom-resource`,
        statements: [
          new iam.PolicyStatement({
            sid: 'AllowWorkspacesDirectoryRegistration',
            effect: iam.Effect.ALLOW,
            actions: [
              'workspaces:RegisterWorkspaceDirectory',
              'workspaces:DeregisterWorkspaceDirectory',
              'workspaces:DescribeWorkspaceDirectories',
              'ds:DescribeDirectories',
              'ds:AuthorizeApplication',
              'ds:UnauthorizeApplication',
              'ds:EnableSso',
              'ds:DisableSso',
              'iam:GetRole',
              'iam:CreateServiceLinkedRole',
              'iam:PassRole',
            ],
            resources: ['*'],
          }),
        ],
      },
    );

    const customResourceRole = new iam.Role(this, 'CustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
        customResourcePolicy,
      ],
    });

    const workspacesDirectory = new cr.AwsCustomResource(
      this,
      'WorkspacesDirectory',
      {
        onCreate: {
          service: 'WorkSpaces',
          action: 'RegisterWorkspaceDirectory',
          parameters: {
            DirectoryId: this.directoryId,
            SubnetIds: this.privateSubnets.slice(0, 2).map((s) => s.subnetId),
            EnableWorkDocs: false,
            EnableSelfService: true,
            Tenancy: 'SHARED',
          },
          physicalResourceId: cr.PhysicalResourceId.of(this.directoryId),
          // InvalidResourceStateException: directory is already registered — treat as no-op.
          ignoreErrorCodesMatching: 'InvalidResourceStateException',
        },
        onUpdate: {
          service: 'WorkSpaces',
          action: 'DescribeWorkspaceDirectories',
          parameters: {DirectoryIds: [this.directoryId]},
          physicalResourceId: cr.PhysicalResourceId.of(this.directoryId),
        },
        onDelete: {
          service: 'WorkSpaces',
          action: 'DeregisterWorkspaceDirectory',
          parameters: {DirectoryId: this.directoryId},
          ignoreErrorCodesMatching:
            'InvalidResourceStateException|ResourceNotFoundException',
        },
        role: customResourceRole,
      },
    );
    workspacesDirectory.node.addDependency(this.workspacesRole);

    // Infrastructure layer — only created when props.infrastructure is provided
    if (props.infrastructure) {
      const infra = props.infrastructure;

      // IAM role used for SSM hybrid activation registration
      const ssmHybridActivationRole = new iam.Role(
        this,
        'SsmHybridActivationRole',
        {
          roleName: `${stack.stackName}-ssm-hybrid-activation`,
          assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              'AmazonSSMManagedInstanceCore',
            ),
          ],
        },
      );
      this.ssmHybridActivationRole = ssmHybridActivationRole;

      // Extend the shared custom resource policy with infrastructure-specific permissions.
      customResourcePolicy.addStatements(
        new iam.PolicyStatement({
          sid: 'AllowSsmActivation',
          effect: iam.Effect.ALLOW,
          actions: ['ssm:CreateActivation', 'ssm:DeleteActivation'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'AllowPassSsmHybridActivationRole',
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: [ssmHybridActivationRole.roleArn],
        }),
        new iam.PolicyStatement({
          sid: 'AllowSsmActivationParam',
          effect: iam.Effect.ALLOW,
          actions: ['ssm:PutParameter', 'ssm:DeleteParameter'],
          resources: [
            `arn:aws:ssm:${stack.region}:${stack.account}:parameter${this.ssmActivationParamPrefix}/*`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'AllowKmsForActivationParam',
          effect: iam.Effect.ALLOW,
          actions: [
            'kms:Encrypt',
            'kms:GenerateDataKey',
            'kms:Decrypt',
            'kms:DescribeKey',
          ],
          resources: [key.keyArn],
        }),
      );
      if (infra.mfa) {
        customResourcePolicy.addStatements(
          new iam.PolicyStatement({
            sid: 'AllowDirectoryMfa',
            effect: iam.Effect.ALLOW,
            actions: ['ds:EnableRadius', 'ds:DisableRadius', 'ds:UpdateRadius'],
            resources: ['*'],
          }),
        );
      }

      // RADIUS-based MFA — configure the directory to require a second factor.
      // Must run after directory registration since WorkSpaces uses the RADIUS
      // settings during workspace login, not during provisioning.
      if (infra.mfa) {
        const mfa = infra.mfa;
        const radiusSettings = {
          AuthenticationProtocol: mfa.authenticationProtocol ?? 'MS-CHAPv2',
          DisplayLabel: mfa.displayLabel ?? 'MFA',
          RadiusPort: mfa.radiusPort ?? 1812,
          RadiusRetries: mfa.radiusRetries ?? 0,
          RadiusServers: mfa.radiusServers,
          RadiusTimeout: mfa.radiusTimeout ?? 20,
          // unsafeUnwrap resolves to a CloudFormation dynamic reference
          // (e.g. {{resolve:secretsmanager:...}}) — CloudFormation resolves the
          // reference before invoking the custom resource Lambda.
          SharedSecret: mfa.sharedSecret.unsafeUnwrap(),
          UseSameUsername: mfa.useSameUsername ?? false,
        };

        const workspacesMfa = new cr.AwsCustomResource(this, 'WorkspacesMfa', {
          onCreate: {
            service: 'DirectoryService',
            action: 'EnableRadius',
            parameters: {
              DirectoryId: this.directoryId,
              RadiusSettings: radiusSettings,
            },
            physicalResourceId: cr.PhysicalResourceId.of(
              `${this.directoryId}-mfa`,
            ),
            // EntityAlreadyExistsException: RADIUS already enabled — treat as no-op.
            ignoreErrorCodesMatching: 'EntityAlreadyExistsException',
          },
          onUpdate: {
            service: 'DirectoryService',
            action: 'UpdateRadius',
            parameters: {
              DirectoryId: this.directoryId,
              RadiusSettings: radiusSettings,
            },
            physicalResourceId: cr.PhysicalResourceId.of(
              `${this.directoryId}-mfa`,
            ),
          },
          onDelete: {
            service: 'DirectoryService',
            action: 'DisableRadius',
            parameters: {DirectoryId: this.directoryId},
            // EntityDoesNotExistException: RADIUS not enabled — safe to ignore.
            // UnsupportedOperationException: directory type doesn't support RADIUS.
            ignoreErrorCodesMatching:
              'EntityDoesNotExistException|UnsupportedOperationException',
          },
          role: customResourceRole,
        });
        workspacesMfa.node.addDependency(workspacesDirectory);
      }

      // SSM Hybrid Activation for golden image re-registration.
      // New workspaces provisioned from the golden image bundle carry a stale SSM
      // registration. On first login the operator runs `sudo -E ssm-register` to
      // fetch these credentials from Parameter Store and re-register with a fresh
      // managed instance ID. Re-deploy this stack to rotate the activation.
      // SSM activations have a maximum expiry of 30 days — rotate before then.
      const activationExpiry = new Date();
      activationExpiry.setDate(activationExpiry.getDate() + 29);

      // onUpdate mirrors onCreate so every stack deploy rotates the activation:
      // a new one is created, Parameter Store is updated, then the old is deleted.
      // Already-registered workspaces are unaffected — activation is for initial
      // registration only.
      const activationCall: cr.AwsSdkCall = {
        service: 'SSM',
        action: 'CreateActivation',
        parameters: {
          Description: `${stack.stackName} WorkSpace golden image`,
          IamRole: ssmHybridActivationRole.roleName,
          RegistrationLimit: 50,
          ExpirationDate: activationExpiry.toISOString(),
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('ActivationId'),
      };

      const ssmActivation = new cr.AwsCustomResource(
        this,
        'GoldenImageActivation',
        {
          onCreate: activationCall,
          onUpdate: activationCall,
          onDelete: {
            service: 'SSM',
            action: 'DeleteActivation',
            parameters: {ActivationId: new cr.PhysicalResourceIdReference()},
            ignoreErrorCodesMatching: 'InvalidActivation',
          },
          role: customResourceRole,
        },
      );

      new ssm.StringParameter(this, 'ActivationIdParam', {
        parameterName: `${this.ssmActivationParamPrefix}/id`,
        stringValue: ssmActivation.getResponseField('ActivationId'),
        description:
          'SSM hybrid activation ID for WorkSpace golden image re-registration',
      });

      new ssm.StringParameter(this, 'ActivationRegionParam', {
        parameterName: `${this.ssmActivationParamPrefix}/region`,
        stringValue: stack.region,
        description: 'AWS region for SSM hybrid activation',
      });

      // Neither CfnSSMParameter nor CloudFormation's AWS::SSM::Parameter support
      // SecureString. Call ssm:PutParameter directly via a custom resource.
      new cr.AwsCustomResource(this, 'ActivationCodeParam', {
        onCreate: {
          service: 'SSM',
          action: 'PutParameter',
          parameters: {
            Name: `${this.ssmActivationParamPrefix}/code`,
            Value: ssmActivation.getResponseField('ActivationCode'),
            Type: 'SecureString',
            KeyId: key.keyArn,
            Description:
              'SSM hybrid activation code for WorkSpace golden image re-registration',
            Overwrite: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${this.ssmActivationParamPrefix}/code`,
          ),
        },
        onUpdate: {
          service: 'SSM',
          action: 'PutParameter',
          parameters: {
            Name: `${this.ssmActivationParamPrefix}/code`,
            Value: ssmActivation.getResponseField('ActivationCode'),
            Type: 'SecureString',
            KeyId: key.keyArn,
            Description:
              'SSM hybrid activation code for WorkSpace golden image re-registration',
            Overwrite: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${this.ssmActivationParamPrefix}/code`,
          ),
        },
        onDelete: {
          service: 'SSM',
          action: 'DeleteParameter',
          parameters: {Name: `${this.ssmActivationParamPrefix}/code`},
          ignoreErrorCodesMatching: 'ParameterNotFound',
        },
        role: customResourceRole,
      });

      // HIPAA-compliant SSM Patch Baseline.
      // Security-classified patches, Critical/Important severity, 7-day auto-approval.
      // The patchGroups property ties this baseline to AwsWorkspacesUser instances
      // tagged with Patch Group=<patchGroupName>.
      new ssm.CfnPatchBaseline(this, 'PatchBaseline', {
        name: `${stack.stackName}-workspaces-security`,
        operatingSystem:
          infra.operatingSystem ?? AwsWorkspaces.DEFAULT_PATCH_OS,
        description:
          'HIPAA patch baseline: Security classification, Critical/Important severity, 7-day auto-approval',
        patchGroups: [this.patchGroupName],
        approvalRules: {
          patchRules: [
            {
              patchFilterGroup: {
                patchFilters: [
                  {key: 'CLASSIFICATION', values: ['Security']},
                  {key: 'SEVERITY', values: ['Critical', 'Important']},
                ],
              },
              approveAfterDays: 7,
              enableNonSecurity: false,
              complianceLevel: 'CRITICAL',
            },
          ],
        },
        tags: [
          {key: 'ManagedBy', value: 'CDK'},
          {key: 'Compliance', value: 'HIPAA'},
        ],
      });

      // Package installation via State Manager (conditional).
      // Runs on first boot and every 30 days. Only created when scriptPath or packages provided.
      if (infra.packages) {
        let commands: string[];
        if (infra.packages.scriptPath) {
          // Script file read at synth time — content is embedded in the CloudFormation template.
          commands = fs
            .readFileSync(infra.packages.scriptPath, 'utf-8')
            .split('\n');
        } else if (
          infra.packages.packages &&
          infra.packages.packages.length > 0
        ) {
          const packagesStr = infra.packages.packages.join(' ');
          commands = [
            '#!/bin/bash',
            'set -euo pipefail',
            `dnf install -y ${packagesStr} || yum install -y ${packagesStr}`,
          ];
        } else {
          throw new Error(
            'AwsWorkspacesPackagesProps requires either scriptPath or a non-empty packages array',
          );
        }

        new ssm.CfnAssociation(this, 'PackagesAssociation', {
          name: 'AWS-RunShellScript',
          associationName: `${stack.stackName}-package-install`,
          targets: [{key: 'tag:ManagedBy', values: ['CDK']}],
          parameters: {commands},
          scheduleExpression: 'rate(30 days)',
          applyOnlyAtCronInterval: false,
          complianceSeverity: 'MEDIUM',
          maxErrors: '1',
          maxConcurrency: '50%',
        });
      }

      // Revoke open-world ingress from all WorkSpaces-managed security groups.
      // AWS WorkSpaces tags its auto-created SGs with "Created by Amazon WorkSpaces".
      // This custom resource scans all such SGs and removes any rule allowing traffic
      // from 0.0.0.0/0 or ::/0, satisfying restricted-ssh, restricted-common-ports,
      // and vpc-sg-open-only-to-authorized-ports Config conformance rules.
      //
      // The Lambda implements the CloudFormation custom resource protocol directly
      // (HTTP PUT to event.ResponseURL) to avoid the inline policy that cr.Provider
      // creates via its internal grantInvoke call.
      const revokeSshFnPolicy = new iam.ManagedPolicy(
        this,
        'RevokeSshFnPolicy',
        {
          managedPolicyName: `${stack.stackName}-revoke-ssh`,
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowRevokeSsh',
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeSecurityGroups',
                'ec2:RevokeSecurityGroupIngress',
              ],
              resources: ['*'],
            }),
          ],
        },
      );

      const revokeSshFnRole = new iam.Role(this, 'RevokeSshFnRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
          revokeSshFnPolicy,
        ],
      });

      // boto3 is pre-installed in all Python Lambda runtimes; no bundling required.
      // Node.js 18+ runtimes no longer include any AWS SDK, making @aws-sdk/client-ec2
      // unavailable in inline (ZipFile) code without a bundling step.
      const revokeSshFn = new lambda.Function(this, 'RevokeSshFn', {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        timeout: Duration.seconds(60),
        role: revokeSshFnRole,
        code: lambda.Code.fromInline(`
import boto3
import json
import urllib.request

def handler(event, context):
    if event['RequestType'] == 'Delete':
        _send(event, 'SUCCESS')
        return
    try:
        ec2 = boto3.client('ec2')
        sgs = ec2.describe_security_groups(
            Filters=[{'Name': 'tag-key', 'Values': ['Created by Amazon WorkSpaces']}]
        ).get('SecurityGroups', [])
        print('Found', len(sgs), 'WorkSpaces security group(s)')
        for sg in sgs:
            open_rules = [
                p for p in sg.get('IpPermissions', [])
                if any(r.get('CidrIp') == '0.0.0.0/0' for r in p.get('IpRanges', []))
                or any(r.get('CidrIpv6') == '::/0' for r in p.get('Ipv6Ranges', []))
            ]
            if not open_rules:
                print('No open-world rules in', sg['GroupId'])
                continue
            to_revoke = []
            for p in open_rules:
                e = {
                    'IpProtocol': p['IpProtocol'],
                    'IpRanges': [r for r in p.get('IpRanges', []) if r.get('CidrIp') == '0.0.0.0/0'],
                    'Ipv6Ranges': [r for r in p.get('Ipv6Ranges', []) if r.get('CidrIpv6') == '::/0'],
                }
                if p.get('FromPort') is not None:
                    e['FromPort'] = p['FromPort']
                if p.get('ToPort') is not None:
                    e['ToPort'] = p['ToPort']
                if e['IpRanges'] or e['Ipv6Ranges']:
                    to_revoke.append(e)
            if to_revoke:
                ec2.revoke_security_group_ingress(GroupId=sg['GroupId'], IpPermissions=to_revoke)
                print('Revoked', len(to_revoke), 'rule(s) from', sg['GroupId'], '(' + sg.get('GroupName', '') + ')')
        _send(event, 'SUCCESS')
    except Exception as err:
        _send(event, 'FAILED', str(err))

def _send(event, status, reason='done'):
    body = json.dumps({
        'Status': status,
        'Reason': reason,
        'PhysicalResourceId': event.get('PhysicalResourceId') or event['LogicalResourceId'],
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': {},
    }).encode()
    req = urllib.request.Request(
        event['ResponseURL'],
        data=body,
        method='PUT',
        headers={'Content-Type': '', 'Content-Length': str(len(body))},
    )
    urllib.request.urlopen(req)
`),
      });

      // Allow CloudFormation to invoke this Lambda directly as a custom resource handler,
      // avoiding the inline policy that cr.Provider creates via grantInvoke.
      revokeSshFn.addPermission('AllowCloudFormation', {
        principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        action: 'lambda:InvokeFunction',
      });

      new CustomResource(this, 'RevokeSshCustomResource', {
        serviceToken: revokeSshFn.functionArn,
        properties: {
          // ISO timestamp changes on every cdk synth, re-running the Lambda on every
          // deploy to catch any open-world rules re-added by WorkSpaces.
          Nonce: new Date().toISOString(),
        },
      });
    }
  }
}
