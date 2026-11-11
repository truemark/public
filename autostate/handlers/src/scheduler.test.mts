import {afterEach, describe, expect, test, vi} from 'vitest';
import {
  DBClusterNotFoundFault,
  DBInstanceNotFoundFault,
  RDSClient,
} from '@aws-sdk/client-rds';
import {processStateAction} from './scheduler.mjs';

const STATE_MACHINE_ARN =
  'arn:aws:states:us-west-2:123456789012:stateMachine:AutoState';

function rdsAction(resourceType: 'rds-instance' | 'rds-cluster') {
  return {
    resourceType,
    resourceId: 'my-db',
    tagHash: 'V1',
    when: '2026-01-01T00:00:00.000Z',
    action: 'stop' as const,
  };
}

function throttlingError(): Error {
  const error = new Error('Rate exceeded');
  error.name = 'Throttling';
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processStateAction RDS lookup errors', () => {
  test('treats a missing RDS instance as no longer existing', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockRejectedValue(
      new DBInstanceNotFoundFault({message: 'not found', $metadata: {}}),
    );
    const result = await processStateAction(
      STATE_MACHINE_ARN,
      rdsAction('rds-instance'),
    );
    expect(result).toMatchObject({
      execute: false,
      reason: 'Instance no longer exists',
    });
  });

  test('rethrows other RDS instance errors', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockRejectedValue(throttlingError());
    await expect(
      processStateAction(STATE_MACHINE_ARN, rdsAction('rds-instance')),
    ).rejects.toThrow('Rate exceeded');
  });

  test('treats a missing RDS cluster as no longer existing', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockRejectedValue(
      new DBClusterNotFoundFault({message: 'not found', $metadata: {}}),
    );
    const result = await processStateAction(
      STATE_MACHINE_ARN,
      rdsAction('rds-cluster'),
    );
    expect(result).toMatchObject({
      execute: false,
      reason: 'Instance no longer exists',
    });
  });

  test('rethrows other RDS cluster errors', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockRejectedValue(throttlingError());
    await expect(
      processStateAction(STATE_MACHINE_ARN, rdsAction('rds-cluster')),
    ).rejects.toThrow('Rate exceeded');
  });
});
