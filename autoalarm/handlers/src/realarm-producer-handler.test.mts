import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cloudwatch';
import {SQSClient} from '@aws-sdk/client-sqs';
import {Context} from 'aws-lambda';
import {handler} from './realarm-producer-handler.mjs';

/**
 * Runs the producer for one override alarm, the shortest path that reaches
 * SendMessageBatch, with the AWS clients stubbed at the SDK boundary.
 */
describe('ReAlarm producer', () => {
  const overrideEvent = {'reAlarmOverride-AlarmName': 'AutoAlarm-test'};
  let sqsSend: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CONSUMER_QUEUE_URL = 'https://sqs.example/consumer.fifo';
    vi.spyOn(CloudWatchClient.prototype, 'send').mockImplementation((async (
      command: unknown,
    ) => {
      if (command instanceof DescribeAlarmsCommand) {
        return {
          MetricAlarms: [
            {
              AlarmName: 'AutoAlarm-test',
              AlarmArn: 'arn:aws:cloudwatch:us-west-2:123456789012:alarm:x',
              StateValue: 'ALARM',
            },
          ],
        };
      }
      if (command instanceof ListTagsForResourceCommand) {
        return {Tags: []};
      }
      throw new Error('Unexpected CloudWatch command');
    }) as never);
    sqsSend = vi.spyOn(SQSClient.prototype, 'send');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CONSUMER_QUEUE_URL;
  });

  test('fails the run when SQS rejects an entry in a successful response', async () => {
    sqsSend.mockResolvedValue({
      Successful: [],
      Failed: [{Id: '0-0', Code: 'InternalError', SenderFault: false}],
    } as never);

    await expect(
      handler(overrideEvent, {} as Context, () => {}),
    ).rejects.toThrow('SQS rejected 1 of 1 messages: InternalError');
  });

  test('succeeds when SQS accepts every entry', async () => {
    sqsSend.mockResolvedValue({
      Successful: [{Id: '0-0'}],
      Failed: [],
    } as never);

    await expect(
      handler(overrideEvent, {} as Context, () => {}),
    ).resolves.toBeUndefined();
    expect(sqsSend).toHaveBeenCalledTimes(1);
  });
});
