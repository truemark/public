import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {SQSRecord} from 'aws-lambda';
import {CloudWatchClient} from '@aws-sdk/client-cloudwatch';
import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs';
import {ECSClient} from '@aws-sdk/client-ecs';
import {parseECSEventAndCreateAlarms} from './ecs-modules.mjs';
import {parseLogGroupEventAndCreateAlarms} from './loggroup-modules.mjs';

const ACCOUNT_ID = '123456789012';

function record(body: unknown): SQSRecord {
  return {messageId: 'm-1', body: JSON.stringify(body)} as SQSRecord;
}

describe('events AutoAlarm cannot act on', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'us-west-2';
    // Any AWS call means the event was treated as actionable.
    for (const client of [CloudWatchClient, CloudWatchLogsClient, ECSClient]) {
      vi.spyOn(client.prototype, 'send').mockRejectedValue(
        new Error('Unexpected AWS call') as never,
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('an ECS service ARN with no cluster fails the record', async () => {
    const event = record({
      source: 'aws.ecs',
      detail: {
        eventName: 'TagResource',
        requestParameters: {
          resourceArn: `arn:aws:ecs:us-west-2:${ACCOUNT_ID}:service/orders`,
        },
      },
    });

    await expect(
      parseECSEventAndCreateAlarms(event, ACCOUNT_ID),
    ).rejects.toThrow('Invalid ECS service ARN format');
  });

  test('an ECS event that names no service is skipped', async () => {
    const event = record({
      source: 'aws.ecs',
      detail: {
        eventName: 'TagResource',
        requestParameters: {
          resourceArn: `arn:aws:ecs:us-west-2:${ACCOUNT_ID}:cluster/main`,
        },
      },
    });

    await expect(
      parseECSEventAndCreateAlarms(event, ACCOUNT_ID),
    ).resolves.toBeUndefined();
  });

  test('a tag event for a Logs resource that is not a log group is skipped', async () => {
    const event = record({
      source: 'aws.logs',
      region: 'us-west-2',
      account: ACCOUNT_ID,
      detail: {
        eventName: 'TagResource',
        requestParameters: {
          resourceArn: `arn:aws:logs:us-west-2:${ACCOUNT_ID}:delivery-source:app`,
          tags: {team: 'platform'},
        },
      },
    });

    await expect(
      parseLogGroupEventAndCreateAlarms(event),
    ).resolves.toBeUndefined();
  });
});
