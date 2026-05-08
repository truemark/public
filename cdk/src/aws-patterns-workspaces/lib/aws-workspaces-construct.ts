import {Construct} from 'constructs';
import {Duration, RemovalPolicy, SecretValue, Stack} from 'aws-cdk-lib';
import * as directoryservice from 'aws-cdk-lib/aws-directoryservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as workspaces from 'aws-cdk-lib/aws-workspaces';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
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
 * WorkSpace instance configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesWorkspaceProps {
  /**
   * WorkSpaces bundle ID (e.g., 'wsb-g5rbnq51n' for Ubuntu 22.04 Standard in us-west-2).
   */
  readonly bundleId: string;

  /**
   * Username for the WorkSpace. Must exist in the directory.
   * If omitted, no WorkSpace is created (infrastructure only).
   */
  readonly userName?: string;

  /**
   * WorkSpaces running mode.
   *
   * @default 'AUTO_STOP'
   */
  readonly runningMode?: 'AUTO_STOP' | 'ALWAYS_ON';

  /**
   * WorkSpaces compute type.
   *
   * @default 'STANDARD'
   */
  readonly computeType?:
    | 'VALUE'
    | 'STANDARD'
    | 'PERFORMANCE'
    | 'POWER'
    | 'GRAPHICS'
    | 'GRAPHICSPRO';

  /**
   * Root volume size in GiB.
   *
   * @default 80
   */
  readonly rootVolumeSizeGib?: number;

  /**
   * User volume size in GiB.
   *
   * @default 50
   */
  readonly userVolumeSizeGib?: number;
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
   * Custom name for the HIPAA storage bucket.
   */
  readonly bucketName?: string;
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
   * WorkSpace instance configuration.
   */
  readonly workspaces: AwsWorkspacesWorkspaceProps;

  /**
   * Logging configuration.
   */
  readonly logging?: AwsWorkspacesLoggingProps;

  /**
   * Storage configuration.
   */
  readonly storage?: AwsWorkspacesStorageProps;
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
 * Deploys HIPAA-compliant AWS WorkSpaces with an isolated VPC (or existing), KMS encryption,
 * CloudWatch and VPC flow logging, WORM-protected S3 storage, and an AWS Managed AD or
 * existing directory.
 *
 * PREREQUISITE: Before creating a WorkSpace, register the directory with WorkSpaces:
 *   aws workspaces register-workspace-directory \
 *     --directory-id <DIRECTORY_ID> \
 *     --subnet-ids <SUBNET_1> <SUBNET_2> \
 *     --enable-self-service \
 *     --tenancy SHARED
 *
 * NOTE: This construct creates an IAM role named 'workspaces_DefaultRole'. This name is
 * account-global and required by WorkSpaces. Deploying into an account that already has this
 * role will fail — delete or import the pre-existing role first.
 */
export class AwsWorkspaces extends ExtendedConstruct {
  readonly vpc: ec2.IVpc;
  readonly privateSubnets: ec2.ISubnet[];
  readonly encryptionKey: kms.IKey;
  readonly bucket: s3.Bucket;
  readonly accessLogBucket: s3.Bucket;
  readonly directoryId: string;
  readonly workspacesRole: iam.IRole;
  readonly workspace?: workspaces.CfnWorkspace;

  constructor(scope: Construct, id: string, props: AwsWorkspacesProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const stack = Stack.of(this);

    // KMS key — account root + CloudWatch Logs + VPC Flow Logs service principals
    const key = new kms.Key(this, 'Key', {
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
    this.accessLogBucket = new s3.Bucket(this, 'AccessLogBucket', {
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
      this.accessLogBucket.node.defaultChild as s3.CfnBucket
    ).notificationConfiguration = {
      eventBridgeConfiguration: {eventBridgeEnabled: true},
    };

    this.bucket = new s3.Bucket(this, 'StorageBucket', {
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
    (this.bucket.node.defaultChild as s3.CfnBucket).notificationConfiguration =
      {eventBridgeConfiguration: {eventBridgeEnabled: true}};

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

    // WorkSpaces IAM role — exact name required by the WorkSpaces service
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
      ],
    });

    // WorkSpace — created only when a userName is provided
    if (props.workspaces.userName) {
      const runningMode = props.workspaces.runningMode ?? 'AUTO_STOP';
      const computeType = props.workspaces.computeType ?? 'STANDARD';
      this.workspace = new workspaces.CfnWorkspace(this, 'Workspace', {
        directoryId: this.directoryId,
        bundleId: props.workspaces.bundleId,
        userName: props.workspaces.userName,
        rootVolumeEncryptionEnabled: true,
        userVolumeEncryptionEnabled: true,
        volumeEncryptionKey: key.keyArn,
        workspaceProperties: {
          runningMode,
          runningModeAutoStopTimeoutInMinutes:
            runningMode === 'AUTO_STOP' ? 60 : undefined,
          rootVolumeSizeGib: props.workspaces.rootVolumeSizeGib ?? 80,
          userVolumeSizeGib: props.workspaces.userVolumeSizeGib ?? 50,
          computeTypeName: computeType,
        },
      });
      this.workspace.node.addDependency(this.workspacesRole);
    }
  }
}
