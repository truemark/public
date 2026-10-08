import {
  Handler,
  SQSBatchItemFailure,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  Tag,
} from '@aws-sdk/client-cloudwatch';
import {
  EventBridgeClient,
  PutTargetsCommand,
  PutRuleCommand,
  DeleteRuleCommand,
  RemoveTargetsCommand,
} from '@aws-sdk/client-eventbridge';
import * as logging from '@nr1e/logging';
import * as crypto from 'crypto';

// Initialize logging
const level = process.env.LOG_LEVEL || 'info';
if (!logging.isLevel(level)) {
  throw new Error(`Invalid log level: ${level}`);
}
const log = logging.initialize({
  svc: 'AutoAlarm',
  name: 'realarm-event-rule-handler',
  level,
});

// Configuration constants
const TAG_KEY = 'autoalarm:re-alarm-minutes';

// Bounds for the autoalarm:re-alarm-minutes tag value. The producer scans every
// alarm in the account on each invocation, so very short schedules are abusive;
// cap at one day to keep override schedules sane.
const MIN_REALARM_MINUTES = 5;
const MAX_REALARM_MINUTES = 1440;

const targetFunctionArn = process.env.PRODUCER_FUNCTION_ARN;

// Initialize AWS service clients
const eventbridge = new EventBridgeClient({});

/**
 * Creates a consistent hash from alarm name
 * @param alarmName - The full alarm name to hash
 * @returns A 6-character hash string
 */
function createAlarmHash(alarmName: string): string {
  const baseAlarmName = alarmName.replace(/^AutoAlarm-/, '');
  return crypto
    .createHash('md5')
    .update(baseAlarmName)
    .digest('hex')
    .substring(0, 6);
}

function sanitizeForEventBridge(alarmName: string): string {
  return alarmName
    .replace(/^AutoAlarm-/, '') // Remove AutoAlarm- prefix first
    .replace(/[^a-zA-Z0-9\-_]/g, '-') // Replace invalid characters
    .substring(0, 32); // Truncate to 32 chars
}

/**
 * Deletes an EventBridge rule and its targets
 * @param alarmName - The name of the CloudWatch Alarm
 */
async function deleteEventBridgeRule(alarmName: string): Promise<void> {
  const sanitizedName = sanitizeForEventBridge(alarmName);

  const hashSuffix = createAlarmHash(alarmName);

  const ruleName = `AutoAlarm-ReAlarm-${sanitizedName}-${hashSuffix}`;
  const targetId = `Target-${sanitizedName}-${hashSuffix}`;

  try {
    // Remove targets before deleting the rule
    await eventbridge.send(
      new RemoveTargetsCommand({
        Rule: ruleName,
        Ids: [targetId],
      }),
    );

    await eventbridge.send(
      new DeleteRuleCommand({
        Name: ruleName,
      }),
    );

    log
      .info()
      .str('function', 'deleteEventBridgeRule')
      .str('ruleName', ruleName)
      .msg('Successfully deleted EventBridge rule');
  } catch (error) {
    // Deleting a rule that was never created (e.g. an opt-out tag on an alarm
    // that never had an override schedule) is the common case - treat it as a
    // successful no-op instead of failing the record.
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      log
        .debug()
        .str('function', 'deleteEventBridgeRule')
        .str('alarmName', alarmName)
        .str('ruleName', ruleName)
        .msg('Rule did not exist - nothing to delete');
      return;
    }
    log
      .error()
      .str('function', 'deleteEventBridgeRule')
      .str('alarmName', alarmName)
      .msg(`Error deleting rule: ${error}`);
    throw error;
  }
}

/**
 * Creates an EventBridge rule that triggers a Lambda function on a schedule
 * @param alarmName - The name of the CloudWatch Alarm
 * @param minutes - The interval in minutes for the rule to trigger
 * @param functionArn - The ARN of the reAlarm producer lambda
 */
async function createEventBridgeRule(
  alarmName: string,
  minutes: number,
  functionArn: string,
): Promise<void> {
  // Generate a hashed 6-character suffix
  const hashSuffix = createAlarmHash(alarmName);

  // Sanitize the alarm name for use in rule name and target ID
  // Limit to 32 characters to accommodate suffix to avoid eventbridge rule name collision
  const sanitizedName = sanitizeForEventBridge(alarmName);

  const ruleName = `AutoAlarm-ReAlarm-${sanitizedName}-${hashSuffix}`;
  const rateUnit = minutes === 1 ? 'minute' : 'minutes';

  try {
    // Create the rule first
    await eventbridge.send(
      new PutRuleCommand({
        Name: ruleName,
        Description: `Re-alarm rule for ${alarmName} every ${minutes} minutes`,
        ScheduleExpression: `rate(${minutes} ${rateUnit})`,
        State: 'ENABLED',
      }),
    );

    // Then add the target
    await eventbridge.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [
          {
            Id: `Target-${sanitizedName}-${hashSuffix}`,
            Arn: functionArn,
            Input: JSON.stringify({
              event: {'reAlarmOverride-AlarmName': alarmName},
            }),
          },
        ],
      }),
    );

    log
      .info()
      .str('function', 'createEventBridgeRule')
      .str('ruleName', ruleName)
      .msg(`Created rule: ${ruleName}`);
  } catch (error) {
    log
      .error()
      .str('function', 'createEventBridgeRule')
      .str('alarmName', alarmName)
      .str('functionArn', functionArn)
      .msg(`Error creating rule: ${error}`);
    throw error;
  }
}

function validateEvent(event: {
  resources: string[];
  detail: {tags: {[s: string]: unknown} | ArrayLike<unknown>};
}): {resourceARN: string; tags: Tag[]} {
  if (!event?.resources?.[0]) {
    throw new Error('Invalid event structure: Missing resource ARN');
  }

  if (!event?.detail?.tags) {
    throw new Error('Invalid event structure: Missing tags object');
  }

  // Convert the tags object to the Tag array format
  const tags: Tag[] = Object.entries(event.detail.tags).map(([Key, Value]) => ({
    Key,
    Value: String(Value),
  }));

  return {
    resourceARN: event.resources[0],
    tags,
  };
}

/**
 * Lambda handler that processes CloudWatch Alarm tag changes.
 * When a tag with key 'autoalarm:re-alarm-minutes' is added/modified:
 * 1. Validates the tag value is a positive number
 * 2. Retrieve alarm details
 * 3. Create an EventBridge rule to trigger the re-alarm function on the specified schedule
 *
 * When the tag is removed or invalid:
 * 1. Delete any existing EventBridge rule for the alarm
 */
export const handler: Handler = async (
  event: SQSEvent,
): Promise<SQSBatchResponse> => {
  log.trace().unknown('event', event).msg('Received event');

  /**
   * Create batch item failures array to store any failed items from the batch.
   */
  const batchItemFailures: SQSBatchItemFailure[] = [];
  const batchItemBodies: SQSRecord[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actualEvent = 'event' in event ? (event as any).event : event;

  if (!actualEvent?.Records) {
    log.warn().unknown('rawEvent', event).msg('No Records found in event');
    // Instead of throwing, return the event as failed
    return {
      batchItemFailures: [{itemIdentifier: 'entire-batch'}],
    };
  }

  for (const record of actualEvent.Records) {
    try {
      // Check if the record body contains an error message
      if (record.body && record.body.includes('errorMessage')) {
        log
          .error()
          .str('messageId', record.messageId)
          .msg('Error message found in record body');
        batchItemFailures.push({itemIdentifier: record.messageId});
        batchItemBodies.push(record);
        continue;
      }

      // Parse the body of the SQS message
      const event = JSON.parse(record.body);
      log.trace().obj('body', event).msg('Processing message body');

      // Validate event structure and convert tags format
      const {resourceARN, tags} = validateEvent(event);

      // Get alarm details first to ensure we have a valid alarm
      const alarmArn = event.resources[0]; // Get the first ARN from resources array
      const alarmName = alarmArn.split(':alarm:')[1]; // Extract alarm name from ARN

      const {MetricAlarms} = await new CloudWatchClient({}).send(
        new DescribeAlarmsCommand({
          AlarmNames: [alarmName],
        }),
      );

      log
        .info()
        .str('function', 'handler')
        .str('resourceARN', resourceARN)
        .obj('MetricAlarms', MetricAlarms)
        .msg('Alarm details');

      // DescribeAlarms returns MetricAlarms: [] (truthy) for nonexistent
      // alarms, so we must check the length to detect "not found".
      if (!MetricAlarms?.length) {
        log
          .info()
          .str('function', 'handler')
          .str('resourceARN', resourceARN)
          .msg('Alarm not found. Deleting any associated eventbridge rules');
        await deleteEventBridgeRule(alarmName);
        continue; // Continue to next record instead of returning
      }

      // Extract and validate the tags
      const reAlarmTag = tags.find((t) => t.Key === TAG_KEY);
      const enabledTag = tags.find(
        (t) => t.Key === 'autoalarm:re-alarm-enabled',
      );
      const minutes = reAlarmTag ? Number(reAlarmTag.Value) : null;

      // Check if explicitly disabled
      if (
        enabledTag &&
        enabledTag.Value &&
        enabledTag.Value.toLowerCase() === 'false'
      ) {
        log
          .info()
          .str('function', 'handler')
          .str('resourceARN', resourceARN)
          .msg('Re-alarm explicitly disabled - deleting existing rule');

        await deleteEventBridgeRule(alarmName);
        continue; // Continue to next record instead of returning
      }

      // Validate minutes value
      if (!minutes || minutes <= 0 || !Number.isInteger(minutes)) {
        log
          .info()
          .str('function', 'handler')
          .str('resourceARN', resourceARN)
          .msg('Invalid or missing tag value - deleting existing rule');

        // Delete the rule if tag is invalid or missing
        await deleteEventBridgeRule(alarmName);
        continue; // Continue to next record instead of returning
      }

      // Enforce schedule bounds - treat out-of-bounds values as invalid
      if (minutes < MIN_REALARM_MINUTES || minutes > MAX_REALARM_MINUTES) {
        log
          .warn()
          .str('function', 'handler')
          .str('resourceARN', resourceARN)
          .num('minutes', minutes)
          .num('minMinutes', MIN_REALARM_MINUTES)
          .num('maxMinutes', MAX_REALARM_MINUTES)
          .msg(
            'Tag value outside allowed bounds - treating as invalid and deleting existing rule',
          );

        await deleteEventBridgeRule(alarmName);
        continue; // Continue to next record instead of returning
      }

      // Create/update the EventBridge rule with the specified schedule
      await createEventBridgeRule(alarmName, minutes, targetFunctionArn!);
    } catch (error) {
      log
        .error()
        .str('function', 'handler')
        .str('messageId', record.messageId)
        .unknown('error', error)
        .msg('Error processing record');
      batchItemFailures.push({itemIdentifier: record.messageId});
      batchItemBodies.push(record);
    }
  }

  if (batchItemFailures.length > 0) {
    log
      .info()
      .str('function', 'handler')
      .num('failedItems', batchItemFailures.length)
      .obj('failedItems', batchItemFailures)
      .obj('batchItemBodies', batchItemBodies)
      .msg('Reporting failed items for partial batch processing');
  }

  // Always return the batchItemFailures, which will be empty if all succeeded
  return {
    batchItemFailures: batchItemFailures,
  };
};
