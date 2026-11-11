import {Template} from 'aws-cdk-lib/assertions';
import {Metric} from 'aws-cdk-lib/aws-cloudwatch';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';
import {Topic} from 'aws-cdk-lib/aws-sns';
import {expect, test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {ExtendedAlarm} from '../index';

test('ExtendedAlarm puts each action list on its own alarm state', () => {
  const stack = HelperTest.stack();
  const alarmTopic = new Topic(stack, 'AlarmTopic');
  const okTopic = new Topic(stack, 'OkTopic');
  const insufficientDataTopic = new Topic(stack, 'InsufficientDataTopic');
  new ExtendedAlarm(stack, 'Alarm', {
    metric: new Metric({namespace: 'Test', metricName: 'Errors'}),
    threshold: 1,
    evaluationPeriods: 1,
    alarmActions: [new SnsAction(alarmTopic)],
    okActions: [new SnsAction(okTopic)],
    insufficientDataActions: [new SnsAction(insufficientDataTopic)],
  });
  const ref = (topic: Topic) => stack.resolve(topic.topicArn);
  const alarms = Template.fromStack(stack).findResources(
    ResourceType.CLOUDWATCH_ALARM,
  );
  const [alarm] = Object.values(alarms);
  expect(alarm.Properties.AlarmActions).toEqual([ref(alarmTopic)]);
  expect(alarm.Properties.OKActions).toEqual([ref(okTopic)]);
  expect(alarm.Properties.InsufficientDataActions).toEqual([
    ref(insufficientDataTopic),
  ]);
});
