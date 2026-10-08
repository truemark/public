import {test, expect, describe} from 'vitest';
import {
  metricAlarmOptionsToString,
  parseMetricAlarmOptions,
  parseStatisticOption,
} from './alarm-config.mjs';
import {Statistic} from '@aws-sdk/client-cloudwatch';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';
import {MetricAlarmOptions} from '../../types/index.mjs';

// Use the following to run test individually: npx vitest run ./alarm-configs/utils/alarm-config.test.mts
test('metricAlarmOptionsToString', () => {
  expect(
    metricAlarmOptionsToString({
      warningThreshold: 1,
      criticalThreshold: 2,
      period: 2,
      evaluationPeriods: 3,
      statistic: 'Average',
      dataPointsToAlarm: 4,
      missingDataTreatment: TreatMissingData.MISSING,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
    }),
  ).toBe('1/2/2/3/Average/4/GreaterThanOrEqualToThreshold/missing');
});

describe('parseMetricAlarmOptions', () => {
  const defaults: MetricAlarmOptions = {
    warningThreshold: 10,
    criticalThreshold: 20,
    period: 60,
    evaluationPeriods: 5,
    statistic: 'Average',
    dataPointsToAlarm: 5,
    missingDataTreatment: TreatMissingData.IGNORE,
    comparisonOperator: 'GreaterThanThreshold',
  };

  test('parses a fully specified value', () => {
    expect(
      parseMetricAlarmOptions(
        '1/2/300/3/Maximum/2/LessThanThreshold/breaching',
        defaults,
      ),
    ).toEqual({
      warningThreshold: 1,
      criticalThreshold: 2,
      period: 300,
      evaluationPeriods: 3,
      statistic: 'Maximum',
      dataPointsToAlarm: 2,
      missingDataTreatment: 'breaching',
      comparisonOperator: 'LessThanThreshold',
    });
  });

  test('falls back to defaults for missing or empty fields', () => {
    expect(parseMetricAlarmOptions('', defaults)).toEqual({
      ...defaults,
      warningThreshold: defaults.warningThreshold,
    });
    expect(parseMetricAlarmOptions('//120', defaults)).toEqual({
      ...defaults,
      period: 120,
    });
  });

  test('treats "-" thresholds as disabled (null)', () => {
    const parsed = parseMetricAlarmOptions('-/30', defaults);
    expect(parsed.warningThreshold).toBeNull();
    expect(parsed.criticalThreshold).toBe(30);
  });
});

/** parseStatisticOption test for valid Extended statistics.*/
describe('parseStatisticOption', () => {
  // Test for Default Value
  test('returns default value for empty input', () => {
    expect(parseStatisticOption('', 'Average')).toBe('Average');
    expect(parseStatisticOption('   ', 'Maximum')).toBe('Maximum');
  });

  // Test for IQM Special Case - Interquartile mean is the trimmed mean of the middle 50% of values
  test('handles IQM special case correctly', () => {
    expect(parseStatisticOption('iqm', 'Average')).toBe('IQM');
    expect(parseStatisticOption('  iqm  ', 'Average')).toBe('IQM');
    expect(parseStatisticOption('IQM', 'Average')).toBe('IQM');
  });

  // Test for Standard Statistics
  test('correctly identifies standard statistics', () => {
    // Test each standard statistic
    Object.values(Statistic).forEach((stat) => {
      expect(parseStatisticOption(stat, 'Average')).toBe(stat);

      // Test with different casing
      expect(parseStatisticOption(stat.toLowerCase(), 'Average')).toBe(stat);
      expect(parseStatisticOption(stat.toUpperCase(), 'Average')).toBe(stat);

      // Test with whitespace
      expect(parseStatisticOption(`  ${stat}  `, 'Average')).toBe(stat);
    });
  });

  // Test for Percentile Statistics
  test('handles percentile statistics correctly', () => {
    const percentiles = [
      'p10',
      'p50',
      'p90',
      'p95',
      'p99',
      'p99',
      'tm10',
      'tm50',
      'tm90',
      'tm95',
      'ts10',
      'ts50',
      'wm10',
      'wm50',
    ];

    percentiles.forEach((percentile) => {
      expect(parseStatisticOption(percentile, 'Average')).toBe(percentile);

      // Test with different casing
      expect(parseStatisticOption(percentile.toUpperCase(), 'Average')).toBe(
        percentile,
      );

      // Test with whitespace
      expect(parseStatisticOption(`  ${percentile}  `, 'Average')).toBe(
        percentile,
      );
    });
  });

  // Test for Trimmed Mean with Range Extended Statistics
  test('handles trimmed mean with ranges correctly', () => {
    const tmRanges = [
      // Format: [input, expected]
      ['TM(10%:90%)', 'TM(10%:90%)'], // Trimmed mean using values between 10th and 90th percentiles
      ['tm(:95%)', 'TM(:95%)'], // Trimmed mean ignoring highest 5% values
      ['tm(5%:)', 'TM(5%:)'], // Trimmed mean ignoring lowest 5% values
      ['TM(80:500)', 'TM(80:500)'], // Trimmed mean using values between 80 and 500
      ['tm(:0.5)', 'TM(:0.5)'], // Trimmed mean using values up to 0.5
      ['tm(10%:90%)', 'TM(10%:90%)'], // Lowercase version should be capitalized
    ];

    tmRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'Average')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test for Winsorized Mean with Range Extended Statistics
  test('handles winsorized mean with ranges correctly', () => {
    const wmRanges = [
      // Format: [input, expected]
      ['WM(10%:90%)', 'WM(10%:90%)'], // Winsorized mean treating values outside 10-90% as boundary values
      ['WM(:95%)', 'WM(:95%)'], // Winsorized mean treating highest 5% values as 95th percentile value
      ['wm(5%:)', 'WM(5%:)'], // Winsorized mean treating lowest 5% values as 5th percentile value
      ['WM(100:2000)', 'WM(100:2000)'], // Winsorized mean treating values outside 100-2000 as boundary values
      ['wm(10%:90%)', 'WM(10%:90%)'], // Lowercase version should be capitalized
    ];

    wmRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'p90')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test for Trimmed Count with Range Extended Statistics
  test('handles trimmed count with ranges correctly', () => {
    const tcRanges = [
      // Format: [input, expected]
      ['TC(10%:90%)', 'TC(10%:90%)'], // Count of values between 10th and 90th percentiles
      ['TC(:95%)', 'TC(:95%)'], // Count of values up to 95th percentile
      ['TC(5%:)', 'TC(5%:)'], // Count of values above 5th percentile
      ['TC(0.005:0.030)', 'TC(0.005:0.030)'], // Count of values between 0.005 and 0.030
      ['tc(10%:90%)', 'TC(10%:90%)'], // Lowercase version should be capitalized
    ];

    tcRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'Average')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test for Trimmed Sum with Range Extended Statistics
  test('handles trimmed sum with ranges correctly', () => {
    const tsRanges = [
      // Format: [input, expected]
      ['TS(10%:90%)', 'TS(10%:90%)'], // Sum of values between 10th and 90th percentiles
      ['TS(:95%)', 'TS(:95%)'], // Sum of values up to 95th percentile
      ['TS(80%:)', 'TS(80%:)'], // Sum of values above 80th percentile
      ['TS(100:2000)', 'TS(100:2000)'], // Sum of values between 100 and 2000
      ['ts(10%:90%)', 'TS(10%:90%)'], // Lowercase version should be capitalized
    ];

    tsRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'Average')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test mismatched values
  test('handles percentile rank statistics correctly', () => {
    const prRanges = [
      // Format: [input, expected]
      ['PR(123%:300)', 'Average'], // Percentage of data points with value ≤ 300
      ['PR(100%:2000)', 'Average'], // Percentage of data points with value between 100 and 2000
      ['pr(23%:300)', 'Average'], // Lowercase version should be capitalized
    ];

    prRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'Average')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test for Percentile Rank (PR) Extended Statistics
  test('handles percentile rank statistics correctly', () => {
    const prRanges = [
      // Format: [input, expected]
      ['PR(:300)', 'PR(:300)'], // Percentage of data points with value ≤ 300
      ['PR(100:2000)', 'PR(100:2000)'], // Percentage of data points with value between 100 and 2000
      ['pr(:300)', 'PR(:300)'], // Lowercase version should be capitalized
    ];

    prRanges.forEach(([input, expected]) => {
      expect(parseStatisticOption(input, 'Average')).toBe(expected);

      // Test with whitespace
      expect(parseStatisticOption(`  ${input}  `, 'Average')).toBe(expected);
    });
  });

  // Test for Invalid Values based on AWS documentation rules
  test('returns default value for invalid statistics', () => {
    const invalidValues = [
      'NotAStat', // Not a valid statistic
      'p101', // Percentile out of range
      'tm101', // Trimmed mean out of range
      'wm101', // Winsorized mean out of range
      'maxp95', // Prefixed garbage must not match (regex must be fully anchored)
      'p95max', // Suffixed garbage must not match
      'TC(zz%:300%)', // Percentage over 100%
      'PR(abc)', // Invalid percentile rank format
      'TM(10:90:80)', // Too many values in range
      'tc(10:90:80)', // Too many values in range
      'p', // Incomplete
      'tm', // Incomplete
      'TC()', // Empty range
      'PR(::)', // Invalid format
      'CP(:123)', // CP is not a valid AWS extended statistic
      'TM 90', // Space not allowed
      'wm  -(10:90)', // hyphen not allowed
      'tm99%', // Wrong format for single value
      'TMzz', // Uppercase abbreviated format is invalid
      'TS(101%:)', // Percentage over 100%
      'WM(:-1)', // Negative value
      'TM(12%:44)', // Invalid range
      'TS(10:90%)', // Invalid range
    ];

    invalidValues.forEach((invalid) => {
      expect(parseStatisticOption(invalid, 'Average')).toBe('Average');
    });
  });

  // Test for Edge Cases based on AWS documentation
  test('handles edge cases correctly', () => {
    // Edge case: Mixed case with spaces for standard statistics
    expect(parseStatisticOption('  aVeRaGe  ', 'Maximum')).toBe('Average');

    // Edge case: Equivalent notations according to docs
    expect(parseStatisticOption('tm99', 'Average')).toBe('tm99');
    expect(parseStatisticOption('TM(:99%)', 'Average')).toBe('TM(:99%)');

    // Edge case: Decimal place precision in percentiles (valid per AWS docs)
    expect(parseStatisticOption('p99.9', 'Average')).toBe('p99.9');
    expect(parseStatisticOption('tm99.9', 'Average')).toBe('tm99.9');
    expect(parseStatisticOption('TM(10.5%:90.5%)', 'Average')).toBe(
      'TM(10.5%:90.5%)',
    );

    // Edge case: Valid format with boundary values
    expect(parseStatisticOption('p0', 'Average')).toBe('p0');
    expect(parseStatisticOption('p100', 'Average')).toBe('p100');
  });

  // Edge case: Empty strings
  expect(parseStatisticOption(' ', 'Average')).toBe('Average');
  expect(parseStatisticOption('tm(:)', 'Average')).toBe('Average');

  // Edge Case: All zeros
  expect(parseStatisticOption('0', 'Average')).toBe('Average');
  expect(parseStatisticOption('0.0', 'Average')).toBe('Average');
  expect(parseStatisticOption('WM(0.000:0', 'Average')).toBe('Average');
  expect(parseStatisticOption('TS(0:0)', 'Average')).toBe('Average');
  expect(parseStatisticOption('TS(0.001:0.001)', 'Average')).toBe(
    'TS(0.001:0.001)',
  );
});

/** parseMetricAlarmOptions tests for missing data treatment and integer parsing. */
describe('parseMetricAlarmOptions', () => {
  const defaults: MetricAlarmOptions = {
    warningThreshold: 1,
    criticalThreshold: 2,
    period: 60,
    evaluationPeriods: 5,
    statistic: 'Average',
    dataPointsToAlarm: 4,
    comparisonOperator: 'GreaterThanThreshold',
    missingDataTreatment: 'missing',
  };

  // Tag format: warning/critical/period/evalPeriods/statistic/datapoints/operator/missingDataTreatment
  test('parses documented missing data treatment values (enum values)', () => {
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/notBreaching',
        defaults,
      ).missingDataTreatment,
    ).toBe('notBreaching');
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/NOTBREACHING',
        defaults,
      ).missingDataTreatment,
    ).toBe('notBreaching');
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/ignore',
        defaults,
      ).missingDataTreatment,
    ).toBe('ignore');
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/breaching',
        defaults,
      ).missingDataTreatment,
    ).toBe('breaching');
  });

  test('accepts legacy enum key spellings and maps them to enum values', () => {
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/not_breaching',
        defaults,
      ).missingDataTreatment,
    ).toBe('notBreaching');
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/NOT_BREACHING',
        defaults,
      ).missingDataTreatment,
    ).toBe('notBreaching');
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/IGNORE',
        defaults,
      ).missingDataTreatment,
    ).toBe('ignore');
  });

  test('falls back to default for invalid missing data treatment values', () => {
    expect(
      parseMetricAlarmOptions(
        '1/2/60/5/Average/4/GreaterThanThreshold/bogus',
        defaults,
      ).missingDataTreatment,
    ).toBe('missing');
  });

  test('rejects non-integer and non-positive integer options', () => {
    // 2.5 evaluation periods is invalid - fall back to default
    expect(
      parseMetricAlarmOptions('1/2/60/2.5/Average/4', defaults)
        .evaluationPeriods,
    ).toBe(5);
    // 0 and negative values are invalid - fall back to default
    expect(parseMetricAlarmOptions('1/2/0/5/Average/4', defaults).period).toBe(
      60,
    );
    expect(
      parseMetricAlarmOptions('1/2/60/5/Average/-3', defaults)
        .dataPointsToAlarm,
    ).toBe(4);
    // Valid positive integers are accepted
    expect(
      parseMetricAlarmOptions('1/2/300/3/Average/2', defaults).period,
    ).toBe(300);
    expect(
      parseMetricAlarmOptions('1/2/300/3/Average/2', defaults)
        .evaluationPeriods,
    ).toBe(3);
    expect(
      parseMetricAlarmOptions('1/2/300/3/Average/2', defaults)
        .dataPointsToAlarm,
    ).toBe(2);
  });
});
