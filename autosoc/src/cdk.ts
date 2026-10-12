#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AutoSocSiemStack} from './autosoc-siem-stack.js';
import {AutoSocStack} from './autosoc-stack.js';

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
  const siem = new AutoSocSiemStack(app, 'AutoSocSiem', {
    snsEmail: siemEmail,
    geoLite2LicenseKey: app.node.tryGetContext('siemGeoLite2LicenseKey') as
      | string
      | undefined,
    allowedSourceIpAddresses: app.node.tryGetContext(
      'siemAllowedSourceIpAddresses',
    ) as string | undefined,
    deploymentTarget: app.node.tryGetContext('siemDeploymentTarget') as
      | 'opensearch_managed_cluster'
      | 'opensearch_serverless'
      | undefined,
    domainOrCollectionName: app.node.tryGetContext(
      'siemDomainOrCollectionName',
    ) as string | undefined,
    esLoaderReservedConcurrency: app.node.tryGetContext(
      'siemEsLoaderReservedConcurrency',
    ) as number | undefined,
    // Wire Security Lake subscriber (if AutoSocStack created one) so
    // es-loader can ingest OCSF Parquet alongside its native log sources.
    securityLakeSubscriberRoleArn: autoSoc.securityLake.subscribers[0]
      ? autoSoc.securityLake.subscribers[0].attrSubscriberRoleArn
      : undefined,
    securityLakeSubscriberExternalId:
      (app.node.tryGetContext('siemSubscriberExternalId') as string) ||
      undefined,
    securityLakeSubscriberSqsArn: autoSoc.securityLake
      .subscriberNotifications[0]
      ? autoSoc.securityLake.subscriberNotifications[0].attrSubscriberEndpoint
      : undefined,
  });
  siem.addDependency(autoSoc);
}
