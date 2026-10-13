import {
  DescribeTagsCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import * as logging from '@nr1e/logging';
import {LoadBalancerIdentifiers, Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {ALB_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('alb-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const elbClient: ElasticLoadBalancingV2Client =
  new ElasticLoadBalancingV2Client({
    region,
    retryStrategy,
  });

const metricConfigs = ALB_CONFIGS;

export async function fetchALBTags(loadBalancerArn: string): Promise<Tag> {
  return fetchResourceTags(
    'ALB',
    loadBalancerArn,
    async () => {
      const command = new DescribeTagsCommand({
        ResourceArns: [loadBalancerArn],
      });
      const response = await elbClient.send(command);
      const tags: Tag = {};

      response.TagDescriptions?.forEach((tagDescription) => {
        tagDescription.Tags?.forEach((tag) => {
          if (tag.Key && tag.Value) {
            tags[tag.Key] = tag.Value;
          }
        });
      });

      return tags;
    },
    'return-empty',
  );
}

export async function manageALBAlarms(
  loadBalancerName: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'ALB',
    identifier: loadBalancerName,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'LoadBalancer', Value: loadBalancerName}],
  });
}

export async function manageInactiveALBAlarms(loadBalancerName: string) {
  try {
    await deleteExistingAlarms('ALB', loadBalancerName, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveALBAlarms')
      .err(e)
      .msg(`Error deleting ALB alarms: ${e}`);
    throw new Error(`Error deleting ALB alarms: ${e}`);
  }
}

function extractAlbNameFromArn(
  arn: string | undefined | null,
): LoadBalancerIdentifiers {
  // Classic ELB events carry a loadBalancerName instead of an ARN, so the
  // input may be undefined. Treat that as an unsupported load balancer.
  if (!arn) {
    return {
      LBType: null,
      LBName: null,
    };
  }
  const regex = /\/(app|net)\/(.*?\/[^/]+)$/;
  const match = arn.match(regex);
  if (!match)
    return {
      LBType: null,
      LBName: null,
    };
  // The CloudWatch AWS/ApplicationELB LoadBalancer dimension requires the
  // type prefix (e.g. 'app/my-alb/1234567890abcdef'), so keep it in the name.
  return {
    LBType: match[1] as 'app' | 'net',
    LBName: `${match[1]}/${match[2]}`,
  };
}

// TODO Fix the use of any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseALBEventAndCreateAlarms(event: any): Promise<{
  loadBalancerArn: string;
  eventType: string;
  tags: Record<string, string>;
} | void> {
  let loadBalancerArn: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      loadBalancerArn = event.resources[0];
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseALBEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('loadBalancerArn', loadBalancerArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateLoadBalancer':
          loadBalancerArn =
            event.detail.responseElements?.loadBalancers?.[0]?.loadBalancerArn;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseALBEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('loadBalancerArn', loadBalancerArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateLoadBalancer event');
          if (loadBalancerArn) {
            tags = await fetchALBTags(loadBalancerArn);
            log
              .info()
              .str('function', 'parseALBEventAndCreateAlarms')
              .str('loadBalancerArn', loadBalancerArn)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new ALB');
          } else {
            log
              .warn()
              .str('function', 'parseALBEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('LoadBalancerArn not found in CreateLoadBalancer event');
          }
          break;

        case 'DeleteLoadBalancer':
          loadBalancerArn = event.detail.requestParameters?.loadBalancerArn;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseALBEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('loadBalancerArn', loadBalancerArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteLoadBalancer event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseALBEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseALBEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  const loadBalancer = extractAlbNameFromArn(loadBalancerArn);
  if (loadBalancer.LBType === null || loadBalancer.LBName === null) {
    log
      .warn()
      .str('function', 'parseALBEventAndCreateAlarms')
      .str('loadBalancerArn', loadBalancerArn)
      .obj('Load Balancer Identifiers', loadBalancer)
      .msg(
        'Unable to extract an application or network load balancer name from the event. ' +
          'This is likely a Classic or Gateway load balancer which AutoAlarm does not support. Skipping processing.',
      );
    // return early to avoid processing unsupported load balancers
    return;
  }

  // TODO: we can use this conditional as an entry point to manage nlbs in the future as we build this out.
  /*
   *
   * gracefully logging a warning for now if a network load balancer has been tagged.
   */
  if (loadBalancer.LBType.includes('net')) {
    log
      .warn()
      .str('function', 'parseALBEventAndCreateAlarms')
      .str('loadBalancerArn', loadBalancerArn)
      .obj('Load Balancer Identifiers', loadBalancer)
      .msg(
        'Network Load Balancer detected. Skipping processing. Network Load Balancer support is not yet available.',
      );
    // return early to avoid processing network load balancers
    return;
  }

  log
    .info()
    .str('function', 'parseALBEventAndCreateAlarms')
    .str('loadBalancerArn', loadBalancerArn)
    .str('eventType', eventType)
    .msg('starting to process ALB tags and alarm management');

  if (
    loadBalancerArn &&
    (eventType === 'Create' || eventType === 'TagChange')
  ) {
    log
      .info()
      .str('function', 'parseALBEventAndCreateAlarms')
      .str('loadBalancerArn', loadBalancerArn)
      .msg('Starting to manage ALB alarms');
    await manageALBAlarms(loadBalancer.LBName, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseALBEventAndCreateAlarms')
      .str('loadBalancerArn', loadBalancerArn)
      .msg('Starting to manage inactive ALB alarms');
    await manageInactiveALBAlarms(loadBalancer.LBName);
  }

  return {loadBalancerArn, eventType, tags};
}
