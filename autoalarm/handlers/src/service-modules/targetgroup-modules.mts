import {
  ElasticLoadBalancingV2Client,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetGroupsCommandOutput,
  TargetGroupNotFoundException,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import * as arnparser from '@aws-sdk/util-arn-parser';
import {TARGET_GROUP_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('targetgroup-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const elbClient: ElasticLoadBalancingV2Client =
  new ElasticLoadBalancingV2Client({
    region,
    retryStrategy,
  });

const metricConfigs = TARGET_GROUP_CONFIGS;

export async function fetchTGTags(targetGroupArn: string): Promise<Tag> {
  return fetchResourceTags(
    'TG',
    targetGroupArn,
    async () => {
      const command = new DescribeTagsCommand({
        ResourceArns: [targetGroupArn],
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

async function manageTGAlarms(
  targetGroupName: string,
  loadBalancerName: string | null,
  tags: Tag,
) {
  // A load balancer is required for all TG metrics. Preserve the original
  // ordering: the enabled check (which may delete alarms) runs first inside
  // manageServiceAlarms, and the missing-LB guard only skips alarm creation
  // when alarms are enabled.
  if (tags['autoalarm:enabled'] === 'true' && !loadBalancerName) {
    log
      .warn()
      .str('function', 'manageTGAlarms')
      .str('TargetGroupName', targetGroupName)
      .str('LoadBalancerName', loadBalancerName)
      .msg(
        'Load balancer name not found but required, skipping alarm creation',
      );
    return;
  }

  await manageServiceAlarms({
    service: 'TG',
    identifier: targetGroupName,
    tags,
    configs: metricConfigs,
    dimensions: [
      {Name: 'TargetGroup', Value: targetGroupName},
      {Name: 'LoadBalancer', Value: loadBalancerName ?? ''},
    ],
  });
}

export async function manageInactiveTGAlarms(targetGroupName: string) {
  try {
    await deleteExistingAlarms('TG', targetGroupName, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveTGAlarms')
      .err(e)
      .msg(`Error deleting target group alarms: ${e}`);
    throw new Error(`Error deleting target group alarms: ${e}`);
  }
}

// TODO Fix the use of any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseTGEventAndCreateAlarms(event: any): Promise<{
  targetGroupArn: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let targetGroupArn: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      targetGroupArn = event.resources[0];
      eventType = 'Target Group TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseTGEventAndCreateAlarms')
        .str('eventType', eventType)
        .str('targetGroupArn', targetGroupArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateTargetGroup':
          targetGroupArn =
            event.detail.responseElements?.targetGroups[0]?.targetGroupArn;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseTGEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('targetGroupArn', targetGroupArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateTargetGroup event');
          if (targetGroupArn) {
            tags = await fetchTGTags(targetGroupArn);
            log
              .info()
              .str('function', 'parseTGEventAndCreateAlarms')
              .str('targetGroupArn', targetGroupArn)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new target group');
          } else {
            log
              .warn()
              .str('function', 'parseTGEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('TargetGroupArn not found in CreateTargetGroup event');
          }
          break;

        case 'DeleteTargetGroup':
          targetGroupArn = event.detail.requestParameters?.targetGroupArn;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseTGEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('targetGroupArn', targetGroupArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteTargetGroup event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseTGEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseTGEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  // Failed CloudTrail events (e.g. AccessDenied on CreateTargetGroup) carry no
  // ARN in responseElements, and a failed DeleteTargetGroup carries none in
  // requestParameters, leaving targetGroupArn empty. Bail out before
  // arnparser.parse() would throw on the undefined/empty value and poison-pill
  // the record into the DLQ.
  if (!targetGroupArn) {
    log
      .warn()
      .str('function', 'parseTGEventAndCreateAlarms')
      .str('eventType', eventType)
      .msg(
        'No target group ARN resolved from event; skipping alarm management',
      );
    return {targetGroupArn: '', eventType, tags};
  }

  /**
   * Extract the target group name from the ARN so we can use it to create or delete alarms as needed.
   */
  const tgArn = arnparser.parse(targetGroupArn);
  const targetGroupName = tgArn.resource;

  /**
   * Delete alarms if a TG is deleted
   */
  if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseTGEventAndCreateAlarms')
      .str('targetGroupArn', targetGroupArn)
      .msg('Starting to manage inactive target group alarms');
    await manageInactiveTGAlarms(targetGroupName);
    return {targetGroupArn, eventType, tags};
  }

  /**
   * Defensively describe the target group to confirm it exists. If it doesn't, log an error then return early
   * Purposely not managing alarms for TGs that do not exist in the case that there is a genuine error, and we don't want to manage alarms that may exist and are needed.
   */
  let response: DescribeTargetGroupsCommandOutput;

  try {
    response = await elbClient.send(
      new DescribeTargetGroupsCommand({
        TargetGroupArns: [targetGroupArn],
      }),
    );
  } catch (e) {
    if (e instanceof TargetGroupNotFoundException) {
      log
        .warn()
        .str('function', 'parseTGEventAndCreateAlarms')
        .str('targetGroupArn', targetGroupArn)
        .msg(
          'Target group not found — likely deleted before this stale event was processed; skipping alarm management.',
        );
      return {targetGroupArn, eventType, tags};
    }
    log
      .error()
      .str('function', 'parseTGEventAndCreateAlarms')
      .err(e)
      .str('targetGroupArn', targetGroupArn)
      .msg('Error fetching target group.');
    return {targetGroupArn, eventType, tags};
  }

  /**
   * initialize load balancer ARN var to be used to filter through TGs that do not have a load balancer associated with them.
   */
  let loadBalancerArn: string | undefined = undefined;

  if (response.TargetGroups && response.TargetGroups.length > 0) {
    const loadBalancerArns = response.TargetGroups[0].LoadBalancerArns;
    if (loadBalancerArns && loadBalancerArns.length > 0) {
      loadBalancerArn = loadBalancerArns[0];
    }
  }

  /**
   * Extract the load balancer name from the ARN so we can filter out TG that do not have a load balancer associated with them.
   */
  const lbArn = loadBalancerArn ? arnparser.parse(loadBalancerArn) : null;
  const loadBalancerName = lbArn
    ? lbArn.resource.replace('loadbalancer/', '')
    : null;

  /*
   * This Logs a warning while still allowing the program to finish running and address other workflows for eligible TGs
   */
  if (!loadBalancerArn) {
    log
      .warn()
      .str('function', 'parseTGEventAndCreateAlarms')
      .str('targetGroupArn', targetGroupArn)
      .msg(
        'Load balancer ARN not found. Target Group Alarms require an associated Load Balancer. No Alarms will be created.',
      );
  }

  if (!targetGroupName) {
    log
      .error()
      .str('function', 'parseTGEventAndCreateAlarms')
      .str('targetGroupArn', targetGroupArn)
      .msg('Extracted target group name is empty');
    throw new Error('Extracted target group name is empty');
  }

  log
    .info()
    .str('function', 'parseTGEventAndCreateAlarms')
    .str('targetGroupArn', targetGroupArn)
    .str('eventType', eventType)
    .msg('Finished processing target group event');

  /**
   * initialize alarm create/modification if a TG is created or a Tg tag is changed
   */
  if (
    targetGroupArn &&
    (eventType === 'Create' || eventType === 'Target Group TagChange')
  ) {
    log
      .info()
      .str('function', 'parseTGEventAndCreateAlarms')
      .str('targetGroupArn', targetGroupArn)
      .msg('Starting to manage target group alarms');
    await manageTGAlarms(targetGroupName, loadBalancerName, tags);
  }

  return {targetGroupArn, eventType, tags};
}
