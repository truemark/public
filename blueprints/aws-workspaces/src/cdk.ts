#!/usr/bin/env node
import {SecretValue} from 'aws-cdk-lib';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsWorkspacesFoundationStack,
  AwsWorkspacesUserStack,
} from './aws-workspaces-stack.js';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'aws-workspaces',
      url: 'https://github.com/truemark/public/tree/main/blueprints/aws-workspaces',
    },
  },
});

const env = {account: app.account, region: app.region};

// Networking
const existingVpcId =
  (app.node.tryGetContext('existingVpcId') as string) || undefined;
const existingSubnetIdsRaw = app.node.tryGetContext('existingSubnetIds') as
  | string
  | undefined;
const existingSubnetIds = existingSubnetIdsRaw
  ? existingSubnetIdsRaw.split(',').filter(Boolean)
  : undefined;
const vpcCidr = (app.node.tryGetContext('vpcCidr') as string) || undefined;
const availabilityZonesRaw = app.node.tryGetContext('availabilityZones') as
  | string
  | undefined;
const availabilityZones = availabilityZonesRaw
  ? availabilityZonesRaw.split(',').filter(Boolean)
  : undefined;

// Directory
const existingDirectoryId =
  (app.node.tryGetContext('existingDirectoryId') as string) || undefined;
const createManagedAd =
  (app.node.tryGetContext('createManagedAd') as string) === 'true';
const adDomainName =
  (app.node.tryGetContext('adDomainName') as string) || undefined;
const adShortName =
  (app.node.tryGetContext('adShortName') as string) || undefined;
const adAdminPasswordSecretArn =
  (app.node.tryGetContext('adAdminPasswordSecretArn') as string) || undefined;

// Logging
const enableFlowLogs =
  (app.node.tryGetContext('enableFlowLogs') as string) !== 'false';
const enableCloudWatchLogs =
  (app.node.tryGetContext('enableCloudWatchLogs') as string) !== 'false';
const flowLogRetentionDaysRaw = app.node.tryGetContext(
  'flowLogRetentionDays',
) as string | undefined;
const retentionDays = flowLogRetentionDaysRaw
  ? parseInt(flowLogRetentionDaysRaw, 10)
  : 90;

// Storage
const bucketName =
  (app.node.tryGetContext('bucketName') as string) || undefined;

// Infrastructure
const workspacesDefaultRoleExists =
  (app.node.tryGetContext('workspacesDefaultRoleExists') as string) === 'true';
const operatingSystem =
  (app.node.tryGetContext('operatingSystem') as string) || undefined;
const packagesRaw = app.node.tryGetContext('packages') as string | undefined;
const packages = packagesRaw
  ? packagesRaw.split(',').filter(Boolean)
  : undefined;

const foundation = new AwsWorkspacesFoundationStack(
  app,
  'AwsWorkspacesFoundation',
  {
    env,
    networking: {existingVpcId, existingSubnetIds, vpcCidr, availabilityZones},
    directory: {
      existingDirectoryId,
      createManagedAd,
      adDomainName,
      adShortName,
      adAdminPassword: adAdminPasswordSecretArn
        ? SecretValue.secretsManager(adAdminPasswordSecretArn)
        : undefined,
    },
    logging: {enableFlowLogs, enableCloudWatchLogs, retentionDays},
    storage: {bucketName},
    infrastructure: {
      workspacesDefaultRoleExists,
      operatingSystem,
      packages: packages?.length ? {packages} : undefined,
    },
  },
);

// Per-user stack — only created when userName context is provided.
// Deploy with: cdk deploy --context userName=johndoe --context bundleId=wsb-dc06lb363
const userName = (app.node.tryGetContext('userName') as string) || undefined;
const bundleId =
  (app.node.tryGetContext('bundleId') as string) || 'wsb-g5rbnq51n';
const runningMode =
  (app.node.tryGetContext('runningMode') as string) || undefined;
const computeType =
  (app.node.tryGetContext('computeType') as string) || undefined;
const rootVolumeSizeGibRaw = app.node.tryGetContext('rootVolumeSizeGib') as
  | string
  | undefined;
const rootVolumeSizeGib = rootVolumeSizeGibRaw
  ? parseInt(rootVolumeSizeGibRaw, 10)
  : undefined;
const userVolumeSizeGibRaw = app.node.tryGetContext('userVolumeSizeGib') as
  | string
  | undefined;
const userVolumeSizeGib = userVolumeSizeGibRaw
  ? parseInt(userVolumeSizeGibRaw, 10)
  : undefined;

if (userName) {
  const userStack = new AwsWorkspacesUserStack(
    app,
    `AwsWorkspacesUser-${userName}`,
    {
      env,
      directoryId: foundation.foundation.directoryId,
      kmsKeyArn: foundation.foundation.encryptionKey.keyArn,
      patchGroupName: foundation.foundation.patchGroupName,
      userName,
      bundleId,
      runningMode: runningMode as 'AUTO_STOP' | 'ALWAYS_ON' | undefined,
      computeType: computeType as
        | 'VALUE'
        | 'STANDARD'
        | 'PERFORMANCE'
        | 'POWER'
        | 'GRAPHICS'
        | 'GRAPHICSPRO'
        | undefined,
      rootVolumeSizeGib,
      userVolumeSizeGib,
    },
  );
  userStack.addDependency(foundation);
}
