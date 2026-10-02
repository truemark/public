import type {SecretValue} from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import * as directoryservice from 'aws-cdk-lib/aws-directoryservice';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Edition of an AWS Managed Microsoft AD directory.
 */
export type ManagedAdEdition = 'Standard' | 'Enterprise';

/**
 * RADIUS-based MFA configuration for a Managed Microsoft AD directory.
 * Requires a RADIUS server reachable from the directory's VPC.
 */
export interface ManagedAdRadiusProps {
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
   * Timeout in seconds for each RADIUS request. Must be between 1 and 20.
   *
   * @default 20
   */
  readonly radiusTimeout?: number;

  /**
   * Number of times a RADIUS request is retried after a timeout. Must be between 0 and 10.
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
 * Single sign-on configuration for a Managed Microsoft AD directory.
 * Enabling SSO allows users to access AWS applications and the directory access
 * URL without re-entering their credentials.
 */
export interface ManagedAdSsoProps {
  /**
   * Alias for the directory access URL — produces `https://<alias>.awsapps.com`.
   * Aliases are permanent: once created they cannot be changed or removed for the
   * lifetime of the directory.
   *
   * @default - no alias is created and SSO uses the directory ID URL
   */
  readonly alias?: string;
}

/**
 * CloudWatch Logs forwarding configuration for a Managed Microsoft AD directory.
 * Forwards the directory's security event logs to a CloudWatch log group.
 */
export interface ManagedAdLogForwardingProps {
  /**
   * Name of the CloudWatch log group that receives directory security logs.
   *
   * @default - an auto-generated name is used
   */
  readonly logGroupName?: string;

  /**
   * Retention period for the directory log group.
   *
   * @default logs.RetentionDays.ONE_YEAR
   */
  readonly retention?: logs.RetentionDays;

  /**
   * Removal policy for the log group when the directory is removed.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * Cross-account sharing configuration for a Managed Microsoft AD directory.
 * Shares the directory with other AWS accounts so they can launch directory-aware
 * resources (e.g. WorkSpaces) against it.
 */
export interface ManagedAdSharingProps {
  /**
   * AWS account IDs the directory is shared with.
   */
  readonly targetAccountIds: string[];

  /**
   * Sharing method. Use ORGANIZATIONS to share within an AWS Organization without
   * a handshake, or HANDSHAKE to send a sharing request the target must accept.
   *
   * @default 'HANDSHAKE'
   */
  readonly shareMethod?: 'ORGANIZATIONS' | 'HANDSHAKE';

  /**
   * A directory share message sent to the target accounts (HANDSHAKE only).
   *
   * @default - no message
   */
  readonly shareNotes?: string;
}

/**
 * Properties for ManagedAd.
 */
export interface ManagedAdProps extends ExtendedConstructProps {
  /**
   * Fully qualified domain name for the directory. Example: 'corp.example.com'.
   */
  readonly domainName: string;

  /**
   * Admin password for the directory. Should come from Secrets Manager.
   * Use SecretValue.secretsManager() — do not use unsafePlainText in production.
   */
  readonly password: SecretValue;

  /**
   * VPC the directory controllers are deployed into.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Subnets the directory controllers are placed in. At least two subnets in
   * different Availability Zones are required; only the first two are used.
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * Short NetBIOS name for the directory. Example: 'CORP'.
   *
   * @default - derived by AWS from the domain name
   */
  readonly shortName?: string;

  /**
   * Edition of the Managed Microsoft AD.
   *
   * @default 'Standard'
   */
  readonly edition?: ManagedAdEdition;

  /**
   * RADIUS-based multi-factor authentication configuration.
   *
   * @default - RADIUS MFA is not enabled
   */
  readonly radius?: ManagedAdRadiusProps;

  /**
   * Single sign-on configuration.
   *
   * @default - SSO is not enabled
   */
  readonly sso?: ManagedAdSsoProps;

  /**
   * CloudWatch Logs forwarding configuration.
   *
   * @default - directory logs are not forwarded
   */
  readonly logForwarding?: ManagedAdLogForwardingProps;

  /**
   * Cross-account sharing configuration.
   *
   * @default - the directory is not shared
   */
  readonly sharing?: ManagedAdSharingProps;
}

/**
 * Creates an AWS Managed Microsoft AD directory.
 *
 * Wraps the L1 {@link directoryservice.CfnMicrosoftAD} with TrueMark standard
 * tagging and validation, and layers on optional RADIUS MFA, single sign-on,
 * CloudWatch log forwarding, and cross-account sharing — each implemented with
 * custom resources because they have no native CloudFormation support.
 *
 * The resulting {@link directoryId} can be consumed by directory-aware constructs
 * such as Amazon WorkSpaces.
 */
export class ManagedAd extends ExtendedConstruct {
  /**
   * The underlying CloudFormation Managed Microsoft AD resource.
   */
  readonly microsoftAd: directoryservice.CfnMicrosoftAD;

  /**
   * The directory ID, e.g. 'd-xxxxxxxxxx'.
   */
  readonly directoryId: string;

  /**
   * The CloudWatch log group receiving directory security logs.
   * Only set when logForwarding is configured.
   */
  readonly logGroup?: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: ManagedAdProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    if (props.subnets.length < 2) {
      throw new Error(
        'At least 2 subnets in different AZs are required for Managed AD',
      );
    }

    this.microsoftAd = new directoryservice.CfnMicrosoftAD(this, 'Resource', {
      name: props.domainName,
      // unsafeUnwrap is required — CfnMicrosoftAD expects a plain string, not a SecretValue token
      password: props.password.unsafeUnwrap(),
      vpcSettings: {
        vpcId: props.vpc.vpcId,
        subnetIds: props.subnets.slice(0, 2).map((subnet) => subnet.subnetId),
      },
      edition: props.edition ?? 'Standard',
      shortName: props.shortName,
    });
    this.directoryId = this.microsoftAd.ref;

    if (props.radius) {
      this.enableRadius(props.radius);
    }
    if (props.sso) {
      this.enableSso(props.sso);
    }
    if (props.logForwarding) {
      this.logGroup = this.enableLogForwarding(props.logForwarding);
    }
    if (props.sharing) {
      this.enableSharing(props.sharing);
    }
  }

  /**
   * Enables RADIUS MFA on the directory via the Directory Service API.
   */
  private enableRadius(radius: ManagedAdRadiusProps): void {
    const {radiusTimeout, radiusRetries} = radius;
    if (
      radiusTimeout !== undefined &&
      (radiusTimeout < 1 || radiusTimeout > 20)
    ) {
      throw new Error(
        `ManagedAdRadiusProps.radiusTimeout must be between 1 and 20 seconds (got ${radiusTimeout})`,
      );
    }
    if (
      radiusRetries !== undefined &&
      (radiusRetries < 0 || radiusRetries > 10)
    ) {
      throw new Error(
        `ManagedAdRadiusProps.radiusRetries must be between 0 and 10 (got ${radiusRetries})`,
      );
    }

    const radiusSettings = {
      AuthenticationProtocol: radius.authenticationProtocol ?? 'MS-CHAPv2',
      DisplayLabel: radius.displayLabel ?? 'MFA',
      RadiusPort: radius.radiusPort ?? 1812,
      RadiusRetries: radius.radiusRetries ?? 0,
      RadiusServers: radius.radiusServers,
      RadiusTimeout: radius.radiusTimeout ?? 20,
      // unsafeUnwrap resolves to a CloudFormation dynamic reference; CloudFormation
      // resolves it before invoking the custom resource Lambda.
      SharedSecret: radius.sharedSecret.unsafeUnwrap(),
      UseSameUsername: radius.useSameUsername ?? false,
    };

    new cr.AwsCustomResource(this, 'Radius', {
      onCreate: {
        service: 'DirectoryService',
        action: 'EnableRadius',
        parameters: {
          DirectoryId: this.directoryId,
          RadiusSettings: radiusSettings,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.node.id}-radius`),
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
        physicalResourceId: cr.PhysicalResourceId.of(`${this.node.id}-radius`),
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
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ds:EnableRadius', 'ds:UpdateRadius', 'ds:DisableRadius'],
          resources: ['*'],
        }),
      ]),
    });
  }

  /**
   * Enables single sign-on and, if requested, creates the directory access URL alias.
   */
  private enableSso(sso: ManagedAdSsoProps): void {
    if (sso.alias) {
      // CreateAlias is irreversible — no onDelete is provided.
      new cr.AwsCustomResource(this, 'Alias', {
        onCreate: {
          service: 'DirectoryService',
          action: 'CreateAlias',
          parameters: {DirectoryId: this.directoryId, Alias: sso.alias},
          physicalResourceId: cr.PhysicalResourceId.of(`${this.node.id}-alias`),
          // EntityAlreadyExistsException: alias already set — treat as no-op.
          ignoreErrorCodesMatching: 'EntityAlreadyExistsException',
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ds:CreateAlias'],
            resources: ['*'],
          }),
        ]),
      });
    }

    new cr.AwsCustomResource(this, 'Sso', {
      onCreate: {
        service: 'DirectoryService',
        action: 'EnableSso',
        parameters: {DirectoryId: this.directoryId},
        physicalResourceId: cr.PhysicalResourceId.of(`${this.node.id}-sso`),
      },
      onUpdate: {
        service: 'DirectoryService',
        action: 'EnableSso',
        parameters: {DirectoryId: this.directoryId},
        physicalResourceId: cr.PhysicalResourceId.of(`${this.node.id}-sso`),
      },
      onDelete: {
        service: 'DirectoryService',
        action: 'DisableSso',
        parameters: {DirectoryId: this.directoryId},
        ignoreErrorCodesMatching:
          'EntityDoesNotExistException|UnsupportedOperationException',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ds:EnableSso', 'ds:DisableSso'],
          resources: ['*'],
        }),
      ]),
    });
  }

  /**
   * Creates a CloudWatch log group and subscribes the directory's security logs to it.
   */
  private enableLogForwarding(
    cfg: ManagedAdLogForwardingProps,
  ): logs.ILogGroup {
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: cfg.logGroupName,
      retention: cfg.retention ?? logs.RetentionDays.ONE_YEAR,
      removalPolicy: cfg.removalPolicy ?? RemovalPolicy.RETAIN,
    });

    // Directory Service writes log events to the group on behalf of the directory,
    // so the group needs a resource policy granting the service principal access.
    new logs.ResourcePolicy(this, 'LogResourcePolicy', {
      policyStatements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ServicePrincipal('ds.amazonaws.com')],
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${logGroup.logGroupArn}:*`],
        }),
      ],
    });

    const subscription = new cr.AwsCustomResource(this, 'LogSubscription', {
      onCreate: {
        service: 'DirectoryService',
        action: 'CreateLogSubscription',
        parameters: {
          DirectoryId: this.directoryId,
          LogGroupName: logGroup.logGroupName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `${this.node.id}-log-subscription`,
        ),
        ignoreErrorCodesMatching: 'EntityAlreadyExistsException',
      },
      onDelete: {
        service: 'DirectoryService',
        action: 'DeleteLogSubscription',
        parameters: {DirectoryId: this.directoryId},
        ignoreErrorCodesMatching: 'EntityDoesNotExistException',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ds:CreateLogSubscription',
            'ds:DeleteLogSubscription',
            // Required by CreateLogSubscription to validate the destination group.
            'logs:DescribeLogGroups',
          ],
          resources: ['*'],
        }),
      ]),
    });
    // The group and its resource policy must exist before the subscription is created.
    subscription.node.addDependency(logGroup);

    return logGroup;
  }

  /**
   * Shares the directory with the configured target accounts.
   */
  private enableSharing(sharing: ManagedAdSharingProps): void {
    const shareMethod = sharing.shareMethod ?? 'HANDSHAKE';
    for (const accountId of sharing.targetAccountIds) {
      new cr.AwsCustomResource(this, `Share${accountId}`, {
        onCreate: {
          service: 'DirectoryService',
          action: 'ShareDirectory',
          parameters: {
            DirectoryId: this.directoryId,
            ShareMethod: shareMethod,
            ShareTarget: {Id: accountId, Type: 'ACCOUNT'},
            ...(sharing.shareNotes ? {ShareNotes: sharing.shareNotes} : {}),
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${this.node.id}-share-${accountId}`,
          ),
          ignoreErrorCodesMatching:
            'DirectoryAlreadySharedException|EntityAlreadyExistsException',
        },
        onDelete: {
          service: 'DirectoryService',
          action: 'UnshareDirectory',
          parameters: {
            DirectoryId: this.directoryId,
            UnshareTarget: {Id: accountId, Type: 'ACCOUNT'},
          },
          ignoreErrorCodesMatching:
            'DirectoryNotSharedException|EntityDoesNotExistException',
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ds:ShareDirectory', 'ds:UnshareDirectory'],
            resources: ['*'],
          }),
        ]),
      });
    }
  }
}
