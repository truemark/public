import {createHash} from 'node:crypto';
import {Stack} from 'aws-cdk-lib';
import {FilterPattern} from 'aws-cdk-lib/aws-logs';
import {Construct} from 'constructs';
import {LogMetricAlarm} from 'truemark-cdk-lib/aws-cloudwatch';
import {
  ExtendedNodejsFunction,
  ExtendedNodejsFunctionProps,
} from 'truemark-cdk-lib/aws-lambda';

/**
 * Matches a log event on its structured level, not on the text "ERROR".
 *
 * The handlers log through pino, which writes a numeric level (50 = error,
 * 60 = fatal), so their own errors never contain the word ERROR and a text
 * match misses them. The Lambda runtime writes a string level instead when it
 * reports an uncaught exception. Both forms are needed to cover a function.
 */
export const ERROR_LEVEL_LOG_PATTERN = FilterPattern.any(
  FilterPattern.numberValue('$.level', '>=', 50),
  FilterPattern.stringValue('$.level', '=', 'ERROR'),
  FilterPattern.stringValue('$.level', '=', 'FATAL'),
).logPatternString;

/**
 * Builds the name shared by a function's log group and its log metric.
 *
 * The hash covers the function's own construct path. truemark-cdk-lib's
 * default takes the first 8 characters of the parent's unique id, which is
 * the start of the path and not its hash, so two functions with the same id
 * under different parents get the same name and the second fails to deploy.
 *
 * The name is not truncated: a log group name may be 512 characters, and
 * cutting it could remove the hash that makes it unique.
 *
 * @param scope The parent scope of the function.
 * @param id The construct id of the function.
 */
export function functionLogName(scope: Construct, id: string): string {
  const hash = createHash('sha256')
    .update(`${scope.node.path}/${id}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `${Stack.of(scope).stackName}-${id}-${hash}`;
}

/**
 * ExtendedNodejsFunction with an error log alarm that belongs to this function
 * alone.
 *
 * The library's own log alarm is turned off because every function it is
 * attached to publishes to one metric, TrueMark/Logs CriticalLogCount, with no
 * dimensions. An error line from any function in the account, AutoAlarm's or
 * not, puts all of those alarms into ALARM together.
 *
 * The replacement uses a metric name per function instead of a dimension. A
 * metric filter can only take a dimension's value from a field of the log
 * event, and the Lambda runtime's own error lines have no field that names
 * the function.
 */
export class AutoAlarmFunction extends ExtendedNodejsFunction {
  readonly criticalLogAlarm: LogMetricAlarm;

  constructor(
    scope: Construct,
    id: string,
    props: ExtendedNodejsFunctionProps,
  ) {
    const name = functionLogName(scope, id);
    const logGroupName = `/aws/lambda/${name}`;
    super(scope, id, {
      ...props,
      logConfig: {...props.logConfig, logGroupName},
      criticalAlarmOptions: {...props.criticalAlarmOptions, maxLogCount: 0},
    });
    this.criticalLogAlarm = new LogMetricAlarm(this, 'CriticalLogCount', {
      logGroup: this.logGroup,
      pattern: ERROR_LEVEL_LOG_PATTERN,
      metricName: `${name}-CriticalLogCount`,
      alarmDescription: `${id} logged at error level or above. Covers only this function; see ${logGroupName}.`,
    });
  }
}
