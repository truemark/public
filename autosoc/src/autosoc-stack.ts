import {CfnOutput, Duration} from 'aws-cdk-lib';
import {CfnWorkGroup} from 'aws-cdk-lib/aws-athena';
import {CfnDataLakeSettings} from 'aws-cdk-lib/aws-lakeformation';
import {BlockPublicAccess, Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsLogSourceName,
  type SecurityLakeSubscriberProps,
  StandardSecurityLake,
} from 'truemark-cdk-lib/aws-securitylake';
import {validateLakeFormationDataLakeAdmins} from './lake-formation-admins.js';
import {validateSecurityLakeExternalId} from './security-lake-external-id.js';

export type AutoSocSecurityLakeStackProps = ExtendedStackProps;

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

export class AutoSocSecurityLakeStack extends ExtendedStack {
  readonly securityLake: StandardSecurityLake;

  constructor(
    scope: Construct,
    id: string,
    props: AutoSocSecurityLakeStackProps = {},
  ) {
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
    // `siemSubscriberExternalId` are supplied, add a subscriber so the
    // separate `autosiem` package's es-loader (typically deployed in a
    // different account, e.g. security-audit) can read OCSF Parquet files
    // produced by Security Lake. The subscriber role ARN / external id /
    // notification queue ARN are published below as CfnOutputs for the
    // operator to copy into the `autosiem` deploy.
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
        subscriberName: 'autosiem',
        principal: siemSubscriberAccountId,
        externalId: siemSubscriberExternalId,
        description:
          'autosiem OpenSearch subscriber - consumes Security Lake OCSF Parquet via SQS notifications',
        sources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
        // aes-siem's es-loader Lambda has a 600s timeout. Security Lake
        // auto-provisions the subscriber Main-Queue with 300s, which is
        // less than the Lambda timeout and causes the es-loader event-
        // source-mapping to be rejected. The StandardSecurityLake
        // construct patches the queue via an AwsCustomResource so the
        // first `autosiem` deploy succeeds. See autosoc/README.md §1.
        sqsVisibilityTimeoutSeconds: 3600,
      });
    }

    this.securityLake = new StandardSecurityLake(this, 'SecurityLake', {
      createLakeFormationServiceLinkedRole: createLakeFormationSlr,
      logSources: DEFAULT_LOG_SOURCES.map((sourceName) => ({sourceName})),
      subscribers,
    });

    // Export subscriber details as CfnOutputs. Since `autosoc` and
    // `autosiem` are independent CDK apps/stacks (typically deployed into
    // different accounts, e.g. log-archive vs. security-audit), there is
    // no CloudFormation cross-stack export/Fn::ImportValue link between
    // them — copy these three values into the `autosiem` deploy's
    // `-c siemSecurityLake*` context flags (see autosiem/README.md).
    //
    // IMPORTANT: StandardSecurityLake's post-creation queue-visibility-
    // timeout patch (an AwsCustomResource that runs after the notification
    // resource is created, see standard-security-lake.ts) may still be in
    // flight when `AutoSocSecurityLake`'s deploy reaches CREATE_COMPLETE and
    // these outputs become readable. If you deploy `autosiem` immediately
    // after (e.g. scripted end-to-end), confirm `AutoSocSecurityLake` itself reached
    // CREATE_COMPLETE/UPDATE_COMPLETE before copying these values —
    // CloudFormation only reports the stack complete once every resource,
    // including the patch, has finished.
    if (this.securityLake.subscribers.length > 0) {
      const [subscriber] = this.securityLake.subscribers;
      const [notification] = this.securityLake.subscriberNotifications;
      new CfnOutput(this, 'SecurityLakeSubscriberRoleArn', {
        value: subscriber.attrSubscriberRoleArn,
        description:
          'IAM role ARN that the autosiem es-loader assumes to read Security Lake objects. Copy into autosiem -c siemSecurityLakeSubscriberRoleArn.',
        exportName: 'AutoSocSecurityLake-SecurityLakeSubscriberRoleArn',
      });
      new CfnOutput(this, 'SecurityLakeSubscriberExternalId', {
        value: siemSubscriberExternalId ?? '',
        description:
          'External id the autosiem es-loader must present when assuming the subscriber role. Copy into autosiem -c siemSecurityLakeSubscriberExternalId.',
        exportName: 'AutoSocSecurityLake-SecurityLakeSubscriberExternalId',
      });
      new CfnOutput(this, 'SecurityLakeSubscriberNotificationQueueArn', {
        value: notification.attrSubscriberEndpoint,
        description:
          'SQS queue ARN Security Lake writes new-object notifications to. Copy into autosiem -c siemSecurityLakeSubscriberSqsArn.',
        exportName:
          'AutoSocSecurityLake-SecurityLakeSubscriberNotificationQueueArn',
      });
    }

    // Optional Lake Formation data lake administrators. `MutationType:
    // APPEND` adds these principals to whatever administrators already
    // exist in the account (e.g. AmazonSecurityLakeMetaStoreManagerV2 and
    // the CDK bootstrap exec role, both registered automatically when
    // Security Lake's data lake was created) rather than replacing the
    // list outright — `AWS::LakeFormation::DataLakeSettings` with the
    // default `REPLACE` mutation type would otherwise silently revoke
    // every administrator not listed here on every deploy.
    const lakeFormationDataLakeAdmins = (
      this.node.tryGetContext('lakeFormationDataLakeAdmins') as
        | string
        | undefined
    )
      ?.split(',')
      .map((arn) => arn.trim())
      .filter((arn) => arn.length > 0);
    validateLakeFormationDataLakeAdmins(lakeFormationDataLakeAdmins);
    if (lakeFormationDataLakeAdmins && lakeFormationDataLakeAdmins.length > 0) {
      new CfnDataLakeSettings(this, 'LakeFormationDataLakeSettings', {
        admins: lakeFormationDataLakeAdmins.map((arn) => ({
          dataLakePrincipalIdentifier: arn,
        })),
        mutationType: 'APPEND',
      });
    }

    // S3 bucket for Athena query results, so humans with Lake Formation
    // query access (see autosoc/README.md) can run Athena against Security
    // Lake's tables without first having to hand-configure a results
    // location. A lifecycle rule expires result objects automatically —
    // they're cheap to regenerate by re-running the query — rather than
    // accumulating indefinitely; the bucket itself is retained on stack
    // deletion (CDK's default) since it's shared, account-wide Athena
    // infrastructure, not something scoped to this one stack's lifecycle.
    const athenaResultsBucket = new Bucket(this, 'AthenaResultsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'ExpireQueryResults',
          expiration: Duration.days(30),
        },
      ],
    });
    new CfnWorkGroup(this, 'AthenaSecurityLakeWorkGroup', {
      name: 'security-lake-queries',
      description:
        'Default Athena workgroup for querying Security Lake tables.',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/athena-results/`,
        },
        enforceWorkGroupConfiguration: true,
      },
    });
    new CfnOutput(this, 'AthenaResultsBucketName', {
      value: athenaResultsBucket.bucketName,
      description: 'S3 bucket Athena writes query results to.',
    });
    new CfnOutput(this, 'AthenaWorkGroupName', {
      value: 'security-lake-queries',
      description:
        'Athena workgroup pre-configured with the results bucket above.',
    });
  }
}
