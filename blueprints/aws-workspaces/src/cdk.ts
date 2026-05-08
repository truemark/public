#!/usr/bin/env node
import {SecretValue} from 'aws-cdk-lib';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AwsWorkspacesStack} from './aws-workspaces-stack.js';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'aws-workspaces',
      url: 'https://github.com/truemark/public/tree/main/blueprints/aws-workspaces',
    },
  },
});

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

const bundleId =
  (app.node.tryGetContext('bundleId') as string) || 'wsb-g5rbnq51n';
const runningMode =
  (app.node.tryGetContext('runningMode') as string) || undefined;
const computeType =
  (app.node.tryGetContext('computeType') as string) || undefined;
const userName = (app.node.tryGetContext('userName') as string) || undefined;
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

const enableFlowLogs =
  (app.node.tryGetContext('enableFlowLogs') as string) !== 'false';
const enableCloudWatchLogs =
  (app.node.tryGetContext('enableCloudWatchLogs') as string) !== 'false';
const flowLogRetentionDaysRaw = app.node.tryGetContext(
  'flowLogRetentionDays',
) as string | undefined;
const flowLogRetentionDays = flowLogRetentionDaysRaw
  ? parseInt(flowLogRetentionDaysRaw, 10)
  : 90;

const bucketName =
  (app.node.tryGetContext('bucketName') as string) || undefined;

new AwsWorkspacesStack(app, 'AwsWorkspaces', {
  env: {account: app.account, region: app.region},
  networking: {
    existingVpcId,
    existingSubnetIds,
    vpcCidr,
    availabilityZones,
  },
  directory: {
    existingDirectoryId,
    createManagedAd,
    adDomainName,
    adShortName,
    adAdminPassword: adAdminPasswordSecretArn
      ? SecretValue.secretsManager(adAdminPasswordSecretArn)
      : undefined,
  },
  workspaces: {
    bundleId,
    userName,
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
  logging: {
    enableFlowLogs,
    enableCloudWatchLogs,
    retentionDays: flowLogRetentionDays,
  },
  storage: {
    bucketName,
  },
});
