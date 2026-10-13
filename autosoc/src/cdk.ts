#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AesSiemTemplateSource, AutoSocSiemStack} from './autosoc-siem-stack.js';
import {AutoSocStack} from './autosoc-stack.js';

function ctxBool(app: ExtendedApp, key: string): boolean | undefined {
  const raw = app.node.tryGetContext(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return undefined;
}

function ctxNumber(app: ExtendedApp, key: string): number | undefined {
  const raw = app.node.tryGetContext(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function ctxString(app: ExtendedApp, key: string): string | undefined {
  const raw = app.node.tryGetContext(key);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function ctxStringList(app: ExtendedApp, key: string): string[] | undefined {
  const raw = ctxString(app, key);
  return raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;
}

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autosoc',
      url: 'https://github.com/truemark/public/tree/main/autosoc',
    },
  },
});

const autoSoc = new AutoSocStack(app, 'AutoSoc', {});

// Opt-in SIEM stack. Deploys the upstream aes-siem CloudFormation template
// nested inside a CDK stack. Both AutoSocStack and AutoSocSiemStack can be
// deployed in parallel: aes-siem keeps its native S3-ingest path for logs
// delivered directly to its own log bucket, and additionally polls the
// Security Lake subscriber SQS queue (if `siemSubscriberAccountId` +
// `siemSubscriberExternalId` context were supplied).
const deploySiem =
  app.node.tryGetContext('deploySiem') === true ||
  app.node.tryGetContext('deploySiem') === 'true';
if (deploySiem) {
  const siemEmail = app.node.tryGetContext('siemEmail') as string | undefined;
  if (!siemEmail) {
    throw new Error(
      'AutoSocSiemStack requires `-c siemEmail=<address>` so OpenSearch ' +
        'alerts have a destination.',
    );
  }
  const siemTemplateSource = ctxString(app, 'siemTemplateSource');
  if (
    siemTemplateSource !== undefined &&
    siemTemplateSource !== AesSiemTemplateSource.UPSTREAM &&
    siemTemplateSource !== AesSiemTemplateSource.VENDORED
  ) {
    throw new Error(
      `AutoSocSiemStack: unknown siemTemplateSource "${siemTemplateSource}". ` +
        `Expected "${AesSiemTemplateSource.UPSTREAM}" or "${AesSiemTemplateSource.VENDORED}".`,
    );
  }
  const siemDeploymentTarget = ctxString(app, 'siemDeploymentTarget');
  if (
    siemDeploymentTarget !== undefined &&
    siemDeploymentTarget !== 'opensearch_managed_cluster' &&
    siemDeploymentTarget !== 'opensearch_serverless'
  ) {
    throw new Error(
      `AutoSocSiemStack: unknown siemDeploymentTarget "${siemDeploymentTarget}". ` +
        'Expected "opensearch_managed_cluster" or "opensearch_serverless".',
    );
  }
  const siemLogBucketPolicyUpdate = ctxString(app, 'siemLogBucketPolicyUpdate');
  if (
    siemLogBucketPolicyUpdate !== undefined &&
    siemLogBucketPolicyUpdate !== 'update_and_override' &&
    siemLogBucketPolicyUpdate !== 'keep'
  ) {
    throw new Error(
      `AutoSocSiemStack: unknown siemLogBucketPolicyUpdate "${siemLogBucketPolicyUpdate}". ` +
        'Expected "update_and_override" or "keep".',
    );
  }

  const siem = new AutoSocSiemStack(app, 'AutoSocSiem', {
    snsEmail: siemEmail,
    templateSource: siemTemplateSource as AesSiemTemplateSource | undefined,
    upstreamTemplateFileName: ctxString(app, 'siemUpstreamTemplateFileName'),

    // OpenSearch shape
    deploymentTarget: siemDeploymentTarget as
      | 'opensearch_managed_cluster'
      | 'opensearch_serverless'
      | undefined,
    domainOrCollectionName: ctxString(app, 'siemDomainOrCollectionName'),
    vpcEndpointId: ctxString(app, 'siemVpcEndpointId'),
    allowedSourceIpAddresses: ctxString(app, 'siemAllowedSourceIpAddresses'),

    // es-loader runtime
    esLoaderReservedConcurrency: ctxNumber(
      app,
      'siemEsLoaderReservedConcurrency',
    ),
    trustedProxyIpList: ctxString(app, 'siemTrustedProxyIpList'),
    logBucketPolicyUpdate: siemLogBucketPolicyUpdate as
      | 'update_and_override'
      | 'keep'
      | undefined,

    // Secret enrichment values are supplied through NoEcho CloudFormation
    // parameters declared by AutoSocSiemStack, never through CDK context.
    enableTor: ctxBool(app, 'siemEnableTor'),
    enableAbuseCh: ctxBool(app, 'siemEnableAbuseCh'),
    iocDownloadIntervalMinutes: ctxNumber(
      app,
      'siemIocDownloadIntervalMinutes',
    ),

    // Multi-account: Control Tower
    controlTowerLogBucketNames: ctxStringList(
      app,
      'siemControlTowerLogBucketNames',
    ),
    controlTowerRoleArnForEsLoader: ctxString(
      app,
      'siemControlTowerRoleArnForEsLoader',
    ),
    controlTowerSqsForLogBuckets: ctxString(
      app,
      'siemControlTowerSqsForLogBuckets',
    ),

    // VPC endpoint toggles (only consumed when vpcEndpointId is set)
    createSqsVpcEndpoint: ctxBool(app, 'siemCreateSqsVpcEndpoint'),
    createSsmVpcEndpoint: ctxBool(app, 'siemCreateSsmVpcEndpoint'),
    createStsVpcEndpoint: ctxBool(app, 'siemCreateStsVpcEndpoint'),
    createS3VpcEndpoint: ctxBool(app, 'siemCreateS3VpcEndpoint'),

    // Wire Security Lake subscriber (if AutoSocStack created one) so
    // es-loader can ingest OCSF Parquet alongside its native log sources.
    securityLakeSubscriberRoleArn: autoSoc.securityLake.subscribers[0]
      ? autoSoc.securityLake.subscribers[0].attrSubscriberRoleArn
      : undefined,
    securityLakeSubscriberExternalId: ctxString(
      app,
      'siemSubscriberExternalId',
    ),
    securityLakeSubscriberSqsArn: autoSoc.securityLake
      .subscriberNotifications[0]
      ? autoSoc.securityLake.subscriberNotifications[0].attrSubscriberEndpoint
      : undefined,
  });
  siem.addDependency(autoSoc);
}
