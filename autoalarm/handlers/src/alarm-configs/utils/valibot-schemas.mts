import {string, check, pipe} from 'valibot';
import {Statistic} from '@aws-sdk/client-cloudwatch';

/*****************************************************
 *                  STATISTICS SCHEMAS
 *****************************************************/

// Validate a Standard Statistic (e.g., "Average" "Maximum" "Minimum" "SampleCount" "Sum")
export const standardStatSchema = pipe(
  string(),
  check(
    (value: string) => {
      // Check if the value is a valid standard statistic
      const validStandardStat = Object.values(Statistic).find(
        (stat) => stat === value,
      );

      // Fail the validation if no match is found
      return !!validStandardStat;
    },
    (value) =>
      `Invalid statistic "${value}" - Must be one of ${Object.values(Statistic).join(', ')}`,
  ),
);

// Validate single value extended stats: <=3 chars (e.g., "p1" "tm22" "tc3" "ts4" "wm59", "IQM")
export const singleValSchema = pipe(
  string(),
  check(
    (value: string) => {
      // Anchored across the whole expression (so e.g. "maxp95" is rejected) and
      // supports decimal percentiles (p99.9) as well as 100 (p100).
      const isValidSingleStat =
        /^(IQM|(p|tm|tc|ts|wm)(100|[0-9]{1,2}(\.[0-9]+)?))$/;
      return isValidSingleStat.test(value);
    },
    (value) =>
      `Invalid statistic "${value}" - Must be one of the following formats: IQM, p1, p99.9, p100, tm22, tc3, ts4, wm59`,
  ),
);

// Combined Range and Value-Type Validation
export const rangePatternSchema = pipe(
  string(),
  check(
    (value: string) => {
      // Regexes
      const validRange =
        /^(TM|WM|PR|TC|TS)(\(([^:]*):([^)]*)\)|([^:]*):([^)]*))$/; // Broad Regex to fuzzy match a valid range
      const allZero = /^0(\.0+)?$/;
      const validNumber = /^\d+(\.\d+)?$/;
      const validPercent = /^([0-9]{1,2}(\.[0-9])?|99\.9)%$/;

      // Check if the value loosely follows the format of a valid range and early failure if it is not
      if (!validRange.test(value)) return false;

      // Extract the extended Statistic expression from the value
      const rangeContent = value.substring(2);

      // Split the range content into start and end parts and return false if parts > 3
      const parts = rangeContent.replace(/[()]/g, '').split(':');
      if (parts.length > 2) return false;

      const [start, end] = [parts[0], parts[1]];

      const arePartsValid = [start, end].every(
        (part) =>
          part === '' || validNumber.test(part) || validPercent.test(part),
      );

      const isAllZero = [start, end].every((part) => allZero.test(part));

      const isEmpty = [start, end].every((part) => part === '');

      // Checks for unbounded ranges (e.g., TM(22:) or TM(:33%)) - Valid
      const isUnbounded =
        (start === '' && !isEmpty) || (end === '' && !isEmpty);

      const isMixed =
        !isUnbounded && validPercent.test(start) !== validPercent.test(end);

      // Check if parentheses are required (for unbounded ranges or percentiles) and present
      const needsWrapping =
        isUnbounded || validPercent.test(start) || rangeContent.includes(':');
      const isWrapped =
        rangeContent.startsWith('(') && rangeContent.endsWith(')');
      if (needsWrapping && !isWrapped) return false;

      return arePartsValid && !(isEmpty || isAllZero || isMixed);
    },

    (value) =>
      `Invalid or mismatched range values in "${value}": Must follow pattern PREFIX'start:end' with 
    a colon separating the values in addition to valid numbers or percentages and not both zero/empty. If percentages
    or unbounded ranges are used, parentheses are required. Valid prefixes: TM, WM, PR, TC, TS. Valid formats: TM(22:), 
    TM(:33%), TM(22:33%), TM(22:33)`,
  ),
);

/*****************************************************
 *                  TBD SCHEMAS
 *****************************************************/
