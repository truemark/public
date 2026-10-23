import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  Annotations,
  CfnCondition,
  CfnParameter,
  CfnStack,
  Fn,
  Stack,
} from 'aws-cdk-lib';
import {Asset} from 'aws-cdk-lib/aws-s3-assets';
import {Construct} from 'constructs';
import {validateSecurityLakeExternalId} from './security-lake-external-id.js';

/**
 * Version of the upstream aes-siem CloudFormation template nested by this
 * stack. The template is hosted by AWS Samples in a public S3 bucket per
 * Region: `aes-siem-<region>.s3.amazonaws.com`.
 *
 * @see https://github.com/aws-samples/siem-on-amazon-opensearch-service
 */
export const AES_SIEM_TEMPLATE_VERSION = '2.10.6';

/**
 * Directory (relative to this file) containing the versioned aes-siem
 * CloudFormation template packaged as a CDK S3 asset.
 */
const VENDORED_TEMPLATE_RELATIVE_PATH = '../vendor/aes-siem';
const COMMERCIAL_TEMPLATE_FILE_NAME =
  'siem-on-amazon-opensearch-service.template';
const CHINA_TEMPLATE_FILE_NAME =
  'siem-on-amazon-opensearch-service-china.template';

/**
 * How this stack sources the aes-siem CloudFormation template.
 */
export enum AesSiemTemplateSource {
  /**
   * Reference the upstream public S3 template URL. This URL tracks the
   * latest upstream version and is not reproducible. This is the default
   * source — a plain `cdk deploy AutoSoc` with no `siemTemplateSource`
   * flag always pulls the current AWS-published template.
   *
   * **Important:** the upstream public URL
   * `https://aes-siem-<region>.s3.amazonaws.com/siem-on-amazon-opensearch-service.template`
   * is a *latest* alias — it is not pinned to
   * {@link AES_SIEM_TEMPLATE_VERSION} and has no S3 `versionId`. If
   * aws-samples publishes a new release, the next CloudFormation
   * deployment will pick it up even if nothing changed in this repo.
   *
   * **Security note:** the raw upstream template does not mark its
   * `GeoLite2LicenseKey` / `OtxApiKey` parameters `NoEcho`, so if you fill
   * in either value at deploy time, it is visible in the nested stack's
   * own parameters via `DescribeStacks`/console even though this
   * construct's own parent parameters are `NoEcho`. Pass
   * {@link AesSiemTemplateSource.VENDORED} to get the `NoEcho`-patched,
   * pinned release template instead. Run `pnpm run vendor:aes-siem` to
   * download the exact release tag and verify its header before packaging
   * it as a CDK S3 asset.
   */
  UPSTREAM = 'upstream',

  /**
   * Package the versioned template at
   * `autosoc/vendor/aes-siem/<templateFileName>` as a CDK S3 asset. This
   * is reproducible, has `NoEcho: true` patched onto its
   * `GeoLite2LicenseKey` / `OtxApiKey` parameters (see
   * `scripts/vendor-aes-siem.sh`), and is how you customize the template
   * itself (add resources, tweak IAM, swap Lambda code, etc.) — pass
   * `-c siemTemplateSource=vendored` to opt into it.
   */
  VENDORED = 'vendored',
}

/**
 * Properties for AutoSocSiemConstruct.
 *
 * The upstream aes-siem template exposes ~22 CloudFormation parameters;
 * every one that is realistic to tweak from CDK is surfaced here. Unset
 * props fall through to the upstream template defaults.
 */
export interface AutoSocSiemConstructProps {
  /**
   * Email address that will receive SNS alerts raised by OpenSearch /
   * aes-siem. Optional, matching the upstream template's own `SnsEmail`
   * parameter: when omitted, the upstream template's `HasSnsEmail`
   * condition evaluates false and no SNS topic/subscription is created at
   * all, so there is nothing to receive (or unsubscribe from).
   *
   * @default - no SNS alerting is configured
   */
  readonly snsEmail?: string;

  // ─── Template source ───────────────────────────────────────────────────

  /**
   * How to load the aes-siem CloudFormation template.
   *
   * @default AesSiemTemplateSource.UPSTREAM
   */
  readonly templateSource?: AesSiemTemplateSource;

  /**
   * Explicit template filename override. When omitted, the stack selects
   * the commercial or China template based on `AWS::Partition`. GovCloud
   * operators should select
   * `siem-on-amazon-opensearch-service-usgov.template` and use the
   * vendored source.
   */
  readonly upstreamTemplateFileName?: string;

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
 * AutoSoc SIEM construct. Nests the upstream aes-siem CloudFormation
 * template (MIT-0, aws-samples/siem-on-amazon-opensearch-service) as a
 * child `AWS::CloudFormation::Stack` of whatever parent stack this
 * construct is placed in, so AutoSoc users get OpenSearch, dashboards,
 * es-loader, GeoIP enrichment, and the supporting
 * KMS/SQS/EventBridge/SNS infrastructure without rewriting any of the
 * Python Lambda source.
 *
 * When placed inside `AutoSocStack` with Security Lake subscriber props
 * set, aes-siem additionally ingests OCSF Parquet objects from Security
 * Lake via the subscriber SQS queue. Being a construct (not a separate
 * top-level CDK `Stack`) rather than a sibling stack means the Security
 * Lake subscriber role/external-id/queue ARN can be threaded in directly
 * as construct references instead of through CloudFormation cross-stack
 * exports/`Fn::ImportValue`.
 *
 * To customize the aes-siem template itself (patch IAM, swap Lambda code,
 * add resources inside the nested stack, etc.), run
 * `pnpm run vendor:aes-siem` to drop a local copy under
 * `autosoc/vendor/aes-siem/`, edit it, then set
 * `templateSource: AesSiemTemplateSource.VENDORED`.
 *
 * @see https://github.com/aws-samples/siem-on-amazon-opensearch-service
 */
export class AutoSocSiemConstruct extends Construct {
  /** The nested CloudFormation stack running the aes-siem template. */
  readonly siemNestedStack: CfnStack;

  /** Resolved source of the aes-siem template that was packaged. */
  readonly templateSource: AesSiemTemplateSource;

  private readonly templateFileNameOverride?: string;

  constructor(scope: Construct, id: string, props: AutoSocSiemConstructProps) {
    super(scope, id);
    validateSecurityLakeExternalId(props.securityLakeSubscriberExternalId);
    this.templateFileNameOverride = props.upstreamTemplateFileName;
    const parentStack = Stack.of(this);
    parentStack.addMetadata('AesSiemVersion', AES_SIEM_TEMPLATE_VERSION);
    this.templateSource =
      props.templateSource ?? AesSiemTemplateSource.UPSTREAM;
    parentStack.addMetadata('AesSiemTemplateSource', this.templateSource);
    if (this.templateSource === AesSiemTemplateSource.UPSTREAM) {
      Annotations.of(this).addWarningV2(
        'AutoSocSiem:UpstreamTemplateNotPinned',
        `AutoSocSiemConstruct is pointing at the aes-siem upstream public ` +
          `template URL (the default), which is a latest-tracking alias ` +
          `and NOT pinned to AES_SIEM_TEMPLATE_VERSION ` +
          `(${AES_SIEM_TEMPLATE_VERSION}). A fresh deployment may pull a ` +
          `newer upstream release. Pass templateSource=VENDORED ` +
          `(pnpm run vendor:aes-siem) for reproducible, version-locked ` +
          `deployments or to customize the template.`,
      );
      // The raw upstream template does not mark `GeoLite2LicenseKey` /
      // `OtxApiKey` as `NoEcho`, so even though this stack's own
      // `GeoLite2LicenseKey` / `OtxApiKey` parent parameters below are
      // NoEcho, the nested stack's own parameters (and therefore
      // `DescribeStacks`/console output on *that* stack) will show the
      // plaintext value whenever an operator fills them in at deploy
      // time. This can't be checked at synth time (the values are
      // deploy-time CloudFormation parameter inputs, not CDK props), so
      // warn unconditionally whenever UPSTREAM is selected (the default).
      // The VENDORED template source patches `NoEcho: true` onto both
      // parameters — see `scripts/vendor-aes-siem.sh`.
      Annotations.of(this).addWarningV2(
        'AutoSocSiem:UpstreamTemplateSecretNotNoEcho',
        `templateSource=UPSTREAM (the default): the raw upstream aes-siem ` +
          `template does NOT mark its GeoLite2LicenseKey / OtxApiKey ` +
          `parameters NoEcho. If you fill in either value at deploy time, ` +
          `it will be visible in the nested stack's own parameters via ` +
          `DescribeStacks/console even though this stack's parent ` +
          `parameter is NoEcho. Pass templateSource=VENDORED to get the ` +
          `NoEcho patch this repo applies to the vendored template.`,
      );
    }

    const geoLite2LicenseKey = new CfnParameter(this, 'GeoLite2LicenseKey', {
      type: 'String',
      default: '',
      noEcho: true,
      description: 'Optional MaxMind GeoLite2 license key.',
    });
    const otxApiKey = new CfnParameter(this, 'OtxApiKey', {
      type: 'String',
      default: '',
      noEcho: true,
      description: 'Optional AlienVault OTX API key.',
    });

    this.siemNestedStack = new CfnStack(this, 'AesSiemNestedStack', {
      templateUrl: this.resolveTemplateUrl(),
      parameters: buildAesSiemParameters(props, {
        geoLite2LicenseKey: geoLite2LicenseKey.valueAsString,
        otxApiKey: otxApiKey.valueAsString,
      }),
    });
  }

  /**
   * Resolve the template URL based on {@link AutoSocSiemConstructProps.templateSource}.
   * For `UPSTREAM`, builds a per-Region public bucket URL via Fn::Sub. For
   * `VENDORED`, packages the on-disk template as a CDK S3 asset.
   */
  private resolveTemplateUrl(): string {
    if (this.templateSource === AesSiemTemplateSource.VENDORED) {
      const here = path.dirname(fileURLToPath(import.meta.url));
      if (this.templateFileNameOverride !== undefined) {
        return this.packageVendoredTemplate(
          here,
          this.templateFileNameOverride,
          'AesSiemVendoredTemplate',
        );
      }
      const commercialUrl = this.packageVendoredTemplate(
        here,
        COMMERCIAL_TEMPLATE_FILE_NAME,
        'AesSiemCommercialTemplate',
      );
      const chinaUrl = this.packageVendoredTemplate(
        here,
        CHINA_TEMPLATE_FILE_NAME,
        'AesSiemChinaTemplate',
      );
      return Fn.conditionIf(
        this.chinaPartitionCondition().logicalId,
        chinaUrl,
        commercialUrl,
      ).toString();
    }

    if (this.templateFileNameOverride !== undefined) {
      return this.upstreamTemplateUrl(this.templateFileNameOverride);
    }
    return Fn.conditionIf(
      this.chinaPartitionCondition().logicalId,
      this.upstreamTemplateUrl(CHINA_TEMPLATE_FILE_NAME),
      this.upstreamTemplateUrl(COMMERCIAL_TEMPLATE_FILE_NAME),
    ).toString();
  }

  private packageVendoredTemplate(
    here: string,
    fileName: string,
    id: string,
  ): string {
    const vendored = path.resolve(
      here,
      VENDORED_TEMPLATE_RELATIVE_PATH,
      fileName,
    );
    if (!fs.existsSync(vendored)) {
      throw new Error(
        `AutoSocSiemConstruct: templateSource is VENDORED but ${vendored} ` +
          'does not exist. Run `pnpm run vendor:aes-siem` with ' +
          '`AES_SIEM_TEMPLATE_FILE_NAME` set to this file.',
      );
    }
    return new Asset(this, id, {path: vendored}).httpUrl;
  }

  private chinaPartitionCondition(): CfnCondition {
    return new CfnCondition(this, 'IsChinaPartition', {
      expression: Fn.conditionEquals(Stack.of(this).partition, 'aws-cn'),
    });
  }

  private upstreamTemplateUrl(fileName: string): string {
    const region = '\x24{AWS::Region}';
    const urlSuffix = '\x24{AWS::URLSuffix}';
    return Fn.sub(
      `https://aes-siem-${region}.s3.${region}.${urlSuffix}/${fileName}`,
    );
  }
}

/**
 * Translate the strongly-typed props into the upstream aes-siem template's
 * CloudFormation parameter map. Values are coerced to strings because
 * `CfnStack.parameters` only accepts `{[k: string]: string}`.
 */
function buildAesSiemParameters(
  props: AutoSocSiemConstructProps,
  secrets: {geoLite2LicenseKey: string; otxApiKey: string},
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
    SnsEmail: props.snsEmail ?? '',
    ReservedConcurrency: (props.esLoaderReservedConcurrency ?? 10).toString(),
    TrustedProxyIpList:
      props.trustedProxyIpList ??
      '127.0.0.1/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',
    LogBucketPolicyUpdate: props.logBucketPolicyUpdate ?? 'update_and_override',

    // Secret values come from parent NoEcho parameters, not CDK context.
    GeoLite2LicenseKey: secrets.geoLite2LicenseKey,
    OtxApiKey: secrets.otxApiKey,
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
