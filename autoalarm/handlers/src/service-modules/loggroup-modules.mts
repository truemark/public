import * as logging from '@nr1e/logging';
import {
  CloudWatchLogsClient,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {SQSRecord} from 'aws-lambda';
import {Tag} from '../types/index.mjs';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  findArnInEvent,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {LOGGROUP_CONFIGS} from '../alarm-configs/loggroup-configs.mjs';
import {Dimension} from '../types/module-types.mjs';

const log: logging.Logger = logging.getLogger('loggroup-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);

const logsClient = new CloudWatchLogsClient({
  region,
  retryStrategy,
});

const metricConfigs = LOGGROUP_CONFIGS;

export async function fetchLogGroupTags(
  arn: string,
): Promise<Record<string, string>> {
  return fetchResourceTags('Logs', arn, async () => {
    const resp = await logsClient.send(
      new ListTagsForResourceCommand({
        resourceArn: arn,
      }),
    );

    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(resp.tags ?? {})) {
      if (key.startsWith('autoalarm:')) {
        tags[key] = value ?? '';
      }
    }

    return tags;
  });
}

async function manageLogGroupAlarms(
  logGroupArn: string,
  logGroupName: string,
  tags: Tag,
): Promise<void> {
  const dimensions: Dimension[] = [{Name: 'LogGroupName', Value: logGroupName}];

  // The event parser performs its own autoalarm:enabled gating before calling
  // this, so skip the generic enabled check.
  await manageServiceAlarms({
    service: 'Logs',
    identifier: logGroupArn,
    tags,
    configs: metricConfigs,
    dimensions,
    checkEnabled: false,
  });
}

/**
 * this interface and following function should be abstracted into their own utility class
 * along with other commonly used function[ality]/[s]
 */
interface ServiceInfo {
  arn: string;
  resourceName: string;
}

function extractLogGroupIdentifiers(
  eventBody: string,
): ServiceInfo | undefined {
  // Failed events (errorCode present) never have responseElements with an ARN.
  // Skip the string search to avoid a spurious error log; caller handles fallback.
  const parsedBody = JSON.parse(eventBody);
  if (parsedBody.detail?.errorCode) {
    return void 0;
  }

  // Extract the log group ARN from the raw event body.
  // Normal for CreateLogGroup events where the ARN isn't in the request body.
  // The caller falls back to constructing the ARN from requestParameters.
  // A miss here is the normal CreateLogGroup path (no ARN in the body; the
  // caller reconstructs it from requestParameters), so log it at debug rather
  // than flooding ERROR for every log group event in the account.
  const arn = findArnInEvent(eventBody, 'arn:aws:logs', {
    notFoundLogLevel: 'debug',
  }).trim();
  if (!arn) {
    log
      .debug()
      .str('function', 'extractLogGroupIdentifiers')
      .msg(
        'No LogGroup ARN found in event body; caller will use requestParameters fallback',
      );
    return void 0;
  }

  // Extract LogGroup name from ARN
  const arnParts = arn.split('log-group:');
  if (arnParts.length < 2) {
    log
      .error()
      .str('function', 'extractLogGroupIdentifiers')
      .str('arn', arn)
      .msg('Invalid LogGroup ARN format - missing cluster name');
    return void 0;
  }

  const resourceName = arnParts[1].replace('"', '').trim();

  log
    .info()
    .str('function', 'ExtractLogGroupIdentifiers')
    .str('arn', arn)
    .str('LogGroup Name', resourceName)
    .msg('Extracted LogGroup ARN and LogGroup name');

  return {
    arn: arn,
    resourceName: resourceName,
  };
}

export async function parseLogGroupEventAndCreateAlarms(
  record: SQSRecord,
): Promise<void> {
  const body = JSON.parse(record.body);
  const detail = body.detail;
  const eventName = detail?.eventName;
  const logGroupInfo = extractLogGroupIdentifiers(record.body);
  let arn: string = '';
  let resourceName: string = '';

  // Early return and log if we're dealing with logstreams:
  if (body.detail.eventName.includes('LogStream')) {
    log
      .info()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('eventName', eventName)
      .msg(
        'Log stream event. No Alarm management necessary, please tag LogGroup instead of LogStream for autoalarm management',
      );
    return;
  }

  if (logGroupInfo) {
    arn = logGroupInfo.arn;
    resourceName = logGroupInfo.resourceName;
  }

  if (!logGroupInfo) {
    log
      .debug()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('eventName', eventName)
      .msg('No ARN in event body; falling back to requestParameters');

    // Failed API calls (e.g. AccessDenied) always have null requestParameters.
    // Nothing to process — skip quietly.
    if (!body.detail.requestParameters) {
      log
        .debug()
        .str('function', 'parseLogGroupEventAndCreateAlarms')
        .str('eventName', eventName)
        .msg('requestParameters is null (failed API call) — skipping event');
      return;
    }

    try {
      resourceName = body.detail.requestParameters.logGroupName;
      arn = `arn:aws:logs:${body.region}:${body.account}:log-group:${resourceName}`;
      log
        .info()
        .str('function', 'parseLogGroupEventAndCreateAlarms')
        .str('eventName', eventName)
        .str('logGroupArn', arn)
        .str('logGroupName', resourceName)
        .msg('Extracted LogGroup ARN and LogGroup name');
    } catch {
      log
        .error()
        .str('function', 'parseLogGroupEventAndCreateAlarms')
        .str('eventName', eventName)
        .msg('Failed to extract log group identifiers');
      throw new Error('Failed to extract log group identifiers', {
        cause: record,
      });
    }
  }

  // bedrock-agentcore creates and destroys log groups continuously; skip all
  // non-delete events to avoid flooding the queue. DeleteLogGroup must still
  // proceed so any previously created alarms are cleaned up.
  if (
    resourceName.startsWith('/aws/bedrock-agentcore/') &&
    eventName !== 'DeleteLogGroup'
  ) {
    log
      .info()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('logGroupName', resourceName)
      .msg(
        'Skipping bedrock-agentcore log group — excluded from AutoAlarm management',
      );
    return;
  }

  log
    .info()
    .str('function', 'parseLogGroupEventAndCreateAlarms')
    .str('eventName', eventName)
    .str('logGroupArn', arn)
    .str('logGroupName', resourceName)
    .msg('Processing log group event');

  // Early alarm deletion if delete event
  if (eventName === 'DeleteLogGroup') {
    log
      .info()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('eventName', eventName)
      .msg('Processing delete log group event');

    await deleteExistingAlarms('Logs', arn, metricConfigs);
    return;
  }

  // For non-delete events, fetch tags and filter out AutoAlarm Tags
  const tags = await fetchLogGroupTags(arn);

  // AutoAlarm is opt-in: only manage alarms when autoalarm:enabled is
  // explicitly set to 'true'. Anything else (tag absent, 'false', or an
  // unexpected value) takes the delete path.
  const isAlarmEnabled = tags['autoalarm:enabled'] === 'true';
  if (!isAlarmEnabled) {
    log
      .info()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('logGroupArn', arn)
      .msg(
        'autoalarm:enabled tag missing or not set to true - deleting any existing alarms',
      );
    await deleteExistingAlarms('Logs', arn, metricConfigs);
    return;
  }

  // AutoAlarm enabled → reconcile alarms.
  try {
    await manageLogGroupAlarms(arn, resourceName, tags);
  } catch (error) {
    log
      .error()
      .str('function', 'parseLogGroupEventAndCreateAlarms')
      .str('logGroupArn', arn)
      .err(error)
      .msg('Error managing log group alarms');
    throw new Error(
      `Failed to manage alarms for log group ${resourceName}: ${error}`,
    );
  }
}
