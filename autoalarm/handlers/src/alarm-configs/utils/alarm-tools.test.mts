import {test, expect, describe, afterEach, beforeEach} from 'vitest';
import {
  ALARM_IDENTITY_RESOURCE_ID_TAG,
  ALARM_IDENTITY_SERVICE_TAG,
  buildAlarmArn,
  buildAlarmIdentityTags,
} from './alarm-tools.mjs';

// Use the following to run tests individually:
// npx vitest run ./alarm-configs/utils/alarm-tools.test.mts

describe('buildAlarmIdentityTags', () => {
  test('builds the service and resource-id identity tags verbatim', () => {
    expect(buildAlarmIdentityTags('SQS', 'orders')).toEqual([
      {Key: ALARM_IDENTITY_SERVICE_TAG, Value: 'SQS'},
      {Key: ALARM_IDENTITY_RESOURCE_ID_TAG, Value: 'orders'},
    ]);
  });

  test('stores ARN identifiers unmodified so the tag lookup matches', () => {
    const arn = 'arn:aws:states:us-west-2:123456789012:stateMachine:my-machine';
    const tags = buildAlarmIdentityTags('SFN', arn);
    expect(tags).toContainEqual({
      Key: ALARM_IDENTITY_RESOURCE_ID_TAG,
      Value: arn,
    });
  });

  test('does not change the case of the service label', () => {
    // The tag value must be exactly what the reconcile lookup queries with;
    // buildAlarmName uppercases the service for alarm names, but identity
    // tags use the value as passed.
    expect(buildAlarmIdentityTags('RDSCluster', 'my-cluster')[0]).toEqual({
      Key: ALARM_IDENTITY_SERVICE_TAG,
      Value: 'RDSCluster',
    });
  });
});

describe('buildAlarmArn', () => {
  const originalRegion = process.env.AWS_REGION;
  const originalAcctId = process.env.ACCT_ID;

  beforeEach(() => {
    process.env.AWS_REGION = 'us-west-2';
    process.env.ACCT_ID = '123456789012';
  });

  afterEach(() => {
    if (originalRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = originalRegion;
    }
    if (originalAcctId === undefined) {
      delete process.env.ACCT_ID;
    } else {
      process.env.ACCT_ID = originalAcctId;
    }
  });

  test('builds the alarm ARN from AWS_REGION and ACCT_ID', () => {
    expect(
      buildAlarmArn('AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical'),
    ).toBe(
      'arn:aws:cloudwatch:us-west-2:123456789012:alarm:AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
    );
  });

  test('returns undefined when ACCT_ID is not set', () => {
    delete process.env.ACCT_ID;
    expect(buildAlarmArn('AutoAlarm-SQS-orders-foo-Warning')).toBeUndefined();
  });

  test('returns undefined when AWS_REGION is not set', () => {
    delete process.env.AWS_REGION;
    expect(buildAlarmArn('AutoAlarm-SQS-orders-foo-Warning')).toBeUndefined();
  });
});
