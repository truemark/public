import {ECSClient, ListTagsForResourceCommand} from '@aws-sdk/client-ecs';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {SQSRecord} from 'aws-lambda';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  findArnInEvent,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {ECS_CONFIGS} from '../alarm-configs/_index.mjs';
import {Dimension} from '../types/module-types.mjs';

const log: logging.Logger = logging.getLogger('ecs-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);

const ecsClient = new ECSClient({
  region,
  retryStrategy,
});

const metricConfigs = ECS_CONFIGS;

interface ECSServiceInfo {
  serviceArn: string;
  serviceName: string;
  clusterName: string;
}

function extractECSServiceInfo(
  eventBody: string,
  accountId: string,
): ECSServiceInfo | undefined {
  const region: string = process.env.AWS_REGION!;

  // A missing service ARN is normal: ECS forwards TagResource/cluster/
  // task-definition events too, and only service events are actionable. Log
  // the miss at debug (here and in findArnInEvent) so non-service events don't
  // flood ERROR; the caller logs a single warn-level skip explanation.
  const arn = findArnInEvent(
    eventBody,
    `arn:aws:ecs:${region}:${accountId}:service`,
    {notFoundLogLevel: 'debug'},
  ).trim();
  if (!arn) {
    log
      .debug()
      .str('function', 'extractECSServiceInfo')
      .msg('No ECS Service ARN found in event');
    return void 0;
  }

  const arnParts = arn.split('/');

  if (arnParts.length < 3) {
    log
      .error()
      .str('function', 'extractECSServiceInfo')
      .str('arn', arn)
      .msg('Invalid ECS service ARN format - missing cluster or service name');
    return void 0;
  }

  const clusterName = arnParts[1].trim();
  const serviceName = arnParts[2].trim();

  log
    .info()
    .str('function', 'extractECSServiceInfo')
    .str('serviceArn', arn)
    .str('clusterName', clusterName)
    .str('serviceName', serviceName)
    .msg('Extracted ECS service info');

  return {
    serviceArn: arn,
    serviceName,
    clusterName,
  };
}

export async function fetchEcsTags(ecsArn: string): Promise<Tag> {
  return fetchResourceTags('ECS', ecsArn, async () => {
    const command = new ListTagsForResourceCommand({resourceArn: ecsArn});
    const response = await ecsClient.send(command);

    const tags: Tag = {};
    response.tags?.forEach((tag) => {
      if (tag.key && tag.value && tag.key.startsWith('autoalarm:')) {
        tags[tag.key] = tag.value;
      }
    });

    return tags;
  });
}

async function manageEcsAlarms(
  serviceArn: string,
  clusterName: string,
  serviceName: string,
  tags: Tag,
): Promise<void> {
  const dimensions: Dimension[] = [
    {Name: 'ClusterName', Value: clusterName},
    {Name: 'ServiceName', Value: serviceName},
  ];

  // The event parser performs its own enabled/disabled gating before calling
  // this (any present autoalarm:enabled value other than 'false' proceeds),
  // so skip the generic strict 'true' check to preserve that behavior.
  await manageServiceAlarms({
    service: 'ECS',
    identifier: serviceArn,
    tags,
    configs: metricConfigs,
    dimensions,
    checkEnabled: false,
  });
}

/**
 * Entry point to module to manage ECS service alarms.
 */
export async function parseECSEventAndCreateAlarms(
  record: SQSRecord,
  accountId: string,
): Promise<void> {
  const body = JSON.parse(record.body);
  const eventName = body.detail?.eventName;

  const serviceInfo = extractECSServiceInfo(record.body, accountId);

  if (!serviceInfo) {
    // TagResource/UntagResource events are forwarded for all ECS resource types
    // (clusters, task definitions, etc.) - only service events are actionable
    log
      .warn()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('eventName', eventName)
      .msg('Event does not reference an ECS service - skipping');
    return;
  }

  const {serviceArn, serviceName, clusterName} = serviceInfo;

  log
    .info()
    .str('function', 'parseECSEventAndCreateAlarms')
    .str('eventName', eventName)
    .str('serviceArn', serviceArn)
    .str('serviceName', serviceName)
    .str('clusterName', clusterName)
    .msg('Processing ECS service event');

  if (eventName === 'DeleteService') {
    try {
      log
        .info()
        .str('function', 'parseECSEventAndCreateAlarms')
        .str('serviceArn', serviceArn)
        .msg('Deleting alarms for deleted ECS service');
      await deleteExistingAlarms('ECS', serviceArn, metricConfigs);
      return;
    } catch (error) {
      log
        .error()
        .str('function', 'parseECSEventAndCreateAlarms')
        .str('serviceArn', serviceArn)
        .err(error)
        .msg('Error deleting ECS alarms for deleted service');
      throw new Error(
        `Failed to delete alarms for service ${serviceName}: ${error}`,
      );
    }
  }

  const tags = await fetchEcsTags(serviceArn);

  if (Object.keys(tags).length === 0) {
    log
      .info()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('serviceArn', serviceArn)
      .msg('No autoalarm tags found - skipping alarm management');
    await deleteExistingAlarms('ECS', serviceArn, metricConfigs);
    return;
  }

  if (tags['autoalarm:enabled'] === 'false') {
    log
      .info()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('serviceArn', serviceArn)
      .msg('AutoAlarm disabled - deleting existing alarms');
    await deleteExistingAlarms('ECS', serviceArn, metricConfigs);
    return;
  }

  if (!tags['autoalarm:enabled']) {
    log
      .info()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('serviceArn', serviceArn)
      .msg(
        'autoalarm:enabled tag not found - skipping alarm management and deleting existing alarms',
      );
    await deleteExistingAlarms('ECS', serviceArn, metricConfigs);
    return;
  }

  try {
    log
      .info()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('serviceArn', serviceArn)
      .num('autoAlarmTagCount', Object.keys(tags).length)
      .msg('Managing ECS service alarms');
    await manageEcsAlarms(serviceArn, clusterName, serviceName, tags);
  } catch (error) {
    log
      .error()
      .str('function', 'parseECSEventAndCreateAlarms')
      .str('serviceArn', serviceArn)
      .err(error)
      .msg('Error managing ECS service alarms');
    throw new Error(
      `Failed to manage alarms for service ${serviceName}: ${error}`,
    );
  }
}
