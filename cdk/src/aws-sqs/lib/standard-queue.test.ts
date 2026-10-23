import type {Stack} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {QueueEncryption} from 'aws-cdk-lib/aws-sqs';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {StandardQueue} from '../index';

test('Standard Queue Test', () => {
  const stack = HelperTest.stack();
  const test1Queue = new StandardQueue(stack, 'Test1', {
    encryption: QueueEncryption.SQS_MANAGED,
  });
  expect(test1Queue.encryption).toEqual(QueueEncryption.SQS_MANAGED);
  new StandardQueue(stack, 'Test2');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::SQS::Queue', {});
  // HelperTest.logResources(template, 'AWS::CloudWatch::Alarm');
  // console.log(template.findResources("AWS::CloudWatch::Alarm"));
  // console.log(
  //   JSON.stringify(template.findResources('AWS::SQS::Queue'), null, 2),
  // );
});

test('metricApproximateNumberOfMessagesOutstanding sums visible and in-flight messages of the queue', () => {
  const stack = HelperTest.stack();
  const queue = new StandardQueue(stack, 'Outstanding');
  const metric = queue.metricApproximateNumberOfMessagesOutstanding();
  expect(metric.expression).toEqual('visible + notVisible');
  expect(metric.usingMetrics.visible).toMatchObject({
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesVisible',
    dimensions: {QueueName: queue.queueName},
  });
  expect(metric.usingMetrics.notVisible).toMatchObject({
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesNotVisible',
    dimensions: {QueueName: queue.queueName},
  });
});

function secureTransportDenies(stack: Stack): number {
  const policies = Template.fromStack(stack).findResources(
    'AWS::SQS::QueuePolicy',
  );
  return Object.values(policies).filter((policy) =>
    JSON.stringify(policy).includes('aws:SecureTransport'),
  ).length;
}

test('StandardQueue enforces SSL on the dead letter queue only by default', () => {
  const stack = HelperTest.stack();
  new StandardQueue(stack, 'Default');
  expect(secureTransportDenies(stack)).toEqual(1);
});

test('StandardQueue enforceSSL applies to the queue and its dead letter queue', () => {
  const enforced = HelperTest.stack();
  new StandardQueue(enforced, 'Enforced', {enforceSSL: true});
  expect(secureTransportDenies(enforced)).toEqual(2);

  const relaxed = HelperTest.stack();
  new StandardQueue(relaxed, 'Relaxed', {enforceSSL: false});
  expect(secureTransportDenies(relaxed)).toEqual(0);
});
