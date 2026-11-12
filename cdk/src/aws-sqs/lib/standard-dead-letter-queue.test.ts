import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {StandardDeadLetterQueue} from '../index';

test('StandardDeadLetterQueue creates its alarm by default', () => {
  const stack = HelperTest.stack();
  const queue = new StandardDeadLetterQueue(stack, 'Failed');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
    MetricName: 'ApproximateNumberOfMessagesVisible',
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Threshold: 1,
  });
  expect(queue.alarm).toBeDefined();
});

test('StandardDeadLetterQueue createAlarm: false creates no alarm', () => {
  const stack = HelperTest.stack();
  const queue = new StandardDeadLetterQueue(stack, 'Failed', {
    createAlarm: false,
  });
  Template.fromStack(stack).resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 0);
  expect(() => queue.alarm).toThrow(/createAlarm/);
});
