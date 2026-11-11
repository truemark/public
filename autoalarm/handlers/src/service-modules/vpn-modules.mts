import {EC2Client, DescribeTagsCommand} from '@aws-sdk/client-ec2';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {VPN_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('vpn-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const ec2Client: EC2Client = new EC2Client({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = VPN_CONFIGS;

export async function fetchVpnTags(
  vpnId: string,
): Promise<{[key: string]: string}> {
  return fetchResourceTags(
    'VPN',
    vpnId,
    async () => {
      const response = await ec2Client.send(
        new DescribeTagsCommand({
          Filters: [{Name: 'resource-id', Values: [vpnId]}],
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

export async function manageVpnAlarms(vpnId: string, tags: Tag): Promise<void> {
  await manageServiceAlarms({
    service: 'VPN',
    identifier: vpnId,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'VpnId', Value: vpnId}],
  });
}

export async function manageInactiveVpnAlarms(vpnId: string): Promise<void> {
  try {
    await deleteExistingAlarms('VPN', vpnId, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveVpnAlarms')
      .err(e)
      .msg(`Error deleting VPN alarms: ${e}`);
  }
}

export async function parseVpnEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): Promise<{
  vpnId: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let vpnId: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      // resources[0] is a full ARN (arn:aws:ec2:...:vpn-connection/vpn-xxx);
      // extract the bare 'vpn-...' id to match the VpnId dimension and alarm names
      vpnId = event.resources[0]?.split('/').pop() || '';
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseVpnEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('vpnId', vpnId)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateVpnConnection':
          vpnId = event.detail.responseElements?.vpnConnection?.vpnConnectionId;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseVpnEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('vpnId', vpnId)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateVpnConnection event');
          if (vpnId) {
            tags = await fetchVpnTags(vpnId);
            log
              .info()
              .str('function', 'parseVpnEventAndCreateAlarms')
              .str('vpnId', vpnId)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new CreateVpnConnection event');
          } else {
            log
              .warn()
              .str('function', 'parseVpnEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('vpnId not found in CreateVPNConnection event');
          }
          break;

        case 'DeleteVpnConnection':
          vpnId = event.detail.requestParameters?.vpnConnectionId;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseVpnEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('vpnId', vpnId)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteVpnConnection event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseVpnEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseVpnEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  if (!vpnId) {
    log
      .error()
      .str('function', 'parseVpnEventAndCreateAlarms')
      .str('vpnId', vpnId)
      .msg(
        'Could not resolve VPN identifier from event. Failing record to avoid managing alarms with an empty identifier',
      );
    throw new Error(
      'Could not resolve VPN identifier from event. Cannot manage alarms with an empty identifier',
    );
  }

  log
    .info()
    .str('function', 'parseVpnEventAndCreateAlarms')
    .str('vpnId', vpnId)
    .str('eventType', eventType)
    .msg('Finished processing VPN event');

  if (vpnId && (eventType === 'Create' || eventType === 'TagChange')) {
    log
      .info()
      .str('function', 'parseVpnEventAndCreateAlarms')
      .str('vpnId', vpnId)
      .msg('Starting to manage VPN alarms');
    await manageVpnAlarms(vpnId, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseVpnEventAndCreateAlarms')
      .str('vpnId', vpnId)
      .msg('Starting to manage inactive VPN alarms');
    await manageInactiveVpnAlarms(vpnId);
  }

  return {vpnId, eventType, tags};
}
