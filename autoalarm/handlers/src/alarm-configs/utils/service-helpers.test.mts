import {test, expect, describe} from 'vitest';
import {
  buildAlarmsToDelete,
  filterAlarmsToDelete,
  findArnInEvent,
} from './service-helpers.mjs';
import {buildExpectedAlarmNames} from './alarm-tools.mjs';
import {SQS_CONFIGS} from '../_index.mjs';

// Use the following to run tests individually:
// npx vitest run ./alarm-configs/utils/service-helpers.test.mts

describe('filterAlarmsToDelete', () => {
  test('deletes only expected alarms that are not kept', () => {
    const existing = [
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning',
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
      'AutoAlarm-SQS-orders-ApproximateAgeOfOldestMessage-Warning',
    ];
    const expected = new Set(existing);
    const keep = new Set(['AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning']);

    expect(filterAlarmsToDelete(existing, expected, keep)).toEqual([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
      'AutoAlarm-SQS-orders-ApproximateAgeOfOldestMessage-Warning',
    ]);
  });

  test('never deletes alarms outside the expected names (prefix collision)', () => {
    // 'orders' is a prefix of 'orders-dlq', so the AlarmNamePrefix fetch for
    // 'orders' can return the dlq queue's alarms. They must never be deleted.
    const existing = [
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
      'AutoAlarm-SQS-orders-dlq-NumberOfMessagesSent-Critical',
    ];
    const expected = new Set([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
    ]);
    const keep = new Set<string>();

    expect(filterAlarmsToDelete(existing, expected, keep)).toEqual([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
    ]);
  });

  test('returns an empty array when everything is kept', () => {
    const existing = ['AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning'];
    const expected = new Set(existing);
    const keep = new Set(existing);

    expect(filterAlarmsToDelete(existing, expected, keep)).toEqual([]);
  });

  test('works against names produced by buildExpectedAlarmNames', () => {
    const expected = buildExpectedAlarmNames('SQS', 'orders', SQS_CONFIGS);

    // Every expected name follows the AutoAlarm-SQS-orders- prefix format and
    // both classifications are present per config.
    expect(expected.size).toBe(SQS_CONFIGS.length * 2);
    for (const name of expected) {
      expect(name.startsWith('AutoAlarm-SQS-orders-')).toBe(true);
    }

    // A fetched alarm belonging to another queue is filtered out even when it
    // shares the prefix; expected alarms not kept are returned for deletion.
    const someExpected = [...expected].slice(0, 3);
    const existing = [
      ...someExpected,
      'AutoAlarm-SQS-orders-dlq-NumberOfMessagesSent-Critical',
    ];
    expect(
      filterAlarmsToDelete(existing, expected, new Set([someExpected[0]])),
    ).toEqual(someExpected.slice(1));
  });
});

describe('buildAlarmsToDelete', () => {
  test('unions identity-tagged alarms with expected-name-matched alarms', () => {
    const tagged = [
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning',
      'AutoAlarm-SQS-orders-OldMetricName-Critical', // renamed metric, tag-only
    ];
    const prefixFetched = [
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning',
      'AutoAlarm-SQS-orders-ApproximateAgeOfOldestMessage-Critical',
    ];
    const expected = new Set([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning',
      'AutoAlarm-SQS-orders-ApproximateAgeOfOldestMessage-Critical',
    ]);

    expect(
      buildAlarmsToDelete(tagged, prefixFetched, expected, new Set()),
    ).toEqual([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning',
      'AutoAlarm-SQS-orders-OldMetricName-Critical',
      'AutoAlarm-SQS-orders-ApproximateAgeOfOldestMessage-Critical',
    ]);
  });

  test('identity-tagged alarms are deleted even when their name is not expected', () => {
    // An alarm tagged with this resource's identity is authoritatively ours
    // regardless of name (e.g., created under an older naming scheme).
    const tagged = ['AutoAlarm-SQS-orders-LegacyName-Warning'];
    const expected = new Set<string>(); // name no longer expected

    expect(buildAlarmsToDelete(tagged, [], expected, new Set())).toEqual([
      'AutoAlarm-SQS-orders-LegacyName-Warning',
    ]);
  });

  test('prefix-fetched alarms outside the expected names are never deleted', () => {
    // 'orders' is a prefix of 'orders-dlq': the AlarmNamePrefix fetch for
    // 'orders' returns the dlq queue's alarms, and they carry a different
    // identity tag (so they are not in the tagged set). They must survive.
    const prefixFetched = [
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
      'AutoAlarm-SQS-orders-dlq-NumberOfMessagesSent-Critical',
    ];
    const expected = new Set([
      'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical',
    ]);

    expect(buildAlarmsToDelete([], prefixFetched, expected, new Set())).toEqual(
      ['AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical'],
    );
  });

  test('kept alarms are excluded from both sources', () => {
    const keepName = 'AutoAlarm-SQS-orders-NumberOfMessagesSent-Warning';
    const tagged = [keepName, 'AutoAlarm-SQS-orders-Stale-Critical'];
    const prefixFetched = [keepName];
    const expected = new Set([keepName]);
    const keep = new Set([keepName]);

    expect(buildAlarmsToDelete(tagged, prefixFetched, expected, keep)).toEqual([
      'AutoAlarm-SQS-orders-Stale-Critical',
    ]);
  });

  test('deduplicates alarms present in both sources', () => {
    const name = 'AutoAlarm-SQS-orders-NumberOfMessagesSent-Critical';
    const result = buildAlarmsToDelete(
      [name],
      [name],
      new Set([name]),
      new Set(),
    );
    expect(result).toEqual([name]);
  });

  test('returns an empty array when both sources are empty', () => {
    expect(
      buildAlarmsToDelete([], [], new Set(['anything']), new Set()),
    ).toEqual([]);
  });
});

describe('findArnInEvent', () => {
  test('extracts an ARN from a JSON-serializable event object', () => {
    const event = {
      detail: {
        responseElements: {
          dBInstanceArn: 'arn:aws:rds:us-west-2:123456789012:db:mydb',
        },
      },
    };
    expect(findArnInEvent(event, 'arn:aws:rds')).toBe(
      'arn:aws:rds:us-west-2:123456789012:db:mydb',
    );
  });

  test('extracts an ARN from a pre-serialized event body string', () => {
    const body = JSON.stringify({
      resources: ['arn:aws:logs:us-east-1:123456789012:log-group:/my/group'],
    });
    expect(findArnInEvent(body, 'arn:aws:logs')).toBe(
      'arn:aws:logs:us-east-1:123456789012:log-group:/my/group',
    );
  });

  test('returns the first match when multiple ARNs are present', () => {
    const event = {
      first: 'arn:aws:rds:us-west-2:123456789012:db:first-db',
      second: 'arn:aws:rds:us-west-2:123456789012:db:second-db',
    };
    expect(findArnInEvent(event, 'arn:aws:rds')).toBe(
      'arn:aws:rds:us-west-2:123456789012:db:first-db',
    );
  });

  test('returns an empty string when no ARN with the prefix exists', () => {
    expect(findArnInEvent({foo: 'bar'}, 'arn:aws:rds')).toBe('');
  });
});
