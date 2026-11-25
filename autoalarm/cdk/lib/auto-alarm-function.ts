import {createHash} from 'node:crypto';
import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {LogMetricAlarm} from 'truemark-cdk-lib/aws-cloudwatch';
import {
  ExtendedNodejsFunction,
  ExtendedNodejsFunctionProps,
} from 'truemark-cdk-lib/aws-lambda';

/**
 * Matches an error line from either of the two sources a function has, as one
 * regular expression over the raw text of the log event.
 *
 * `ERROR` covers lines the handlers do not write themselves: the Lambda
 * runtime reporting an uncaught exception (`"level":"ERROR"`), and a
 * dependency printing the word, which Lambda records at INFO when it comes
 * through `console.log`. A match on the level field alone would miss the
 * second kind.
 *
 * `"level":50` and `"level":60` cover the handlers' own errors. They log
 * through pino, which writes a numeric level (50 = error, 60 = fatal) and
 * messages such as "Error deleting alarms". Filter patterns are case
 * sensitive, so the word alone would miss every one of them.
 *
 * The quote is written as `\x22` because CloudWatch's regex syntax accepts no
 * literal double quote. A log group may have at most 5 filters that use a
 * regex; each function's group has this one.
 */
export const ERROR_LOG_PATTERN = '%ERROR|\\x22level\\x22:[56]0%';

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
      pattern: ERROR_LOG_PATTERN,
      metricName: `${name}-CriticalLogCount`,
      alarmDescription: `${id} logged an error. Covers only this function; see ${logGroupName}.`,
    });
  }
}
