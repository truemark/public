import {test, expect, describe} from 'vitest';
import {
  buildReAlarmTagSets,
  parseOverrideMinutes,
} from './realarm-tag-sets.mjs';

const ARN_A = 'arn:aws:cloudwatch:us-west-2:123456789012:alarm:alarm-a';
const ARN_B = 'arn:aws:cloudwatch:us-west-2:123456789012:alarm:alarm-b';

describe('buildReAlarmTagSets', () => {
  test('returns empty sets for no mappings - untagged alarms stay eligible', () => {
    const {excludedArns, overrideByArn} = buildReAlarmTagSets([]);
    expect(excludedArns.size).toBe(0);
    expect(overrideByArn.size).toBe(0);
  });

  test('excludes only alarms tagged re-alarm-enabled with exact value "false"', () => {
    const {excludedArns, overrideByArn} = buildReAlarmTagSets([
      {
        ResourceARN: ARN_A,
        Tags: [{Key: 'autoalarm:re-alarm-enabled', Value: 'false'}],
      },
      // 'true' and other values must NOT exclude (opt-out is exact-match,
      // mirroring the consumer's historical per-alarm validation).
      {
        ResourceARN: ARN_B,
        Tags: [{Key: 'autoalarm:re-alarm-enabled', Value: 'true'}],
      },
    ]);
    expect(excludedArns).toEqual(new Set([ARN_A]));
    expect(overrideByArn.size).toBe(0);
  });

  test('maps valid positive-integer re-alarm-minutes values as overrides', () => {
    const {excludedArns, overrideByArn} = buildReAlarmTagSets([
      {
        ResourceARN: ARN_A,
        Tags: [{Key: 'autoalarm:re-alarm-minutes', Value: '30'}],
      },
    ]);
    expect(overrideByArn.get(ARN_A)).toBe(30);
    expect(excludedArns.size).toBe(0);
  });

  test('rejects invalid override values (empty, zero, negative, fractional, non-numeric)', () => {
    for (const value of ['', ' ', '0', '-5', '2.5', 'abc']) {
      const {overrideByArn} = buildReAlarmTagSets([
        {
          ResourceARN: ARN_A,
          Tags: [{Key: 'autoalarm:re-alarm-minutes', Value: value}],
        },
      ]);
      expect(overrideByArn.size, `value: '${value}'`).toBe(0);
    }
  });

  test('handles both tags on one alarm, ignores unrelated tags, dedupes repeated mappings', () => {
    const mapping = {
      ResourceARN: ARN_A,
      Tags: [
        {Key: 'autoalarm:re-alarm-enabled', Value: 'false'},
        {Key: 'autoalarm:re-alarm-minutes', Value: '60'},
        {Key: 'autoalarm:cpu', Value: '80/95'},
      ],
    };
    // The same alarm can be returned by the sweep for each tag key.
    const {excludedArns, overrideByArn} = buildReAlarmTagSets([
      mapping,
      mapping,
    ]);
    expect(excludedArns).toEqual(new Set([ARN_A]));
    expect(overrideByArn).toEqual(new Map([[ARN_A, 60]]));
  });
});

describe('parseOverrideMinutes', () => {
  test('parses only real positive integers', () => {
    expect(parseOverrideMinutes('15')).toBe(15);
    expect(parseOverrideMinutes('0')).toBeNull();
    expect(parseOverrideMinutes('')).toBeNull();
    expect(parseOverrideMinutes(undefined)).toBeNull();
    expect(parseOverrideMinutes('1.5')).toBeNull();
  });
});
