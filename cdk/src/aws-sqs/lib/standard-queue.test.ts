import type {Stack} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {type CfnQueue, QueueEncryption} from 'aws-cdk-lib/aws-sqs';
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

// Alarms on the dead letter queue's visible-message count, the condition both
// StandardDeadLetterQueue's own alarm and QueueAlarms watch.
function deadLetterQueueDepthAlarms(stack: Stack, queue: StandardQueue) {
  const deadLetterQueue = queue.queue.deadLetterQueue?.queue;
  if (deadLetterQueue === undefined) {
    throw new Error('queue has no dead letter queue');
  }
  const queueName = JSON.stringify(stack.resolve(deadLetterQueue.queueName));
  return Object.values(
    Template.fromStack(stack).findResources('AWS::CloudWatch::Alarm'),
  ).filter((alarm) => {
    const json = JSON.stringify(alarm);
    return (
      json.includes(queueName) &&
      json.includes('ApproximateNumberOfMessagesVisible')
    );
  });
}

test('StandardQueue keeps both dead letter queue depth alarms by default', () => {
  const stack = HelperTest.stack();
  const queue = new StandardQueue(stack, 'Orders');
  expect(deadLetterQueueDepthAlarms(stack, queue)).toHaveLength(2);
});

test('StandardQueue createDeadLetterQueueAlarm: false leaves only the QueueAlarms dead letter queue depth alarm', () => {
  const stack = HelperTest.stack();
  const queue = new StandardQueue(stack, 'Orders', {
    createDeadLetterQueueAlarm: false,
  });
  const alarms = deadLetterQueueDepthAlarms(stack, queue);
  expect(alarms).toHaveLength(1);
  expect(alarms[0].Properties.AlarmName).toEqual(
    'TestStack-Orders-DLQ-Queue-Message-Count-Max-Critical',
  );
});

test('StandardQueue passes contentBasedDeduplication to the queue but not its dead letter queue', () => {
  const stack = HelperTest.stack();
  const queue = new StandardQueue(stack, 'Orders', {
    fifo: true,
    contentBasedDeduplication: true,
  });
  const queues = Template.fromStack(stack).findResources('AWS::SQS::Queue');
  const queueId = stack.getLogicalId(queue.queue.node.defaultChild as CfnQueue);
  expect(queues[queueId].Properties).toMatchObject({
    FifoQueue: true,
    ContentBasedDeduplication: true,
  });
  const deadLetterQueues = Object.entries(queues).filter(
    ([id]) => id !== queueId,
  );
  expect(deadLetterQueues).toHaveLength(1);
  expect(deadLetterQueues[0][1].Properties.FifoQueue).toEqual(true);
  expect(
    deadLetterQueues[0][1].Properties.ContentBasedDeduplication,
  ).toBeUndefined();
});

test('StandardQueue rejects contentBasedDeduplication without fifo', () => {
  const stack = HelperTest.stack();
  expect(
    () => new StandardQueue(stack, 'Orders', {contentBasedDeduplication: true}),
  ).toThrow('contentBasedDeduplication requires fifo: true');
});
