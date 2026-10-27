#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AesSiemTemplateSource, AutoSiemStack} from './autosiem-stack.js';

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
      id: 'autosiem',
      url: 'https://github.com/truemark/public/tree/main/autosiem',
    },
  },
});

// `siemEmail` is optional, matching the upstream aes-siem template's own
// optional `SnsEmail` parameter: omit it to skip SNS alerting entirely (no
// topic/subscription is created, so there is nothing to receive or
// unsubscribe from).
const siemEmail = app.node.tryGetContext('siemEmail') as string | undefined;
const siemTemplateSource = ctxString(app, 'siemTemplateSource');
if (
  siemTemplateSource !== undefined &&
  siemTemplateSource !== AesSiemTemplateSource.UPSTREAM &&
  siemTemplateSource !== AesSiemTemplateSource.VENDORED
) {
  throw new Error(
    `AutoSiem: unknown siemTemplateSource "${siemTemplateSource}". ` +
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
    `AutoSiem: unknown siemDeploymentTarget "${siemDeploymentTarget}". ` +
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
    `AutoSiem: unknown siemLogBucketPolicyUpdate "${siemLogBucketPolicyUpdate}". ` +
      'Expected "update_and_override" or "keep".',
  );
}

new AutoSiemStack(app, 'AutoSiem', {
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
  // parameters declared by AutoSiemStack, never through CDK context.
  enableTor: ctxBool(app, 'siemEnableTor'),
  enableAbuseCh: ctxBool(app, 'siemEnableAbuseCh'),
  iocDownloadIntervalMinutes: ctxNumber(app, 'siemIocDownloadIntervalMinutes'),

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

  // Multi-account: Amazon Security Lake subscriber. `autosoc` (typically
  // deployed in the log-archive account) publishes these three values as
  // CfnOutputs; copy them here (or supply via these -c flags) when
  // deploying `autosiem` into its own account (e.g. security-audit).
  securityLakeSubscriberRoleArn: ctxString(
    app,
    'siemSecurityLakeSubscriberRoleArn',
  ),
  securityLakeSubscriberExternalId: ctxString(
    app,
    'siemSecurityLakeSubscriberExternalId',
  ),
  securityLakeSubscriberSqsArn: ctxString(
    app,
    'siemSecurityLakeSubscriberSqsArn',
  ),

  // VPC endpoint toggles (only consumed when vpcEndpointId is set)
  createSqsVpcEndpoint: ctxBool(app, 'siemCreateSqsVpcEndpoint'),
  createSsmVpcEndpoint: ctxBool(app, 'siemCreateSsmVpcEndpoint'),
  createStsVpcEndpoint: ctxBool(app, 'siemCreateStsVpcEndpoint'),
  createS3VpcEndpoint: ctxBool(app, 'siemCreateS3VpcEndpoint'),
});
