import {Construct} from 'constructs';
import {ILogGroup, MetricFilter} from 'aws-cdk-lib/aws-logs';
import {Duration} from 'aws-cdk-lib';
import {Metric} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * Properties for LogMetricFilter.
 */
export interface LogMetricFilterProps {
  /**
   * The namespace of the metric to emit.
   *
   * @default 'TrueMark/Logs'
   */
  readonly metricNamespace?: string;

  /**
   * The name of the metric to emit.
   */
  readonly metricName: string;

  /**
   * The pattern to apply to the logs.
   */
  readonly pattern: string;

  /**
   * The log group to create the filter on.
   */
  readonly logGroup: ILogGroup;
}

/**
 * MetricFilter that counts the number of records matching the provided pattern.
 */
export class LogMetricFilter extends MetricFilter {
  /**
   * Creates a new LogMetricFilter
   */
  constructor(scope: Construct, id: string, props: LogMetricFilterProps) {
    super(scope, id, {
      ...props,
      metricNamespace: props.metricNamespace ?? 'TrueMark/Logs',
      defaultValue: 0,
      metricValue: '1',
      filterPattern: {
        logPatternString: props.pattern,
      },
    });
  }

  /**
   * Returns the sum metric for this filter.
   *
   * @param period the period over which statistics are applied (default is 5 minutes)
   */
  sumMetric(period?: Duration): Metric {
    return this.metric({
      statistic: 'Sum',
      period: period ?? Duration.minutes(5),
    });
  }
}
