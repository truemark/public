import {ComparisonOperator, type Metric} from 'aws-cdk-lib/aws-cloudwatch';
import type {Construct} from 'constructs';
import {ExtendedAlarm} from './extended-alarm';
import {MetricAlarmBase, type MetricAlarmBaseProps} from './metric-alarm-base';
import {MetricHelper} from './metric-helper';

export interface EstimatedChargesAlarmProps extends MetricAlarmBaseProps {
  /**
   * Amount in USD the estimated charges must be greater than to trigger the alarm.
   */
  readonly maxMonthly: number;
}

/**
 * Creates an alarm for estimated charges on an account.
 */
export class EstimatedChargesAlarm extends MetricAlarmBase {
  // biome-ignore lint/complexity/noUselessConstructor: narrows the props type for jsii
  constructor(scope: Construct, id: string, props: EstimatedChargesAlarmProps) {
    super(scope, id, props);
  }

  protected createMetric(_props: MetricAlarmBaseProps): Metric {
    return MetricHelper.billingEstimatedCharges();
  }

  protected createAlarm(
    metric: Metric,
    props: MetricAlarmBaseProps,
  ): ExtendedAlarm {
    const {maxMonthly, ...rest} = props as EstimatedChargesAlarmProps;
    return new ExtendedAlarm(this, 'Alarm', {
      ...rest,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      metric,
      threshold: maxMonthly,
    });
  }
}
