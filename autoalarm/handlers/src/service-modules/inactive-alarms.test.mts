import {describe, expect, test, vi} from 'vitest';

// Every surface deletes a removed resource's alarms through
// deleteExistingAlarms. Make it fail so each wrapper's error path runs.
vi.mock('../alarm-configs/utils/index.mjs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteExistingAlarms: vi.fn(async () => {
    throw new Error('DeleteAlarms failed');
  }),
}));

import {manageInactiveALBAlarms} from './alb-modules.mjs';
import {manageInactiveCloudFrontAlarms} from './cloudfront-modules.mjs';
import {manageInactiveLambdaAlarms} from './lambda-modules.mjs';
import {manageInactiveOpenSearchAlarms} from './opensearch-modules.mjs';
import {manageInactiveRDSClusterAlarms} from './rds-cluster-modules.mjs';
import {manageInactiveRDSAlarms} from './rds-modules.mjs';
import {manageInactiveR53ResolverAlarms} from './route53-resolver-modules.mjs';
import {manageInactiveSQSAlarms} from './sqs-modules.mjs';
import {manageInactiveSFNAlarms} from './step-function-modules.mjs';
import {manageInactiveTGAlarms} from './targetgroup-modules.mjs';
import {manageInactiveTransitGatewayAlarms} from './transit-gateway-modules.mjs';
import {manageInactiveVpnAlarms} from './vpn-modules.mjs';

/**
 * A wrapper that catches the failure and returns makes the main handler
 * acknowledge the SQS record. The event is then never retried, never reaches
 * the dead-letter queue, and the resource's alarms are left behind.
 */
describe('manageInactive*Alarms', () => {
  const wrappers: [string, (id: string) => Promise<void>][] = [
    ['ALB', manageInactiveALBAlarms],
    ['CloudFront', manageInactiveCloudFrontAlarms],
    ['Lambda', manageInactiveLambdaAlarms],
    ['OpenSearch', manageInactiveOpenSearchAlarms],
    ['RDS', manageInactiveRDSAlarms],
    ['RDS cluster', manageInactiveRDSClusterAlarms],
    ['Route 53 Resolver', manageInactiveR53ResolverAlarms],
    ['SQS', manageInactiveSQSAlarms],
    ['Step Functions', manageInactiveSFNAlarms],
    ['Target group', manageInactiveTGAlarms],
    ['Transit Gateway', manageInactiveTransitGatewayAlarms],
    ['VPN', manageInactiveVpnAlarms],
  ];

  test.each(wrappers)(
    '%s rejects when alarm deletion fails',
    async (_surface, manageInactiveAlarms) => {
      await expect(manageInactiveAlarms('resource-id')).rejects.toThrow(
        /DeleteAlarms failed/,
      );
    },
  );
});
