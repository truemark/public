import {
  MissingDataTreatment,
  MetricAlarmOptions,
  ValidStatistic,
} from '../../types/index.mjs';
import {safeParse} from 'valibot';
import {TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';
import {ComparisonOperator} from '@aws-sdk/client-cloudwatch';
import {
  rangePatternSchema,
  singleValSchema,
  standardStatSchema,
} from './valibot-schemas.mjs';
import * as logging from '@nr1e/logging';

// Initialize logging
const level = process.env.LOG_LEVEL || 'info';
if (!logging.isLevel(level)) {
  throw new Error(`Invalid log level: ${level}`);
}
const log = logging.initialize({
  svc: 'AutoAlarm',
  name: 'alarm-config',
  level,
});

export function metricAlarmOptionsToString(value: MetricAlarmOptions): string {
  return (
    (value.warningThreshold ? value.warningThreshold : '-') +
    '/' +
    (value.criticalThreshold ? value.criticalThreshold : '-') +
    '/' +
    value.period +
    '/' +
    value.evaluationPeriods +
    '/' +
    value.statistic +
    '/' +
    value.dataPointsToAlarm +
    '/' +
    value.comparisonOperator +
    '/' +
    value.missingDataTreatment
  );
}

function parseThresholdOption(
  value: string,
  defaultValue: number | null,
): number | null {
  const trimmed = value.trim();
  if (trimmed === '-') {
    return null;
  }
  if (trimmed === '') {
    return defaultValue;
  }
  const parsedValue = parseFloat(trimmed);

  if (isNaN(parsedValue)) {
    return defaultValue;
  }

  return parsedValue;
}

function parseIntegerOption(value: string, defaultValue: number): number {
  const trimmed = value.trim();
  if (trimmed === '') {
    return defaultValue;
  }
  const parsedValue = parseFloat(trimmed);

  if (isNaN(parsedValue)) {
    return defaultValue;
  }

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    log
      .warn()
      .str('Function', 'parseIntegerOption')
      .str('Input', value)
      .num('DefaultValue', defaultValue)
      .msg(
        'Value is not a positive integer. Falling back to the default value.',
      );
    return defaultValue;
  }

  return parsedValue;
}

export function parseStatisticOption(
  exp: string,
  defaultValue: ValidStatistic,
): ValidStatistic {
  // Base formatting normalization for validating statistics
  let trim = exp.trim().toLowerCase();
  trim === 'iqm'
    ? (trim = 'IQM') // Account for IQM as all caps and single word expression
    : trim === 'samplecount'
      ? (trim = 'SampleCount') // Account for SampleCount with CamelCase
      : exp.trim().toLowerCase();

  // Early return if we match IQM or SampleCount
  if (trim === 'IQM' || trim === 'SampleCount') return trim as ValidStatistic;

  // Normalize Value to match the various expected Valid Statistics values
  const statVariants = [
    {
      schema: standardStatSchema,
      value: trim.charAt(0).toUpperCase() + trim.slice(1), // e.g., "Average" "Maximum" "Minimum" "Sum"
    },
    {
      schema: singleValSchema,
      value: trim, // e.g., "p1", "tm22", "tc3", "ts4", "wm59"
    },
    {
      schema: rangePatternSchema,
      value: trim.substring(0, 2).toUpperCase() + trim.substring(2), // e.g., "TM12:55", "WM(:24)", "TC44:76"
    },
  ];

  // Valibot validation for each variant in statVariants
  const match = statVariants.find((v) => {
    const result = safeParse(v.schema, v.value as string);
    if (!result.success) {
      log
        .warn()
        .str('Function', 'parseStatisticOption')
        .str('Input', exp)
        .str('CoercedValue', v.value)
        .obj('ValibotError', result.issues)
        .obj('ValibotResult', result.output as object)
        .msg('Valibot Validation Failed');
      return false;
    }
    return true;
  });

  // If a match is found, return the value, otherwise return the default value
  return match ? (match.value as ValidStatistic) : defaultValue;
}

function parseComparisonOperatorOption(
  value: string,
  defaultValue: ComparisonOperator,
): ComparisonOperator {
  // Check if a normalized value input is a valid comparison operator
  const validOperator = Object.keys(ComparisonOperator).find(
    (operator) => operator.toLowerCase() === value.trim().toLowerCase(),
  );

  // If it's a valid operator, return it
  if (validOperator) {
    return validOperator as ComparisonOperator;
  }

  // If not a valid comparison operator, return the default value
  return defaultValue;
}

function parseMissingDataTreatmentOption(
  value: string,
  defaultValue: MissingDataTreatment,
): MissingDataTreatment {
  const normalized = value.trim().toLowerCase();

  // Match against the enum VALUES first (e.g. 'notBreaching', 'ignore') which
  // are the documented tag values and what the CloudWatch API expects.
  const validDataTreatmentValue = Object.values(TreatMissingData).find(
    (treatment) => treatment.toLowerCase() === normalized,
  );

  if (validDataTreatmentValue) {
    return validDataTreatmentValue as MissingDataTreatment;
  }

  // Fall back to matching the legacy enum KEY spellings (e.g. 'NOT_BREACHING')
  // so existing tags using those values keep working. Return the mapped VALUE.
  const validDataTreatmentKey = Object.keys(TreatMissingData).find(
    (key) => key.toLowerCase() === normalized,
  );

  if (validDataTreatmentKey) {
    return TreatMissingData[
      validDataTreatmentKey as keyof typeof TreatMissingData
    ];
  }

  return defaultValue;
}

export function parseMetricAlarmOptions(
  value: string,
  defaults: MetricAlarmOptions,
): MetricAlarmOptions {
  const parts = value.split('/');
  return {
    warningThreshold:
      parts.length > 0
        ? parseThresholdOption(parts[0], defaults.warningThreshold)
        : defaults.warningThreshold,
    criticalThreshold:
      parts.length > 1
        ? parseThresholdOption(parts[1], defaults.criticalThreshold)
        : defaults.criticalThreshold,
    period:
      parts.length > 2
        ? parseIntegerOption(parts[2], defaults.period)
        : defaults.period,
    evaluationPeriods:
      parts.length > 3
        ? parseIntegerOption(parts[3], defaults.evaluationPeriods)
        : defaults.evaluationPeriods,
    statistic:
      parts.length > 4
        ? parseStatisticOption(parts[4], defaults.statistic)
        : defaults.statistic,
    dataPointsToAlarm:
      parts.length > 5
        ? parseIntegerOption(parts[5], defaults.dataPointsToAlarm)
        : defaults.dataPointsToAlarm,
    comparisonOperator:
      parts.length > 6
        ? (parseComparisonOperatorOption(
            parts[6],
            defaults.comparisonOperator,
          ) satisfies ComparisonOperator)
        : (defaults.comparisonOperator satisfies ComparisonOperator),
    missingDataTreatment:
      parts.length > 7
        ? (parseMissingDataTreatmentOption(
            parts[7],
            defaults.missingDataTreatment,
          ) satisfies MissingDataTreatment)
        : (defaults.missingDataTreatment satisfies MissingDataTreatment),
  };
}
