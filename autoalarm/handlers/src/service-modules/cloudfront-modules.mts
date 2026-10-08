import {
  CloudFrontClient,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cloudfront';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {CLOUDFRONT_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('cloudfront-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const cloudFrontClient: CloudFrontClient = new CloudFrontClient({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = CLOUDFRONT_CONFIGS;

export async function fetchCloudFrontTags(
  distributionArn: string,
): Promise<Tag> {
  return fetchResourceTags(
    'CloudFront',
    distributionArn,
    async () => {
      // Use the distributionArn directly as it's already an ARN
      const command = new ListTagsForResourceCommand({
        Resource: distributionArn,
      });
      const response = await cloudFrontClient.send(command);

      const tags: {[key: string]: string} = {};
      response.Tags?.Items?.forEach((tag) => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });

      return tags;
    },
    'return-empty',
  );
}

export async function manageCloudFrontAlarms(
  distributionId: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'CF',
    identifier: distributionId,
    tags,
    configs: metricConfigs,
    dimensions: [
      {Name: 'DistributionId', Value: distributionId},
      {Name: 'Region', Value: 'Global'},
    ],
  });
}

export async function manageInactiveCloudFrontAlarms(
  distributionId: string,
): Promise<void> {
  try {
    await deleteExistingAlarms('CF', distributionId, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveCloudFrontAlarms')
      .err(e)
      .msg(`Error deleting CloudFront alarms: ${e}`);
  }
}

function extractDistributionIdFromArn(arn: string): string {
  const regex = /distribution\/([^/]+)$/;
  const match = arn.match(regex);
  return match ? match[1] : '';
}

export async function parseCloudFrontEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): Promise<{
  distributionArn: string;
  eventType: string;
  tags: Record<string, string>;
}> {
  let distributionArn: string = '';
  let distributionId: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      distributionArn = event.resources[0];
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseCloudFrontEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('distributionArn', distributionArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateDistribution':
          distributionArn = event.detail.responseElements?.distribution?.aRN;
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseCloudFrontEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('distributionArn', distributionArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateDistribution event');
          if (distributionArn) {
            tags = await fetchCloudFrontTags(distributionArn);
            log
              .info()
              .str('function', 'parseCloudFrontEventAndCreateAlarms')
              .str('distributionArn', distributionArn)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new CreateDistribution event');
          } else {
            log
              .warn()
              .str('function', 'parseCloudFrontEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('Distribution ARN not found in CreateDistribution event');
          }
          break;

        case 'DeleteDistribution':
          // DeleteDistribution returns a 204 with no responseElements, so use
          // the distribution ID from the request parameters directly.
          distributionId = event.detail.requestParameters?.id;
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseCloudFrontEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('distributionId', distributionId)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteDistribution event');
          break;

        default:
          log
            .warn()
            .str('function', 'parseCloudFrontEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .warn()
        .str('function', 'parseCloudFrontEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
  }

  // Extract the distribution ID from the ARN (Delete events set it directly
  // from the request parameters since the API response carries no ARN)
  if (!distributionId) {
    distributionId = extractDistributionIdFromArn(distributionArn ?? '');
  }
  if (!distributionId) {
    log
      .error()
      .str('function', 'parseCloudFrontEventAndCreateAlarms')
      .str('distributionArn', distributionArn)
      .str('eventType', eventType)
      .msg(
        'Resolved CloudFront distribution ID is empty. Aborting alarm management.',
      );
    throw new Error(
      'Resolved CloudFront distribution ID is empty. Aborting alarm management.',
    );
  }

  log
    .info()
    .str('function', 'parseCloudFrontEventAndCreateAlarms')
    .str('distributionArn', distributionArn)
    .str('eventType', eventType)
    .msg('Finished processing CloudFront event');

  if (
    distributionArn &&
    (eventType === 'Create' || eventType === 'TagChange')
  ) {
    log
      .info()
      .str('function', 'parseCloudFrontEventAndCreateAlarms')
      .str('distributionArn', distributionArn)
      .msg('Starting to manage CloudFront alarms');
    await manageCloudFrontAlarms(distributionId, tags); // Use distributionId
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseCloudFrontEventAndCreateAlarms')
      .str('distributionArn', distributionArn)
      .msg('Starting to manage inactive CloudFront alarms');
    await manageInactiveCloudFrontAlarms(distributionId); // Use distributionId
  }

  return {distributionArn, eventType, tags};
}
