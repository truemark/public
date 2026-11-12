#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {DatabaseCollectorStack} from './database-collector-stack.js';

function ctxString(app: ExtendedApp, key: string): string | undefined {
  const raw = app.node.tryGetContext(key);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'database-collector',
      url: 'https://github.com/truemark/public/tree/main/database-collector',
    },
  },
});

const vpcId = ctxString(app, 'vpcId');
const subnetIds = ctxString(app, 'subnetIds')
  ?.split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
if (!vpcId) {
  throw new Error('DatabaseCollector requires `-c vpcId=<vpc-id>`');
}
if (!subnetIds || subnetIds.length === 0) {
  throw new Error(
    'DatabaseCollector requires `-c subnetIds=<subnet-id>[,<subnet-id>...]`',
  );
}

new DatabaseCollectorStack(app, 'DatabaseCollector', {
  vpcId,
  subnetIds,
  tagPrefix: ctxString(app, 'tagPrefix'),
  databaseUser: ctxString(app, 'databaseUser'),
  roleName: ctxString(app, 'roleName'),
  // Read directly so that an empty string, which turns metric publishing
  // off, is not mistaken for "not set".
  metricsNamespace: app.node.tryGetContext('metricsNamespace'),
});
