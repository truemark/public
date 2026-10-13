import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Annotations, CfnStack, Fn} from 'aws-cdk-lib';
import {Asset} from 'aws-cdk-lib/aws-s3-assets';
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
 * Path (relative to this file) where a vendored copy of the aes-siem
 * CloudFormation template can be dropped. When present, the stack packages
 * it as a CDK S3 asset instead of pointing at the upstream public bucket.
 * See `scripts/vendor-aes-siem.sh` to populate this directory.
 */
const VENDORED_TEMPLATE_RELATIVE_PATH = '../vendor/aes-siem/siem.yaml';

/**
 * How this stack sources the aes-siem CloudFormation template.
 */
export enum AesSiemTemplateSource {
  /**
   * Reference the upstream public S3 template URL (default). Zero
   * maintenance; cannot be edited.
   *
   * **Important:** the upstream public URL
   * `https://aes-siem-<region>.s3.amazonaws.com/siem-on-amazon-opensearch-service.template`
   * is a *latest* alias — it is not pinned to
   * {@link AES_SIEM_TEMPLATE_VERSION} and has no S3 `versionId`. If
   * aws-samples publishes a new release, the next CloudFormation
   * deployment will pick it up even if nothing changed in this repo.
   *
   * For reproducible, version-locked deployments use
   * {@link AesSiemTemplateSource.VENDORED} with
   * `pnpm run vendor:aes-siem`, which verifies the downloaded template
   * header matches {@link AES_SIEM_TEMPLATE_VERSION} before packaging it
   * as a CDK S3 asset.
   */
  UPSTREAM = 'upstream',

  /**
   * Package a vendored template at `autosoc/vendor/aes-siem/siem.yaml` as
   * a CDK S3 asset. Use this when you need to patch the template (add
   * resources, tweak IAM, swap Lambda code, etc.). Populate the file via
   * `pnpm run vendor:aes-siem`.
   */
  VENDORED = 'vendored',
}

/**
 * Properties for AutoSocSiemStack.
 *
 * The upstream aes-siem template exposes ~22 CloudFormation parameters;
 * every one that is realistic to tweak from CDK is surfaced here. Unset
 * props fall through to the upstream template defaults.
 */
export interface AutoSocSiemStackProps extends ExtendedStackProps {
  // ─── Required ──────────────────────────────────────────────────────────

  /**
   * Email address that will receive SNS alerts raised by OpenSearch /
   * aes-siem.
   */
  readonly snsEmail: string;

  // ─── Template source ───────────────────────────────────────────────────

  /**
   * How to load the aes-siem CloudFormation template.
   *
   * @default AesSiemTemplateSource.UPSTREAM
   */
  readonly templateSource?: AesSiemTemplateSource;

  // ─── OpenSearch deployment shape ───────────────────────────────────────

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
   * VPC endpoint id (`vpce-…` for managed cluster, `aos-…` for Serverless)
   * that fronts OpenSearch. When set, several es-loader resources are
   * placed in the owning VPC. Create the endpoint manually before deploy.
   *
   * @default - OpenSearch has a public endpoint
   */
  readonly vpcEndpointId?: string;

  /**
   * Space-delimited list of CIDR blocks allowed to reach OpenSearch
   * Dashboards. Used only on the initial deployment of aes-siem.
   *
   * @default '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16'
   */
  readonly allowedSourceIpAddresses?: string;

  // ─── es-loader runtime ─────────────────────────────────────────────────

  /**
   * Reserved concurrency for the es-loader Lambda. Raise this if ingestion
   * backlogs appear in CloudWatch without errors.
   *
   * @default 10
   */
  readonly esLoaderReservedConcurrency?: number;

  /**
   * Space-delimited list of trusted ELB / CDN / proxy IPs. Enables
   * X-Forwarded-For analysis on web access logs so the client IP is
   * selected over the ELB IP.
   *
   * @default '127.0.0.1/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16'
   */
  readonly trustedProxyIpList?: string;

  /**
   * `update_and_override` (upstream default) will overwrite the log S3
   * bucket policy on every deploy. Set to `keep` if you manage the policy
   * yourself after the first deploy.
   *
   * @default 'update_and_override'
   */
  readonly logBucketPolicyUpdate?: 'update_and_override' | 'keep';

  // ─── Enrichment ────────────────────────────────────────────────────────

  /**
   * MaxMind GeoLite2 license key enabling GeoIP enrichment inside
   * es-loader. Omit to deploy without geo enrichment.
   *
   * @default - no geo enrichment
   */
  readonly geoLite2LicenseKey?: string;

  /**
   * AlienVault OTX API key. When set, es-loader downloads IOCs on the
   * schedule given by {@link iocDownloadIntervalMinutes}.
   *
   * @default - OTX IOC feed disabled
   */
  readonly otxApiKey?: string;

  /**
   * Download the Tor exit-node list as an IOC feed.
   *
   * @default false
   */
  readonly enableTor?: boolean;

  /**
   * Download abuse.ch Feodo blocklist as an IOC feed.
   *
   * @default false
   */
  readonly enableAbuseCh?: boolean;

  /**
   * IOC refresh interval in minutes. Minimum 30, maximum 10080 (7 days).
   *
   * @default 720
   */
  readonly iocDownloadIntervalMinutes?: number;

  // ─── Multi-account: AWS Control Tower ──────────────────────────────────

  /**
   * S3 bucket names in the Log Archive account (e.g.
   * `aws-controltower-logs-123456789012-us-east-1`). Grants es-loader
   * cross-account read access.
   *
   * @default - no Control Tower buckets
   */
  readonly controlTowerLogBucketNames?: string[];

  /**
   * IAM role ARN in the Log Archive account that es-loader assumes to read
   * Control Tower log buckets.
   *
   * @default - no Control Tower cross-account role
   */
  readonly controlTowerRoleArnForEsLoader?: string;

  /**
   * SQS queue ARN in the Log Archive account that fans out S3 notifications
   * to es-loader for Control Tower log buckets.
   *
   * @default - no Control Tower SQS fan-out
   */
  readonly controlTowerSqsForLogBuckets?: string;

  // ─── Multi-account: Amazon Security Lake subscriber ────────────────────

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

  // ─── VPC endpoint provisioning (only when `vpcEndpointId` is set) ──────

  /** Create a new SQS VPC endpoint alongside the SIEM. @default true */
  readonly createSqsVpcEndpoint?: boolean;
  /** Create a new Systems Manager VPC endpoint. @default true */
  readonly createSsmVpcEndpoint?: boolean;
  /** Create a new STS VPC endpoint. @default true */
  readonly createStsVpcEndpoint?: boolean;
  /** Create a new S3 VPC endpoint. @default true */
  readonly createS3VpcEndpoint?: boolean;
}

/**
 * AutoSoc SIEM stack. Nests the upstream aes-siem CloudFormation template
 * (MIT-0, aws-samples/siem-on-amazon-opensearch-service) so AutoSoc users
 * get OpenSearch, dashboards, es-loader, GeoIP enrichment, and the
 * supporting KMS/SQS/EventBridge/SNS infrastructure without rewriting any
 * of the Python Lambda source.
 *
 * When deployed alongside `AutoSocStack` with Security Lake subscriber
 * context set, aes-siem additionally ingests OCSF Parquet objects from
 * Security Lake via the subscriber SQS queue.
 *
 * To customize the aes-siem template itself (patch IAM, swap Lambda code,
 * add resources inside the nested stack, etc.), run
 * `pnpm run vendor:aes-siem` to drop a local copy under
 * `autosoc/vendor/aes-siem/`, edit it, then set
 * `templateSource: AesSiemTemplateSource.VENDORED`.
 *
 * @see https://github.com/aws-samples/siem-on-amazon-opensearch-service
 */
export class AutoSocSiemStack extends ExtendedStack {
  /** The nested CloudFormation stack running the aes-siem template. */
  readonly siemNestedStack: CfnStack;

  /** Resolved source of the aes-siem template that was packaged. */
  readonly templateSource: AesSiemTemplateSource;

  constructor(scope: Construct, id: string, props: AutoSocSiemStackProps) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/autosoc',
    );
    this.addMetadata('AesSiemVersion', AES_SIEM_TEMPLATE_VERSION);
    this.templateSource =
      props.templateSource ?? AesSiemTemplateSource.UPSTREAM;
    this.addMetadata('AesSiemTemplateSource', this.templateSource);
    if (this.templateSource === AesSiemTemplateSource.UPSTREAM) {
      Annotations.of(this).addWarningV2(
        'AutoSocSiem:UpstreamTemplateNotPinned',
        `AutoSocSiemStack is pointing at the aes-siem upstream public ` +
          `template URL, which is a latest-tracking alias and NOT pinned to ` +
          `AES_SIEM_TEMPLATE_VERSION (${AES_SIEM_TEMPLATE_VERSION}). A fresh ` +
          `deployment may pull a newer upstream release. Use ` +
          `templateSource=VENDORED (pnpm run vendor:aes-siem) for ` +
          `reproducible, version-locked deployments.`,
      );
    }

    this.siemNestedStack = new CfnStack(this, 'AesSiemNestedStack', {
      templateUrl: this.resolveTemplateUrl(),
      parameters: buildAesSiemParameters(props),
    });
  }

  /**
   * Resolve the template URL based on {@link AutoSocSiemStackProps.templateSource}.
   * For `UPSTREAM`, builds a per-Region public bucket URL via Fn::Sub. For
   * `VENDORED`, packages the on-disk template as a CDK S3 asset.
   */
  private resolveTemplateUrl(): string {
    if (this.templateSource === AesSiemTemplateSource.VENDORED) {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const vendored = path.resolve(here, VENDORED_TEMPLATE_RELATIVE_PATH);
      if (!fs.existsSync(vendored)) {
        throw new Error(
          `AutoSocSiemStack: templateSource is VENDORED but ${vendored} ` +
            'does not exist. Run `pnpm run vendor:aes-siem` to download ' +
            'the upstream template, or set templateSource to UPSTREAM.',
        );
      }
      const asset = new Asset(this, 'AesSiemVendoredTemplate', {
        path: vendored,
      });
      return asset.httpUrl;
    }

    // The upstream template is published per-Region in a public S3 bucket.
    // Build the Fn::Sub input so biome's `noTemplateCurlyInString` rule
    // (which flags `${...}` placeholders in plain strings) does not trip
    // on the CloudFormation `${AWS::Region}` pseudo-parameter. The `$` is
    // escaped with `\x24` so the source text contains no `${`.
    const region = '\x24{AWS::Region}';
    return Fn.sub(
      `https://aes-siem-${region}.s3.${region}.amazonaws.com/siem-on-amazon-opensearch-service.template`,
    );
  }
}

/**
 * Translate the strongly-typed props into the upstream aes-siem template's
 * CloudFormation parameter map. Values are coerced to strings because
 * `CfnStack.parameters` only accepts `{[k: string]: string}`.
 */
function buildAesSiemParameters(
  props: AutoSocSiemStackProps,
): Record<string, string> {
  const bool = (v: boolean | undefined, def: boolean) =>
    (v ?? def) ? 'true' : 'false';
  return {
    // OpenSearch deployment shape
    DeploymentTarget: props.deploymentTarget ?? 'opensearch_managed_cluster',
    DomainOrCollectionName: props.domainOrCollectionName ?? 'aes-siem',
    VpcEndpointId: props.vpcEndpointId ?? '',
    AllowedSourceIpAddresses:
      props.allowedSourceIpAddresses ??
      '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',

    // es-loader runtime
    SnsEmail: props.snsEmail,
    ReservedConcurrency: (props.esLoaderReservedConcurrency ?? 10).toString(),
    TrustedProxyIpList:
      props.trustedProxyIpList ??
      '127.0.0.1/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',
    LogBucketPolicyUpdate: props.logBucketPolicyUpdate ?? 'update_and_override',

    // Enrichment
    GeoLite2LicenseKey: props.geoLite2LicenseKey ?? '',
    OtxApiKey: props.otxApiKey ?? '',
    EnableTor: bool(props.enableTor, false),
    EnableAbuseCh: bool(props.enableAbuseCh, false),
    IocDownloadInterval: (props.iocDownloadIntervalMinutes ?? 720).toString(),

    // Multi-account: Control Tower
    ControlTowerLogBucketNameList: (
      props.controlTowerLogBucketNames ?? []
    ).join(','),
    ControlTowerRoleArnForEsLoader: props.controlTowerRoleArnForEsLoader ?? '',
    ControlTowerSqsForLogBuckets: props.controlTowerSqsForLogBuckets ?? '',

    // Multi-account: Security Lake. All three empty => aes-siem runs in
    // native mode. All three populated => aes-siem assumes the subscriber
    // role and polls the subscriber SQS queue for OCSF Parquet.
    SecurityLakeRoleArn: props.securityLakeSubscriberRoleArn ?? '',
    SecurityLakeExternalId: props.securityLakeSubscriberExternalId ?? '',
    SecurityLakeSubscriberSqs: props.securityLakeSubscriberSqsArn ?? '',

    // VPC endpoint provisioning (consumed only when vpcEndpointId is set)
    CreateSqsVpcEndpoint: bool(props.createSqsVpcEndpoint, true),
    CreateSsmVpcEndpoint: bool(props.createSsmVpcEndpoint, true),
    CreateStsVpcEndpoint: bool(props.createStsVpcEndpoint, true),
    CreateS3VpcEndpoint: bool(props.createS3VpcEndpoint, true),
  };
}
