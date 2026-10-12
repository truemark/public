import {CfnStack, Fn} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';

/**
 * Version of the upstream aes-siem CloudFormation template nested by this
 * stack. The template is hosted by AWS Samples in a public S3 bucket per
 * Region: `aes-siem-<region>.s3.amazonaws.com`.
 *
 * @see https://github.com/aws-samples/siem-on-amazon-opensearch-service
 */
export const AES_SIEM_TEMPLATE_VERSION = '2.10.6';

/**
 * Properties for AutoSocSiemStack.
 */
export interface AutoSocSiemStackProps extends ExtendedStackProps {
  /**
   * Email address that will receive SNS alerts raised by OpenSearch /
   * aes-siem.
   */
  readonly snsEmail: string;

  /**
   * Optional MaxMind GeoLite2 license key enabling GeoIP enrichment inside
   * es-loader. Omit to deploy without geo enrichment.
   *
   * @default - no geo enrichment
   */
  readonly geoLite2LicenseKey?: string;

  /**
   * Space-delimited list of CIDR blocks allowed to reach OpenSearch
   * Dashboards. Used only on the initial deployment of aes-siem.
   *
   * @default '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16'
   */
  readonly allowedSourceIpAddresses?: string;

  /**
   * Where to deploy OpenSearch: managed cluster (default) or serverless
   * (experimental, per upstream).
   *
   * @default 'opensearch_managed_cluster'
   */
  readonly deploymentTarget?:
    | 'opensearch_managed_cluster'
    | 'opensearch_serverless';

  /**
   * OpenSearch domain or Serverless collection name.
   *
   * @default 'aes-siem'
   */
  readonly domainOrCollectionName?: string;

  /**
   * Reserved concurrency for the es-loader Lambda. Raise this if ingestion
   * backlogs appear in CloudWatch without errors.
   *
   * @default 10
   */
  readonly esLoaderReservedConcurrency?: number;

  /**
   * ARN of the Security Lake subscriber IAM role es-loader should assume
   * to read OCSF Parquet from the Security Lake buckets. Populated by
   * `AutoSocStack` when a subscriber was provisioned.
   *
   * @default - no Security Lake ingestion
   */
  readonly securityLakeSubscriberRoleArn?: string;

  /**
   * External id es-loader must present when assuming
   * `securityLakeSubscriberRoleArn`.
   *
   * @default - no Security Lake ingestion
   */
  readonly securityLakeSubscriberExternalId?: string;

  /**
   * ARN of the SQS queue Security Lake writes new-object notifications to.
   * aes-siem polls this queue to drive es-loader invocations.
   *
   * @default - no Security Lake ingestion
   */
  readonly securityLakeSubscriberSqsArn?: string;
}

/**
 * AutoSoc SIEM stack. Nests the upstream aes-siem CloudFormation template
 * (MIT-0, aws-samples/siem-on-amazon-opensearch-service) as-is so AutoSoc
 * users get OpenSearch, dashboards, es-loader, GeoIP enrichment, and the
 * supporting KMS/SQS/EventBridge/SNS infrastructure without rewriting any
 * of the Python Lambda source.
 *
 * When deployed alongside `AutoSocStack` with Security Lake subscriber
 * context set, aes-siem additionally ingests OCSF Parquet objects from
 * Security Lake via the subscriber SQS queue.
 *
 * @see https://github.com/aws-samples/siem-on-amazon-opensearch-service
 */
export class AutoSocSiemStack extends ExtendedStack {
  /**
   * The nested CloudFormation stack running the aes-siem template.
   */
  readonly siemNestedStack: CfnStack;

  constructor(scope: Construct, id: string, props: AutoSocSiemStackProps) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/autosoc',
    );
    this.addMetadata('AesSiemVersion', AES_SIEM_TEMPLATE_VERSION);

    // The upstream template is published per-Region in a public S3 bucket;
    // use the deploy Region's bucket so the signed-url embedded in Lambda
    // asset references resolves inside the account.
    // Build the Fn::Sub input so biome's `noTemplateCurlyInString` rule
    // (which flags `${...}` placeholders in plain strings) does not trip on
    // the CloudFormation `${AWS::Region}` pseudo-parameter. We escape the
    // `$` with `\x24` so the source text contains no `${`.
    const region = '\x24{AWS::Region}';
    const templateUrl = Fn.sub(
      `https://aes-siem-${region}.s3.${region}.amazonaws.com/siem-on-amazon-opensearch-service.template`,
    );

    this.siemNestedStack = new CfnStack(this, 'AesSiemNestedStack', {
      templateUrl,
      parameters: {
        DeploymentTarget:
          props.deploymentTarget ?? 'opensearch_managed_cluster',
        DomainOrCollectionName: props.domainOrCollectionName ?? 'aes-siem',
        AllowedSourceIpAddresses:
          props.allowedSourceIpAddresses ??
          '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',
        SnsEmail: props.snsEmail,
        GeoLite2LicenseKey: props.geoLite2LicenseKey ?? '',
        ReservedConcurrency: (
          props.esLoaderReservedConcurrency ?? 10
        ).toString(),
        // Security-Lake-specific wiring. All three empty => aes-siem runs
        // in native mode (log sources deliver to its own S3 bucket). All
        // three populated => aes-siem assumes the subscriber role, polls
        // the subscriber SQS queue, and ingests Security Lake OCSF Parquet.
        SecurityLakeRoleArn: props.securityLakeSubscriberRoleArn ?? '',
        SecurityLakeExternalId: props.securityLakeSubscriberExternalId ?? '',
        SecurityLakeSubscriberSqs: props.securityLakeSubscriberSqsArn ?? '',
      },
    });
  }
}
