import * as fs from 'node:fs';
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  type SecretValue,
  Stack,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {ManagedAd} from '../../aws-directory-service';
import {SsmHybridActivation} from '../../aws-ssm-activation';
import {LibStandardTags} from '../../truemark';
import {AwsWorkspacesCertificateBasedAuth} from './aws-workspaces-certificate-based-auth-construct';
import {AwsWorkspacesDirectoryRegistration} from './aws-workspaces-directory-registration-construct';
import {AwsWorkspacesSamlAuth} from './aws-workspaces-saml-auth-construct';

/**
 * Networking configuration for AwsWorkspaces.
 * The VPC should be created externally using the standard-network construct.
 */
export interface AwsWorkspacesNetworkingProps {
  /**
   * VPC to deploy WorkSpaces into. Must have at least two subnets across
   * two availability zones as required by WorkSpaces.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Subnets to use for the WorkSpaces directory registration and Managed AD.
   * Falls back to the VPC's private subnets when omitted.
   */
  readonly subnets?: ec2.ISubnet[];
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
   * Enable S3 access logging for the WorkSpaces storage bucket.
   * Creates a dedicated access log bucket when true. Disable if access
   * logging is not required to avoid the associated storage cost.
   *
   * @default true
   */
  readonly enableAccessLogging?: boolean;

  /**
   * Retention period for logs in days.
   *
   * @default 90
   */
  readonly retentionDays?: number;
}

/**
 * Storage configuration for AwsWorkspaces.
 * When omitted entirely, no storage bucket is created.
 */
export interface AwsWorkspacesStorageProps {
  /**
   * Custom name for the storage bucket. Only used when creating a new bucket.
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

  /**
   * SSM State Manager targets for the package installation association.
   * Controls which managed instances the script runs on.
   * Example: `[{key: 'tag:ManagedBy', values: ['CDK']}]`
   *
   * @default - all managed instances (`[{key: 'InstanceIds', values: ['*']}]`)
   */
  readonly targets?: ssm.CfnAssociation.TargetProperty[];
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
   * Tags applied to the SSM hybrid activation. Per the SSM CreateActivation API,
   * tags assigned to an activation are automatically applied to each managed
   * instance (mi-*) that registers with it — server-side, at registration time,
   * requiring no permissions on the registering identity.
   *
   * Use this to tag golden-image WorkSpaces so SSM State Manager associations can
   * target them (e.g. `{ManagedBy: 'CDK'}` to match a `tag:ManagedBy=CDK` target).
   * Tags cannot be added to an activation after creation; the activation is
   * rotated on every deploy, so changes apply to instances registered thereafter.
   *
   * When set, the activation-creating custom resource is granted
   * ssm:AddTagsToResource, which CreateActivation requires in order to apply tags.
   *
   * @default - no tags are applied to the activation
   */
  readonly activationTags?: {[key: string]: string};

  /**
   * OS package installation via State Manager Association.
   * Only created when packages is provided and the list is non-empty.
   */
  readonly packages?: AwsWorkspacesPackagesProps;

  /**
   * Maximum number of WorkSpaces that can register using the golden image SSM
   * hybrid activation. The activation is rotated on every deploy, so this limit
   * applies per deploy cycle.
   *
   * Set to `1` when all WorkSpaces self-register via a VPC-private endpoint
   * (where each registration uses its own single-use activation), so this shared
   * activation is only needed for the golden image workspace itself.
   *
   * @default 50
   */
  readonly activationRegistrationLimit?: number;

  /**
   * Authentication configuration. Enables RADIUS MFA, SAML 2.0 federation, or
   * certificate-based authentication on the WorkSpaces directory.
   * Exactly one of radius, saml, or certificateBased must be set.
   */
  readonly mfa?: AwsWorkspacesMfaProps;
}

/**
 * RADIUS-based MFA configuration for AwsWorkspaces.
 * Requires a RADIUS server reachable from the directory's VPC.
 */
export interface AwsWorkspacesRadiusMfaProps {
  /**
   * IP addresses or DNS names of the RADIUS server(s).
   * Provide two entries for redundancy.
   */
  readonly radiusServers: string[];

  /**
   * Shared secret between the directory and the RADIUS server.
   * Use SecretValue.secretsManager() or SecretValue.ssmSecure() — do not use unsafePlainText.
   */
  readonly sharedSecret: SecretValue;

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
   * Whether to pass the same username to the RADIUS server as used for directory authentication.
   * Set to false when the RADIUS server expects a different username format.
   *
   * @default false
   */
  readonly useSameUsername?: boolean;
}

/**
 * SAML 2.0 authentication configuration for WorkSpaces.
 * Delegates workspace login to an external identity provider.
 * The IdP must be configured to issue SAML assertions targeting the WorkSpaces service.
 */
export interface AwsWorkspacesSamlProps {
  /**
   * The URL to the identity provider's SAML assertion consumer service (ACS) endpoint.
   * WorkSpaces redirects users here to initiate SAML authentication.
   */
  readonly userAccessUrl: string;

  /**
   * The name of the parameter used to pass the relay state in the SAML request.
   *
   * @default 'RelayState'
   */
  readonly relayStateParameterName?: string;

  /**
   * Whether directory login is available as a fallback when SAML authentication fails.
   * Use ENABLED_WITH_DIRECTORY_LOGIN_FALLBACK during IdP testing to retain access
   * if the SAML configuration is misconfigured.
   *
   * @default 'ENABLED'
   */
  readonly status?: 'ENABLED' | 'ENABLED_WITH_DIRECTORY_LOGIN_FALLBACK';
}

/**
 * Certificate-based authentication configuration for AwsWorkspaces.
 * Enables smart card / device certificate login via an ACM Private CA.
 * The CA must already exist and be in ACTIVE state before deployment.
 */
export interface AwsWorkspacesCertificateBasedAuthConfig {
  /**
   * ARN of the ACM Private Certificate Authority used to issue WorkSpaces client certificates.
   */
  readonly certificateAuthorityArn: string;
}

/**
 * Authentication configuration for AwsWorkspaces.
 * Exactly one of radius, saml, or certificateBased must be set.
 */
export interface AwsWorkspacesMfaProps {
  /**
   * RADIUS-based multi-factor authentication via a RADIUS server.
   * Configured on the directory by the ManagedAd construct, so it is only
   * supported when this construct creates the directory (directory.createManagedAd).
   * Setting this with an imported directory (directory.existingDirectoryId) throws.
   */
  readonly radius?: AwsWorkspacesRadiusMfaProps;

  /**
   * SAML 2.0 federated authentication via an external identity provider.
   * Supported on Managed Microsoft AD and AD Connector directories.
   */
  readonly saml?: AwsWorkspacesSamlProps;

  /**
   * Certificate-based authentication for smart card or device certificate login.
   * Requires an ACM Private CA and Managed Microsoft AD.
   */
  readonly certificateBased?: AwsWorkspacesCertificateBasedAuthConfig;
}

/**
 * Encryption configuration for AwsWorkspaces.
 */
export interface AwsWorkspacesEncryptionProps {
  /**
   * KMS customer-managed key to use for encrypting CloudWatch Logs and S3 storage.
   * Pass the IKey object (not an ARN string) so CDK can add the required key policy
   * grants for CloudWatch Logs and other service principals automatically.
   * When omitted, AWS-managed keys are used for all encryption.
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Properties for AwsWorkspaces.
 */
export interface AwsWorkspacesProps extends ExtendedConstructProps {
  /**
   * Networking configuration. The VPC should be created externally using
   * the standard-network construct and passed in here.
   */
  readonly networking: AwsWorkspacesNetworkingProps;

  /**
   * Directory configuration. Provide an existing directory or create a Managed AD.
   */
  readonly directory: AwsWorkspacesDirectoryProps;

  /**
   * Logging configuration.
   */
  readonly logging?: AwsWorkspacesLoggingProps;

  /**
   * Storage configuration. When omitted, no S3 bucket is created.
   */
  readonly storage?: AwsWorkspacesStorageProps;

  /**
   * Encryption configuration. When omitted, AWS-managed keys are used.
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
 * Deploys AWS WorkSpaces infrastructure: optional KMS encryption, CloudWatch logging,
 * optional WORM-protected S3 storage, AWS Managed AD or existing directory, and an
 * optional infrastructure layer that registers the directory with WorkSpaces, manages
 * SSM patch compliance, hardens WorkSpaces security groups, and provisions golden-image
 * SSM hybrid activation credentials.
 *
 * Networking and VPC flow logs are handled externally by the standard-network construct.
 * Pass the VPC via networking.vpc.
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
  /**
   * Customer-managed KMS key passed via encryption.encryptionKey.
   * Undefined when no key is provided — AWS-managed keys are used in that case.
   */
  readonly encryptionKey: kms.IKey | undefined;
  /**
   * WORM-protected storage bucket, when storage props are provided.
   * Undefined when no storage props are set.
   */
  readonly bucket: s3.IBucket | undefined;
  /**
   * Access log bucket, when access logging is enabled (the default).
   * Undefined when logging.enableAccessLogging is false.
   */
  readonly accessLogBucket: s3.IBucket | undefined;
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

    // KMS key — only when a CMK is supplied by the caller.
    // Accepting IKey directly (not a string ARN) ensures CDK can add the required
    // key policy grants for CloudWatch Logs and other service principals.
    // When omitted, AWS-managed keys handle encryption throughout.
    const key = props.encryption?.encryptionKey;
    this.encryptionKey = key;

    // Networking — VPC and subnets are always supplied by the caller.
    // Flow logs are the responsibility of the standard-network construct.
    this.vpc = props.networking.vpc;
    this.privateSubnets = props.networking.subnets?.length
      ? props.networking.subnets
      : this.vpc.privateSubnets;

    // Logging — CloudWatch log group for WorkSpaces events
    const enableCloudWatchLogs = props.logging?.enableCloudWatchLogs ?? true;
    const enableAccessLogging = props.logging?.enableAccessLogging ?? true;
    const logRetention = mapRetentionDays(props.logging?.retentionDays ?? 90);

    if (enableCloudWatchLogs) {
      new logs.LogGroup(this, 'WorkspacesLogGroup', {
        logGroupName: `/aws/workspaces/${stack.stackName}`,
        retention: logRetention,
        encryptionKey: key,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }

    // Storage — access log bucket (S3-managed encryption, retained) + optional main bucket.
    // Access log bucket uses S3-managed encryption — KMS is not permitted for log delivery destinations.
    // EventBridge is wired via L1 CfnBucket.notificationConfiguration to avoid CDK's
    // BucketNotificationsHandler Lambda, which would attach an inline policy violating
    // the iam-no-inline-policy-check Config rule.
    if (enableAccessLogging) {
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
    }

    if (props.storage?.existingBucketName) {
      this.bucket = s3.Bucket.fromBucketName(
        this,
        'StorageBucket',
        props.storage.existingBucketName,
      );
    } else if (props.storage) {
      const bucket = new s3.Bucket(this, 'StorageBucket', {
        bucketName: props.storage.bucketName,
        encryption: key
          ? s3.BucketEncryption.KMS
          : s3.BucketEncryption.KMS_MANAGED,
        ...(key ? {encryptionKey: key, bucketKeyEnabled: true} : {}),
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        objectLockEnabled: true,
        ...(this.accessLogBucket
          ? {
              serverAccessLogsBucket: this.accessLogBucket,
              serverAccessLogsPrefix: 'access-logs/',
            }
          : {}),
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

    // Directory — use existing or create AWS Managed Microsoft AD.
    // RADIUS MFA is owned by the ManagedAd construct, so it can only be configured
    // when this construct creates the directory. RADIUS against an imported
    // directory is not supported here — configure it on the directory directly.
    const dir = props.directory;
    if (dir.existingDirectoryId) {
      if (props.infrastructure?.mfa?.radius) {
        throw new Error(
          'RADIUS MFA is only supported when this construct creates the directory ' +
            '(directory.createManagedAd). Configure RADIUS directly on the existing directory, ' +
            'or use directory.createManagedAd.',
        );
      }
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
      const managedAd = new ManagedAd(this, 'ManagedAD', {
        domainName: dir.adDomainName,
        password: dir.adAdminPassword,
        vpc: this.vpc,
        subnets: this.privateSubnets,
        shortName: dir.adShortName,
        radius: props.infrastructure?.mfa?.radius,
      });
      this.directoryId = managedAd.directoryId;
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
      const policyStatements: iam.PolicyStatement[] = [
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
      ];

      if (key) {
        policyStatements.unshift(
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
        );
      }

      const workspacesCustomPolicy = new iam.ManagedPolicy(
        this,
        'WorkspacesCustomPolicy',
        {
          managedPolicyName: `${stack.stackName}-workspaces-default-custom`,
          statements: policyStatements,
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

    // Directory registration — delegates to AwsWorkspacesDirectoryRegistration.
    // Can be reused independently of this construct for other directory registration scenarios.
    const directoryRegistration = new AwsWorkspacesDirectoryRegistration(
      this,
      'DirectoryRegistration',
      {
        directoryId: this.directoryId,
        subnets: this.privateSubnets,
        workspacesRole: this.workspacesRole,
      },
    );

    // Infrastructure layer — only created when props.infrastructure is provided
    if (props.infrastructure) {
      const infra = props.infrastructure;

      if (infra.mfa) {
        const mfa = infra.mfa;
        const mfaTypeCount = [
          mfa.radius,
          mfa.saml,
          mfa.certificateBased,
        ].filter(Boolean).length;
        if (mfaTypeCount !== 1) {
          throw new Error(
            'AwsWorkspacesInfrastructureProps.mfa: exactly one of radius, saml, or certificateBased must be set',
          );
        }

        // Authentication — SAML 2.0 or certificate-based auth. Both are applied
        // after directory registration; WorkSpaces evaluates these settings at
        // login time, not during workspace provisioning. RADIUS MFA is configured
        // on the directory itself by the ManagedAd construct, not here.
        if (mfa.saml) {
          const samlAuth = new AwsWorkspacesSamlAuth(this, 'SamlAuth', {
            directoryId: this.directoryId,
            userAccessUrl: mfa.saml.userAccessUrl,
            relayStateParameterName: mfa.saml.relayStateParameterName,
            status: mfa.saml.status,
          });
          samlAuth.node.addDependency(directoryRegistration);
        }

        if (mfa.certificateBased) {
          const certAuth = new AwsWorkspacesCertificateBasedAuth(
            this,
            'CertAuth',
            {
              directoryId: this.directoryId,
              certificateAuthorityArn:
                mfa.certificateBased.certificateAuthorityArn,
            },
          );
          certAuth.node.addDependency(directoryRegistration);
        }
      }

      // SSM Hybrid Activation — delegates to SsmHybridActivation.
      // Can be reused independently for non-WorkSpaces SSM hybrid activation scenarios.
      const ssmActivation = new SsmHybridActivation(this, 'SsmActivation', {
        roleName: `${stack.stackName}-ssm-hybrid-activation`,
        paramPrefix: this.ssmActivationParamPrefix,
        description: `${stack.stackName} WorkSpace golden image`,
        activationTags: infra.activationTags,
        registrationLimit: infra.activationRegistrationLimit,
        encryptionKey: key,
      });
      this.ssmHybridActivationRole = ssmActivation.hybridActivationRole;

      // SSM Patch Baseline — security-classified patches, Critical/Important severity, 7-day auto-approval.
      // The patchGroups property ties this baseline to AwsWorkspacesUser instances
      // tagged with Patch Group=<patchGroupName>.
      new ssm.CfnPatchBaseline(this, 'PatchBaseline', {
        name: `${stack.stackName}-workspaces-security`,
        operatingSystem:
          infra.operatingSystem ?? AwsWorkspaces.DEFAULT_PATCH_OS,
        description:
          'WorkSpaces patch baseline: Security classification, Critical/Important severity, 7-day auto-approval',
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
          targets: infra.packages.targets ?? [
            {key: 'InstanceIds', values: ['*']},
          ],
          parameters: {commands},
          scheduleExpression: 'rate(30 days)',
          applyOnlyAtCronInterval: false,
          complianceSeverity: 'MEDIUM',
          maxErrors: '1',
          maxConcurrency: '50%',
        });
      }

      // Revoke open-world ingress from all WorkSpaces-managed security groups.
      // The Nonce property intentionally embeds the current timestamp so CloudFormation
      // treats the resource as changed on every deploy, re-running the Lambda to catch
      // any open-world rules that WorkSpaces may have re-added since the last deploy.
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
