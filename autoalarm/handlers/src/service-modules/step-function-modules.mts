import {SFNClient, ListTagsForResourceCommand} from '@aws-sdk/client-sfn';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {STEP_FUNCTION_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('step-function-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const sfnClient: SFNClient = new SFNClient({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = STEP_FUNCTION_CONFIGS;

export async function fetchSFNTags(sfnArn: string): Promise<Tag> {
  return fetchResourceTags(
    'SFN',
    sfnArn,
    async () => {
      const command = new ListTagsForResourceCommand({
        resourceArn: sfnArn,
      });
      const response = await sfnClient.send(command);
      const tags: Tag = {};

      response.tags?.forEach((tag) => {
        if (tag.key && tag.value) {
          tags[tag.key] = tag.value;
        }
      });

      return tags;
    },
    'return-empty',
  );
}

async function checkAndManageSFNStatusAlarms(
  sfnArn: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'SFN',
    identifier: sfnArn,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'StateMachineArn', Value: sfnArn}],
  });
}

export async function manageInactiveSFNAlarms(sfnArn: string): Promise<void> {
  try {
    await deleteExistingAlarms('SFN', sfnArn, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveSFNAlarms')
      .err(e)
      .msg(`Error deleting SFN alarms: ${e}`);
  }
}

export async function parseSFNEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: Record<string, any>,
): Promise<{
  sfnArn: string;
  eventType: string;
  tags: Record<string, string>;
} | void> {
  let sfnArn: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      sfnArn = event.resources?.[0] ?? '';
      if (!sfnArn) {
        log
          .error()
          .str('function', 'parseSFNEventAndCreateAlarms')
          .obj('event', event)
          .msg('No SFN ARN found in event for tag change event');
        throw new Error('No SFN ARN found in event');
      }
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseSFNEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('sfnArn', sfnArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');

      if (sfnArn) {
        tags = await fetchSFNTags(sfnArn);
        log
          .info()
          .str('function', 'parseSFNEventAndCreateAlarms')
          .str('sfnArn', sfnArn)
          .str('tags', JSON.stringify(tags))
          .msg('Fetched tags for new TagChange event');
      } else {
        log
          .error()
          .str('function', 'parseSFNEventAndCreateAlarms')
          .str('eventType', 'TagChance')
          .msg('SFN ARN not found in Tag Change event');
        throw new Error('SFN ARN not found in Tag Change event');
      }
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateStateMachine':
          // Failed events (AccessDenied, etc.) have no responseElements — skip.
          if (event.detail.errorCode) {
            log
              .info()
              .str('function', 'parseSFNEventAndCreateAlarms')
              .str('errorCode', event.detail.errorCode)
              .msg('Skipping failed CreateStateMachine event');
            return;
          }
          // Read the ARN from the structured response rather than string-mining
          // the event, which can match service-integration ARNs (e.g.
          // 'arn:aws:states:::lambda:invoke') inside the state machine definition.
          sfnArn = event.detail.responseElements?.stateMachineArn ?? '';
          if (!sfnArn) {
            log
              .error()
              .str('function', 'parseSFNEventAndCreateAlarms')
              .obj('event', event)
              .msg('No SFN ARN found in event for CreateStateMachine event');
            throw new Error(
              'No SFN ARN found in event for AWS API Call via CloudTrail event',
            );
          }
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseSFNEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('sfnArn', sfnArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateStateMachine event');
          tags = await fetchSFNTags(sfnArn);
          log
            .info()
            .str('function', 'parseSFNEventAndCreateAlarms')
            .str('sfnArn', sfnArn)
            .str('tags', JSON.stringify(tags))
            .msg('Fetched tags for new CreateStateMachine event');
          break;

        case 'DeleteStateMachine':
          // Failed events have no requestParameters — skip.
          if (event.detail.errorCode) {
            log
              .info()
              .str('function', 'parseSFNEventAndCreateAlarms')
              .str('errorCode', event.detail.errorCode)
              .msg('Skipping failed DeleteStateMachine event');
            return;
          }
          sfnArn = event.detail.requestParameters?.stateMachineArn ?? '';
          if (!sfnArn) {
            log
              .error()
              .str('function', 'parseSFNEventAndCreateAlarms')
              .obj('event', event)
              .msg('No SFN ARN found in event for DeleteStateMachine event');
            throw new Error(
              'No SFN ARN found in event for AWS API Call via CloudTrail event',
            );
          }
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseSFNEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('sfnArn', sfnArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteStateMachine event');
          break;

        default:
          log
            .error()
            .str('function', 'parseSFNEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
          throw new Error('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .error()
        .str('function', 'parseSFNEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
      throw new Error('Unexpected event type');
  }

  if (!sfnArn) {
    log
      .error()
      .str('function', 'parseSFNEventAndCreateAlarms')
      .str('sfnArn', sfnArn)
      .msg('sfnArn is empty');
    throw new Error('sfnArn is empty');
  }

  log
    .info()
    .str('function', 'parseSFNEventAndCreateAlarms')
    .str('sfnArn', sfnArn)
    .str('eventType', eventType)
    .msg('Finished processing SFN event');

  if (sfnArn && (eventType === 'Create' || eventType === 'TagChange')) {
    log
      .info()
      .str('function', 'parseSFNEventAndCreateAlarms')
      .str('sfnArn', sfnArn)
      .str('tags', JSON.stringify(tags))
      .str(
        'autoalarm:enabled',
        tags['autoalarm:enabled']
          ? tags['autoalarm:enabled']
          : 'autoalarm tag does not exist',
      )
      .msg('Starting to manage SFN alarms');
    await checkAndManageSFNStatusAlarms(sfnArn, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseSFNEventAndCreateAlarms')
      .str('sfnArn', sfnArn)
      .msg('Starting to manage inactive SFN alarms');
    await manageInactiveSFNAlarms(sfnArn);
  }

  return {sfnArn, eventType, tags};
}
