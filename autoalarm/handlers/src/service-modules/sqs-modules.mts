import {SQSClient, ListQueueTagsCommand} from '@aws-sdk/client-sqs';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {SQS_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('sqs-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const sqsClient: SQSClient = new SQSClient({
  region,
  retryStrategy,
});

const metricConfigs = SQS_CONFIGS;

export async function fetchSQSTags(queueUrl: string): Promise<Tag> {
  return fetchResourceTags('SQS', queueUrl, async () => {
    const command = new ListQueueTagsCommand({QueueUrl: queueUrl});
    const response = await sqsClient.send(command);
    return response.Tags || {};
  });
}

export async function manageSQSAlarms(
  queueName: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'SQS',
    identifier: queueName,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'QueueName', Value: queueName}],
  });
}

export async function manageInactiveSQSAlarms(queueUrl: string) {
  const queueName = extractQueueName(queueUrl);
  try {
    await deleteExistingAlarms('SQS', queueName, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveSQSAlarms')
      .err(e)
      .msg(`Error deleting SQS alarms: ${e}`);
    throw new Error(`Error deleting SQS alarms: ${e}`);
  }
}

function extractQueueName(queueUrl: string): string {
  if (!queueUrl) {
    log
      .error()
      .str('function', 'extractQueueName')
      .str('queueUrl', queueUrl ? queueUrl : 'undefined')
      .msg('Invalid queue URL: Queue name not found');
    throw new Error('Invalid queue URL: Queue name not found');
  }
  const parts = queueUrl.split('/');
  log
    .debug()
    .str('function', 'extractQueueName')
    .str('queueUrl', queueUrl)
    .str('parts', JSON.stringify(parts))
    .str('queueName', parts.at(-1)!)
    .msg('Extracted queue name');
  return parts.at(-1)!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseSQSEventAndCreateAlarms(event: any): Promise<{
  queueUrl: string;
  eventType: string;
  tags: Record<string, string>;
} | void> {
  let queueUrl: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateQueue': {
          queueUrl = event.detail.responseElements?.queueUrl;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseSQSEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('queueUrl', queueUrl)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateQueue event');

          /**
           * TODO: Hot fix to prevent work when a queue is created without autoalarm:enabled, true
           *  will be addressed in a more elegant way in future refactors.
           */
          const eventTags = event.detail.requestParameters?.tags;
          if (
            !eventTags ||
            !eventTags['autoalarm:enabled'] ||
            eventTags['autoalarm:enabled'] !== 'true'
          ) {
            log
              .warn()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .obj('tags', event.detail.requestParameters)
              .msg(
                'sqs queue created without autoalarm:enabled tag, skipping alarm management',
              );
            return; // Skip alarm management if tag is not present
          }
          if (queueUrl) {
            tags = await fetchSQSTags(queueUrl);
            log
              .info()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('queueUrl', queueUrl)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new SQS queue');
          } else {
            log
              .error()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('QueueUrl not found in CreateQueue event');
            throw new Error('QueueUrl not found in CreateQueue event');
          }
          break;
        }

        case 'DeleteQueue':
          queueUrl = event.detail.requestParameters?.queueUrl;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseSQSEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('queueUrl', queueUrl)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteQueue event');
          break;

        case 'TagQueue':
          eventType = 'TagChange';
          queueUrl = event.detail.requestParameters?.queueUrl;
          log
            .info()
            .str('function', 'parseSQSEventAndCreateAlarms')
            .str('eventType', 'TagQueue')
            .str('queueUrl', queueUrl)
            .str('requestId', event.detail.requestID)
            .msg('Processing TagQueue event');
          if (queueUrl) {
            tags = await fetchSQSTags(queueUrl);
            log
              .info()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('queueUrl', queueUrl)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new SQS queue');
          } else {
            log
              .error()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('eventType', 'TagQueue')
              .msg('QueueUrl not found in TagQueue event');
            throw new Error('Queue not found in TagQueue event');
          }
          break;

        case 'UntagQueue':
          eventType = 'TagChange';
          queueUrl = event.detail.requestParameters?.queueUrl;
          log
            .info()
            .str('function', 'parseSQSEventAndCreateAlarms')
            .str('eventType', 'UntagQueue')
            .str('queueUrl', queueUrl)
            .msg('Processing UntagQueue event');
          if (queueUrl) {
            tags = await fetchSQSTags(queueUrl);
            log
              .info()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('queueUrl', queueUrl)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new SQS queue');
          } else {
            log
              .error()
              .str('function', 'parseSQSEventAndCreateAlarms')
              .str('eventType', 'UnTagQueue')
              .msg('QueueUrl not found in TagQueue event');
            throw new Error('Queue not found in TagQueue event');
          }
          break;

        default:
          log
            .error()
            .str('function', 'parseSQSEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
          throw new Error('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .error()
        .str('function', 'parseSQSEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
      throw new Error('Unexpected event type');
  }

  const queueName = extractQueueName(queueUrl);
  if (!queueName) {
    log
      .error()
      .str('function', 'parseSQSEventAndCreateAlarms')
      .str('queueUrl', queueUrl)
      .msg('Extracted queue name is empty');
    throw new Error('Extracted queue name is empty');
  }

  log
    .info()
    .str('function', 'parseSQSEventAndCreateAlarms')
    .str('queueUrl', queueUrl)
    .str('eventType', eventType)
    .msg('Finished processing SQS event');

  if (queueUrl && (eventType === 'Create' || eventType === 'TagChange')) {
    log
      .info()
      .str('function', 'parseSQSEventAndCreateAlarms')
      .str('queueUrl', queueUrl)
      .msg('Starting to manage SQS alarms');
    await manageSQSAlarms(queueName, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseSQSEventAndCreateAlarms')
      .str('queueUrl', queueUrl)
      .msg('Starting to manage inactive SQS alarms');
    await manageInactiveSQSAlarms(queueUrl);
  }

  return {queueUrl, eventType, tags};
}
