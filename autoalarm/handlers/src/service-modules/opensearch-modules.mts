import {OpenSearchClient, ListTagsCommand} from '@aws-sdk/client-opensearch';
import * as logging from '@nr1e/logging';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {Tag} from '../types/index.mjs';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {OPENSEARCH_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('opensearch-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const openSearchClient: OpenSearchClient = new OpenSearchClient({
  region,
  retryStrategy,
});

const metricConfigs = OPENSEARCH_CONFIGS;

export async function fetchOpenSearchTags(domainArn: string): Promise<Tag> {
  return fetchResourceTags(
    'OpenSearch',
    domainArn,
    async () => {
      const command = new ListTagsCommand({
        ARN: domainArn,
      });
      const response = await openSearchClient.send(command);
      const tags: Tag = {};

      response.TagList?.forEach((tag) => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });

      return tags;
    },
    'return-empty',
  );
}

export async function manageOpenSearchAlarms(
  domainName: string,
  accountID: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'OS',
    identifier: domainName,
    tags,
    configs: metricConfigs,
    dimensions: [
      {Name: 'DomainName', Value: domainName},
      {Name: 'ClientId', Value: accountID},
    ],
  });
}

export async function manageInactiveOpenSearchAlarms(domainName: string) {
  try {
    await deleteExistingAlarms('OS', domainName, metricConfigs);
  } catch (e) {
    log.error().err(e).msg(`Error deleting OpenSearch alarms: ${e}`);
    throw new Error(`Error deleting OpenSearch alarms: ${e}`);
  }
}

function extractOSDomainNameFromArn(arn: string): string {
  const regex = /domain\/([^/]+)$/;
  const match = arn.match(regex);
  return match ? match[1] : '';
}

function extractAccountIdFromArn(arn: string): string {
  const parts = arn.split(':');
  return parts.length > 4 ? parts[4] : '';
}

// TODO Fix the use of any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseOSEventAndCreateAlarms(event: any): Promise<{
  domainArn: string;
  accountID: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let domainArn: string = '';
  let domainName: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      domainArn = event.resources[0];
      eventType = 'Domain TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseOSEventAndCreateAlarms')
        .str('eventType', eventType)
        .str('domainArn', domainArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateDomain':
          domainArn = event.detail.responseElements?.domain?.arn; //deprecated domain convention still in use in event. Safe to ignore.
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseOSEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('domainArn', domainArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateDomain event');
          if (domainArn) {
            tags = await fetchOpenSearchTags(domainArn);
            log
              .info()
              .str('function', 'parseOSEventAndCreateAlarms')
              .str('domainArn', domainArn)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new domain');
          } else {
            log
              .warn()
              .str('function', 'parseOSEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('DomainArn not found in CreateDomain event');
          }
          break;

        case 'DeleteDomain':
          // DeleteDomain request parameters carry the domain name, not an ARN.
          // The domain name is the alarm key and CloudWatch dimension value.
          domainName = event.detail.requestParameters?.domainName;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseOSEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('domainName', domainName)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteDomain event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseOSEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseOSEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  // Delete events set the domain name directly from the request parameters;
  // all other events extract it from the domain ARN.
  if (!domainName) {
    domainName = extractOSDomainNameFromArn(domainArn ?? '');
  }
  // The account ID is carried on the event itself, so derive it from there
  // rather than from the ARN (which Delete events do not carry).
  const accountID =
    event.account ||
    event.detail?.recipientAccountId ||
    extractAccountIdFromArn(domainArn ?? '');
  if (!domainName) {
    log
      .error()
      .str('function', 'parseOSEventAndCreateAlarms')
      .str('domainArn', domainArn)
      .str('eventType', eventType)
      .msg(
        'Resolved OpenSearch domain name is empty. Aborting alarm management.',
      );
    throw new Error(
      'Resolved OpenSearch domain name is empty. Aborting alarm management.',
    );
  }

  log
    .info()
    .str('function', 'parseOSEventAndCreateAlarms')
    .str('domainArn', domainArn)
    .str('eventType', eventType)
    .msg('Finished processing domain event');

  if (
    domainArn &&
    (eventType === 'Create' || eventType === 'Domain TagChange')
  ) {
    log
      .info()
      .str('function', 'parseOSEventAndCreateAlarms')
      .str('domainArn', domainArn)
      .msg('Starting to manage domain alarms');
    await manageOpenSearchAlarms(domainName, accountID, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseOSEventAndCreateAlarms')
      .str('domainArn', domainArn)
      .msg('Starting to manage inactive domain alarms');
    await manageInactiveOpenSearchAlarms(domainName);
  }

  return {domainArn, accountID, eventType, tags};
}
