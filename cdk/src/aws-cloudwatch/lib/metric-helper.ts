import {Duration} from 'aws-cdk-lib';
import {Metric} from 'aws-cdk-lib/aws-cloudwatch';

export class MetricHelper {
  static billingEstimatedCharges(): Metric {
    return new Metric({
      metricName: 'EstimatedCharges',
      namespace: 'AWS/Billing',
      statistic: 'Maximum',
      dimensionsMap: {
        Currency: 'USD',
      },
      period: Duration.hours(12),
    });
  }
}
