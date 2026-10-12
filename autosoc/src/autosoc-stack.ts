import {CfnOutput} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsLogSourceName,
  type SecurityLakeSubscriberProps,
  StandardSecurityLake,
} from 'truemark-cdk-lib/aws-securitylake';

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

  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
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
    // `siemSubscriberExternalId` are supplied (typically via the sibling
    // `AutoSocSiemStack` wiring), add a subscriber so the SIEM es-loader
    // can read OCSF Parquet files produced by Security Lake.
    const siemSubscriberAccountId = this.node.tryGetContext(
      'siemSubscriberAccountId',
    ) as string | undefined;
    const siemSubscriberExternalId = this.node.tryGetContext(
      'siemSubscriberExternalId',
    ) as string | undefined;
    const subscribers: SecurityLakeSubscriberProps[] = [];
    if (siemSubscriberAccountId && siemSubscriberExternalId) {
      subscribers.push({
        subscriberName: 'autosoc-siem',
        principal: siemSubscriberAccountId,
        externalId: siemSubscriberExternalId,
        description:
          'AutoSoc SIEM (OpenSearch) subscriber - consumes Security Lake OCSF Parquet via SQS notifications.',
        sources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
      });
    }

    this.securityLake = new StandardSecurityLake(this, 'SecurityLake', {
      createLakeFormationServiceLinkedRole: createLakeFormationSlr,
      logSources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
      subscribers,
    });

    // Export subscriber details so AutoSocSiemStack (or operators) can feed
    // them into the aes-siem CloudFormation parameters.
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
  }
}
