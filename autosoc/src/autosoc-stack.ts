import {CfnOutput} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsLogSourceName,
  type SecurityLakeSubscriberProps,
  StandardSecurityLake,
} from 'truemark-cdk-lib/aws-securitylake';
import {
  AutoSocSiemConstruct,
  type AutoSocSiemConstructProps,
} from './autosoc-siem-stack.js';
import {validateSecurityLakeExternalId} from './security-lake-external-id.js';

/**
 * Props for the opt-in SIEM sub-construct, minus the Security Lake
 * subscriber wiring fields that `AutoSocStack` always derives itself from
 * its own `StandardSecurityLake` subscriber (when one was created).
 */
export type AutoSocSiemProps = Omit<
  AutoSocSiemConstructProps,
  | 'securityLakeSubscriberRoleArn'
  | 'securityLakeSubscriberExternalId'
  | 'securityLakeSubscriberSqsArn'
>;

export interface AutoSocStackProps extends ExtendedStackProps {
  /**
   * Opt-in SIEM configuration. When supplied, `AutoSocStack` nests the
   * upstream aes-siem CloudFormation template (via `AutoSocSiemConstruct`)
   * inside this same stack, alongside the Security Lake data lake. Omit
   * entirely to deploy Security Lake only.
   *
   * @default - SIEM is not deployed
   */
  readonly siem?: AutoSocSiemProps;
}

/**
 * The full set of AWS native log sources this stack enables on the data
 * lake. Also used by default when wiring a Security Lake subscriber so the
 * subscriber receives everything the lake ingests.
 */
const DEFAULT_LOG_SOURCES = [
  AwsLogSourceName.CLOUD_TRAIL_MGMT,
  AwsLogSourceName.LAMBDA_EXECUTION,
  AwsLogSourceName.S3_DATA,
  AwsLogSourceName.SH_FINDINGS,
  AwsLogSourceName.VPC_FLOW,
  AwsLogSourceName.ROUTE53,
  AwsLogSourceName.EKS_AUDIT,
  AwsLogSourceName.WAF,
] as const;

export class AutoSocStack extends ExtendedStack {
  readonly securityLake: StandardSecurityLake;

  /** Present only when `props.siem` was supplied. */
  readonly siem?: AutoSocSiemConstruct;

  constructor(scope: Construct, id: string, props: AutoSocStackProps = {}) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/autosoc',
    );
    const createLakeFormationSlr =
      this.node.tryGetContext('createLakeFormationSlr') === true ||
      this.node.tryGetContext('createLakeFormationSlr') === 'true';

    // Optional Security Lake subscriber. When `siemSubscriberAccountId` and
    // `siemSubscriberExternalId` are supplied, add a subscriber so the SIEM
    // es-loader (below, when `props.siem` is set) can read OCSF Parquet
    // files produced by Security Lake.
    const siemSubscriberAccountId = this.node.tryGetContext(
      'siemSubscriberAccountId',
    ) as string | undefined;
    const siemSubscriberExternalId = this.node.tryGetContext(
      'siemSubscriberExternalId',
    ) as string | undefined;
    validateSecurityLakeExternalId(siemSubscriberExternalId);
    const subscribers: SecurityLakeSubscriberProps[] = [];
    if (siemSubscriberAccountId && siemSubscriberExternalId) {
      subscribers.push({
        subscriberName: 'autosoc-siem',
        principal: siemSubscriberAccountId,
        externalId: siemSubscriberExternalId,
        description:
          'AutoSoc SIEM OpenSearch subscriber - consumes Security Lake OCSF Parquet via SQS notifications',
        sources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
        // aes-siem's es-loader Lambda has a 600s timeout. Security Lake
        // auto-provisions the subscriber Main-Queue with 300s, which is
        // less than the Lambda timeout and causes the es-loader event-
        // source-mapping to be rejected. The StandardSecurityLake
        // construct patches the queue via an AwsCustomResource so the
        // first SIEM deploy succeeds. See autosoc/README.md §1.
        sqsVisibilityTimeoutSeconds: 3600,
      });
    }

    this.securityLake = new StandardSecurityLake(this, 'SecurityLake', {
      createLakeFormationServiceLinkedRole: createLakeFormationSlr,
      logSources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
      subscribers,
    });

    // Export subscriber details as CfnOutputs for operator visibility, even
    // though AutoSocSiemConstruct (below) now consumes them directly as
    // construct references rather than via CloudFormation cross-stack
    // exports/Fn::ImportValue.
    if (this.securityLake.subscribers.length > 0) {
      const [subscriber] = this.securityLake.subscribers;
      const [notification] = this.securityLake.subscriberNotifications;
      new CfnOutput(this, 'SecurityLakeSubscriberRoleArn', {
        value: subscriber.attrSubscriberRoleArn,
        description:
          'IAM role ARN that the SIEM es-loader assumes to read Security Lake objects.',
        exportName: 'AutoSoc-SecurityLakeSubscriberRoleArn',
      });
      new CfnOutput(this, 'SecurityLakeSubscriberExternalId', {
        value: siemSubscriberExternalId ?? '',
        description:
          'External id the SIEM es-loader must present when assuming the subscriber role.',
        exportName: 'AutoSoc-SecurityLakeSubscriberExternalId',
      });
      new CfnOutput(this, 'SecurityLakeSubscriberNotificationQueueArn', {
        value: notification.attrSubscriberEndpoint,
        description:
          'SQS queue ARN Security Lake writes new-object notifications to.',
        exportName: 'AutoSoc-SecurityLakeSubscriberNotificationQueueArn',
      });
    }

    // Opt-in SIEM. Nested inside this same stack (as a CDK construct, not a
    // sibling CDK Stack) so the Security Lake subscriber role/external-id/
    // queue ARN can be wired in as direct construct references below,
    // instead of through CloudFormation cross-stack exports/Fn::ImportValue.
    if (props.siem) {
      const [subscriber] = this.securityLake.subscribers;
      const [notification] = this.securityLake.subscriberNotifications;
      this.siem = new AutoSocSiemConstruct(this, 'Siem', {
        ...props.siem,
        securityLakeSubscriberRoleArn: subscriber?.attrSubscriberRoleArn,
        securityLakeSubscriberExternalId: siemSubscriberExternalId,
        securityLakeSubscriberSqsArn: notification?.attrSubscriberEndpoint,
      });
    }
  }
}
