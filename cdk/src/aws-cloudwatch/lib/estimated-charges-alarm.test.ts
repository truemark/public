import {ResourceType, HelperTest} from '../../helper.test';
import {EstimatedChargesAlarm} from '../index';
import {Template} from 'aws-cdk-lib/assertions';

test('Create EstimatedChargesAlarm', () => {
  const stack = HelperTest.stack();
  new EstimatedChargesAlarm(stack, 'EstimatedChargesAlarm', {
    maxMonthly: 10,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
    ComparisonOperator: 'GreaterThanThreshold',
    Statistic: 'Maximum',
    MetricName: 'EstimatedCharges',
    Namespace: 'AWS/Billing',
    EvaluationPeriods: 1,
    Dimensions: [
      {
        Name: 'Currency',
        Value: 'USD',
      },
    ],
  });
  // TODO I (Erik) cannot figure out how to assert in the test the threshold was actually set to 10. If you figure it out, let me know.
});
