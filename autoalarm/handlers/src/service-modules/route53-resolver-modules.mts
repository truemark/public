import {
  ListTagsForResourceCommand,
  Route53ResolverClient,
} from '@aws-sdk/client-route53resolver';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {ROUTE53_RESOLVER_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('route53-resolver-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const route53ResolverClient = new Route53ResolverClient({
  region,
  retryStrategy,
});

const metricConfigs = ROUTE53_RESOLVER_CONFIGS;

export async function fetchR53ResolverTags(endpointId: string): Promise<Tag> {
  return fetchResourceTags(
    'R53R',
    endpointId,
    async () => {
      const command = new ListTagsForResourceCommand({
        ResourceArn: endpointId,
      });
      const response = await route53ResolverClient.send(command);
      const tags: Tag = {};

      response.Tags?.forEach((tag) => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });

      return tags;
    },
    'return-empty',
  );
}

export async function manageR53ResolverAlarms(
  endpointId: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'R53R',
    identifier: endpointId,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'EndpointId', Value: endpointId}],
  });
}

export async function manageInactiveR53ResolverAlarms(endpointId: string) {
  try {
    await deleteExistingAlarms('R53R', endpointId, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveR53ResolverAlarms')
      .err(e)
      .msg(`Error deleting R53R alarms: ${e}`);
    throw new Error(`Error deleting R53R alarms: ${e}`);
  }
}

function extractR53ResolverNameFromArn(arn: string): string {
  const regex = /resolver-endpoint\/([^/]+)$/;
  const match = arn.match(regex);
  return match ? match[1] : '';
}

/**
 * Builds the full resolver endpoint ARN from a bare endpoint ID using the
 * region and account ID carried on the CloudTrail event detail. The
 * ListTagsForResource API requires an ARN, but CloudTrail events only carry
 * the bare 'rslvr-...' endpoint ID.
 */
function buildR53ResolverArn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  endpointId: string,
): string {
  const eventRegion = event.detail?.awsRegion || event.region || region;
  const accountId = event.detail?.recipientAccountId || event.account || '';
  return `arn:aws:route53resolver:${eventRegion}:${accountId}:resolver-endpoint/${endpointId}`;
}

export async function parseR53ResolverEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): Promise<{
  endpointId: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let endpointId: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      endpointId = event.resources[0];
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseR53ResolverEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('endpointId', endpointId)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateResolverEndpoint':
          endpointId = event.detail.responseElements?.resolverEndpoint?.id;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseR53ResolverEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('endpointId', endpointId)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateResolverEndpoint event');
          if (endpointId) {
            // ListTagsForResource requires an ARN, but the CloudTrail event
            // only carries the bare endpoint ID. Build the ARN from the event.
            tags = await fetchR53ResolverTags(
              buildR53ResolverArn(event, endpointId),
            );
            log
              .info()
              .str('function', 'parseR53ResolverEventAndCreateAlarms')
              .str('endpointId', endpointId)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new Route 53 Resolver endpoint');
          } else {
            log
              .warn()
              .str('function', 'parseR53ResolverEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('Endpoint ID not found in CreateResolverEndpoint event');
          }
          break;

        case 'DeleteResolverEndpoint':
          endpointId = event.detail.requestParameters?.resolverEndpointId;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseR53ResolverEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('endpointId', endpointId)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteResolverEndpoint event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseR53ResolverEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseR53ResolverEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  // Resolve the endpoint identifier. CloudTrail events carry a bare
  // 'rslvr-...' endpoint ID while Tag Change events carry the full ARN.
  const resolverName = endpointId?.startsWith('rslvr-')
    ? endpointId
    : extractR53ResolverNameFromArn(endpointId ?? '');
  if (!resolverName) {
    log
      .error()
      .str('function', 'parseR53ResolverEventAndCreateAlarms')
      .str('endpointId', endpointId)
      .str('eventType', eventType)
      .msg(
        'Resolved Route 53 Resolver endpoint identifier is empty. Aborting to avoid acting on all R53R alarms.',
      );
    throw new Error(
      'Resolved Route 53 Resolver endpoint identifier is empty. Aborting to avoid acting on all R53R alarms.',
    );
  }

  log
    .info()
    .str('function', 'parseR53ResolverEventAndCreateAlarms')
    .str('endpointId', endpointId)
    .str('eventType', eventType)
    .msg('Finished processing Route 53 Resolver event');

  if (endpointId && (eventType === 'Create' || eventType === 'TagChange')) {
    log
      .info()
      .str('function', 'parseR53ResolverEventAndCreateAlarms')
      .str('endpointId', endpointId)
      .msg('Starting to manage Route 53 Resolver alarms');
    await manageR53ResolverAlarms(resolverName, tags); // Use resolverName
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseR53ResolverEventAndCreateAlarms')
      .str('endpointId', endpointId)
      .msg('Starting to manage inactive Route 53 Resolver alarms');
    await manageInactiveR53ResolverAlarms(resolverName); // Use resolverName
  }

  return {endpointId, eventType, tags};
}
