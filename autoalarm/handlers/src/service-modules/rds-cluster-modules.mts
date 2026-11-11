import {RDSClient, DescribeDBClustersCommand} from '@aws-sdk/client-rds';
import * as logging from '@nr1e/logging';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {Tag} from '../types/index.mjs';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  findArnInEvent,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {RDS_CLUSTER_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('rds-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const rdsClient: RDSClient = new RDSClient({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = RDS_CLUSTER_CONFIGS;

export async function fetchRDSClusterTags(
  dbClusterId: string,
): Promise<{[key: string]: string}> {
  return fetchResourceTags('RDSCluster', dbClusterId, async () => {
    const command = new DescribeDBClustersCommand({
      DBClusterIdentifier: dbClusterId,
    });
    const response = await rdsClient.send(command);

    const tags: {[key: string]: string} = {};
    response.DBClusters?.[0]?.TagList?.forEach((tag) => {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    });

    return tags;
  });
}

async function checkAndManageRDSClusterStatusAlarms(
  dbClusterId: string,
  tags: Tag,
): Promise<void> {
  // Cluster alarms are created under the 'RDSCluster' service name, so fetch
  // with that prefix and restrict deletion to this cluster's exact expected
  // alarm names. Fetching with 'RDS' previously matched member DB instance
  // alarms (the cluster id is a prefix of default instance ids like
  // 'mydb-instance-1') and deleted them.
  await manageServiceAlarms({
    service: 'RDSCluster',
    identifier: dbClusterId,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'DBClusterIdentifier', Value: dbClusterId}],
  });
}

export async function manageInactiveRDSClusterAlarms(
  dbClusterId: string,
): Promise<void> {
  try {
    await deleteExistingAlarms('RDSCluster', dbClusterId, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveRDSClusterAlarms')
      .err(e)
      .msg(`Error deleting RDS alarms: ${e}`);
  }
}

// Function to extract dbClusterId from ARN
function extractRDSClusterIdFromArn(arn: string): string {
  const regex = /cluster[:/]([^:/]+)$/;
  const match = arn.match(regex);

  // log the arn and the extracted dbClusterId
  log
    .info()
    .str('function', 'extractRDSClusterIdFromArn')
    .str('arn', arn)
    .str('dbClusterId', match ? match[1] : 'not found')
    .msg('Extracted dbClusterId from ARN');

  return match ? match[1] : '';
}

/**
 * Searches the provided object for the first occurrence of an RDS ARN.
 * Logs an error and returns an empty string if no valid RDS ARN can be found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRDSClusterArn(eventObj: Record<string, any>): string {
  return findArnInEvent(eventObj, 'arn:aws:rds');
}

// On occasion AWS will splice the arn with the resource ID. If this happens, we need to remap the arn from the resource ID.
async function getARNFromResourceId(arn: string) {
  // Only treat the ARN as a DBCluster resource-ID form when the final segment
  // looks like a real resource ID (e.g. 'cluster-ABCDE12345FGHIJ67890KLMNO1').
  // A cluster literally named 'cluster-prod' must be treated as a normal name ARN.
  if (!/:cluster:cluster-[A-Z0-9]{10,}$/.test(arn)) return arn;

  const resourceId = arn.split(':').at(-1); // grab the last index which is the resource ID

  log
    .warn()
    .str('function', 'getARNFromResourceId')
    .str('Received ARN', arn)
    .msg(
      'ARN is malformed and uses resource ID. Attempting to map ARN from resource ID',
    );

  const command = new DescribeDBClustersCommand({
    Filters: [
      {
        Name: 'db-cluster-resource-id', // grab the last index which is the resource ID
        Values: [`${resourceId}`],
      },
    ],
  });

  try {
    const response = await rdsClient.send(command);
    // Check if any clusters were found
    if (response.DBClusters && response.DBClusters.length > 0) {
      // Return the ARN from the first matching cluster
      return response.DBClusters[0].DBClusterArn!;
    } else {
      log
        .info()
        .str('function', 'getARNFromResourceId')
        .str('resourceId', arn)
        .str('resourceID', arn.split(':').at(-1))
        .msg('No DB cluster found with the provided resource ID');
      throw new Error(`No DB cluster found with resource ID: ${resourceId}`);
    }
  } catch (error) {
    log
      .error()
      .str('function', 'getARNFromResourceId')
      .err(error)
      .str('resourceId', resourceId)
      .msg('Error fetching DB cluster ARN from resource ID');
    throw error;
  }
}

export async function parseRDSClusterEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: Record<string, any>,
): Promise<{
  dbClusterId: string;
  dbClusterArn: string;
  eventType: string;
  tags: Record<string, string>;
} | void> {
  let dbClusterId: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  // get arn from event and remap ARN if arn is malformed and contains resource ID
  const eventArn = findRDSClusterArn(event);
  const dbClusterArn = await getARNFromResourceId(eventArn);

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      if (!dbClusterArn) {
        log
          .error()
          .str('function', 'parseRDSClusterEventAndCreateAlarms')
          .obj('event', event)
          .msg('No RDS Cluster ARN found in event for tag change event');
        throw new Error('No RDS Cluster ARN found in event');
      }
      dbClusterId = extractRDSClusterIdFromArn(dbClusterArn);
      eventType = 'TagChange';
      tags = event.detail.tags || {};
      log
        .info()
        .str('function', 'parseRDSClusterEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('dbClusterId', dbClusterId)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');

      if (dbClusterId) {
        tags = await fetchRDSClusterTags(dbClusterId);
        log
          .info()
          .str('function', 'parseRDSClusterEventAndCreateAlarms')
          .str('DB Cluster ID', dbClusterId)
          .str('tags', JSON.stringify(tags))
          .msg('Fetched tags for new TagChange event');
      } else {
        log
          .error()
          .str('function', 'parseRDSClusterEventAndCreateAlarms')
          .str('eventType', 'TagChance')
          .msg('dbClusterId not found in AddTagsToResource event');
        throw new Error('dbClusterId not found in AddTagsToResource event');
      }
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        case 'CreateDBCluster':
          if (!dbClusterArn) {
            log
              .error()
              .str('function', 'parseRDSClusterEventAndCreateAlarms')
              .obj('event', event)
              .msg('No RDS Cluster ARN found in event for tag change event');
            throw new Error(
              'No RDS Cluster ARN found in event for AWS API Call via CloudTrail event',
            );
          }
          dbClusterId = extractRDSClusterIdFromArn(dbClusterArn);
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseRDSClusterEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('dbClusterId', dbClusterId)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateDBCluster event');
          if (dbClusterId) {
            tags = await fetchRDSClusterTags(dbClusterId);
            log
              .info()
              .str('function', 'parseRDSClusterEventAndCreateAlarms')
              .str('dbClusterId', dbClusterId)
              .str('tags', JSON.stringify(tags))
              .msg('Fetched tags for new CreateDBCluster event');
          } else {
            log
              .error()
              .str('function', 'parseRDSClusterEventAndCreateAlarms')
              .str('eventType', 'Create')
              .msg('dbClusterId not found in CreateDBCluster event');
            throw new Error('dbClusterId not found in CreateDBCluster event');
          }
          break;

        case 'DeleteDBCluster':
          if (!dbClusterArn) {
            log
              .error()
              .str('function', 'parseRDSClusterEventAndCreateAlarms')
              .obj('event', event)
              .msg('No RDS Cluster ARN found in event DeleteDBCluster event');
            throw new Error(
              'No RDS Cluster ARN found in event for AWS API Call via CloudTrail event',
            );
          }
          dbClusterId = extractRDSClusterIdFromArn(dbClusterArn);
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseRDSClusterEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('dbClusterId', dbClusterId)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteDBCluster event');
          break;

        default:
          log
            .error()
            .str('function', 'parseRDSClusterEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
          throw new Error('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .error()
        .str('function', 'parseRDSClusterEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
      throw new Error('Unexpected event type');
  }

  if (!dbClusterId) {
    log
      .error()
      .str('function', 'parseRDSClusterEventAndCreateAlarms')
      .str('dbClusterId', dbClusterId)
      .msg('dbClusterId is empty');
    throw new Error('dbClusterId is empty');
  }

  log
    .info()
    .str('function', 'parseRDSClusterEventAndCreateAlarms')
    .str('dbClusterId', dbClusterId)
    .str('eventType', eventType)
    .msg('Finished processing RDS Cluster event');

  if (dbClusterId && (eventType === 'Create' || eventType === 'TagChange')) {
    log
      .info()
      .str('function', 'parseRDSClusterEventAndCreateAlarms')
      .str('dbClusterId', dbClusterId)
      .str('tags', JSON.stringify(tags))
      .str(
        'autoalarm:enabled',
        tags['autoalarm:enabled']
          ? tags['autoalarm:enabled']
          : 'autoalarm tag does not exist',
      )
      .msg('Starting to manage RDS Cluster alarms');
    await checkAndManageRDSClusterStatusAlarms(dbClusterId, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseRDSClusterEventAndCreateAlarms')
      .str('dbClusterId', dbClusterId)
      .msg('Starting to manage inactive RDS Cluster alarms');
    await manageInactiveRDSClusterAlarms(dbClusterId);
  }

  return {dbClusterArn, dbClusterId, eventType, tags};
}
