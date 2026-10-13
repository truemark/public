import {EC2Client, DescribeTagsCommand} from '@aws-sdk/client-ec2';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {TRANSIT_GATEWAY_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('transit-gateway-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const ec2Client: EC2Client = new EC2Client({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = TRANSIT_GATEWAY_CONFIGS;

export async function fetchTransitGatewayTags(
  transitGatewayId: string,
): Promise<{[key: string]: string}> {
  return fetchResourceTags(
    'TGW',
    transitGatewayId,
    async () => {
      const response = await ec2Client.send(
        new DescribeTagsCommand({
          Filters: [{Name: 'resource-id', Values: [transitGatewayId]}],
        }),
      );

      const tags: {[key: string]: string} = {};
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

export async function manageTransitGatewayAlarms(
  transitGatewayId: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'TGW',
    identifier: transitGatewayId,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'TransitGateway', Value: transitGatewayId}],
  });
}

export async function manageInactiveTransitGatewayAlarms(
  transitGatewayId: string,
): Promise<void> {
  try {
    await deleteExistingAlarms('TGW', transitGatewayId, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveTransitGatewayAlarms')
      .err(e)
      .msg(`Error deleting Transit Gateway alarms: ${e}`);
  }
}

function extractTransitGatewayNameFromArn(arn: string): string {
  const regex = /transit-gateway\/([^/]+)$/;
  const match = arn.match(regex);
  return match ? match[1] : '';
}

export async function parseTransitGatewayEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): Promise<{
  transitGatewayId: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let transitGatewayId: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      transitGatewayId = event.resources[0];
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseTransitGatewayEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('transitGatewayId', transitGatewayId)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateTransitGateway':
          // EC2 query-protocol CloudTrail nests the response under
          // CreateTransitGatewayResponse → transitGateway → transitGatewayId.
          // Fall back to the flat shape for safety/older fixtures.
          transitGatewayId =
            event.detail.responseElements?.CreateTransitGatewayResponse
              ?.transitGateway?.transitGatewayId ??
            event.detail.responseElements?.transitGateway?.transitGatewayId;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseTransitGatewayEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('transitGatewayId', transitGatewayId)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateTransitGateway event');
          if (transitGatewayId) {
            tags = await fetchTransitGatewayTags(transitGatewayId);
            log
              .info()
              .str('function', 'parseTransitGatewayEventAndCreateAlarms')
              .str('transitGatewayId', transitGatewayId)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new Transit Gateway');
          } else {
            log
              .warn()
              .str('function', 'parseTransitGatewayEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('TransitGatewayId not found in CreateTransitGateway event');
          }
          break;

        case 'DeleteTransitGateway':
          // EC2 query-protocol CloudTrail nests the request under
          // DeleteTransitGatewayRequest → TransitGatewayId (PascalCase). Fall
          // back to the flat shape for safety/older fixtures.
          transitGatewayId =
            event.detail.requestParameters?.DeleteTransitGatewayRequest
              ?.TransitGatewayId ??
            event.detail.requestParameters?.transitGatewayId;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseTransitGatewayEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('transitGatewayId', transitGatewayId)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteTransitGateway event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseTransitGatewayEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseTransitGatewayEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  // CloudTrail events provide a bare id ('tgw-...') while tag events provide a
  // full ARN. Only run ARN extraction when the value is not already a bare id.
  const transitGatewayName = transitGatewayId?.startsWith('tgw-')
    ? transitGatewayId
    : extractTransitGatewayNameFromArn(transitGatewayId || '');
  if (!transitGatewayName) {
    // An unresolved id on a CloudTrail Create/Delete event (e.g. a failed
    // event, or a payload shape we don't parse) must not be thrown — that
    // poison-pills the record into the DLQ on every retry. Alarm management is
    // driven by Tag-Change events anyway, so warn and skip.
    log
      .warn()
      .str('function', 'parseTransitGatewayEventAndCreateAlarms')
      .str('transitGatewayId', transitGatewayId ?? '')
      .str('eventType', eventType)
      .msg(
        'Could not resolve Transit Gateway identifier from event; skipping alarm management',
      );
    return {transitGatewayId: transitGatewayId ?? '', eventType, tags};
  }

  log
    .info()
    .str('function', 'parseTransitGatewayEventAndCreateAlarms')
    .str('transitGatewayId', transitGatewayId)
    .str('eventType', eventType)
    .msg('Finished processing Transit Gateway event');

  if (
    transitGatewayId &&
    (eventType === 'Create' || eventType === 'TagChange')
  ) {
    log
      .info()
      .str('function', 'parseTransitGatewayEventAndCreateAlarms')
      .str('transitGatewayId', transitGatewayId)
      .msg('Starting to manage Transit Gateway alarms');
    await manageTransitGatewayAlarms(transitGatewayName, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseTransitGatewayEventAndCreateAlarms')
      .str('transitGatewayId', transitGatewayId)
      .msg('Starting to manage inactive Transit Gateway alarms');
    await manageInactiveTransitGatewayAlarms(transitGatewayName);
  }

  return {transitGatewayId, eventType, tags};
}
