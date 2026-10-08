import {
  SQSHandler,
  SQSEvent,
  SQSBatchResponse,
  SQSBatchItemFailure,
  SQSRecord,
} from 'aws-lambda';
import {
  CloudWatchClient,
  SetAlarmStateCommand,
} from '@aws-sdk/client-cloudwatch';
import * as logging from '@nr1e/logging';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';

// Retry up to 5 times with linear backoff (100ms + 1s per attempt) instead of
// hammering the API with constant-delay retries.
const retryStrategy = new ConfiguredRetryStrategy(
  5,
  (attempt) => 100 + attempt * 1000,
);
const cloudwatch = new CloudWatchClient({
  region: process.env.AWS_REGION,
  retryStrategy: retryStrategy,
});

// Set up logging configuration with fallback to 'info' level
const level = process.env.LOG_LEVEL || 'info';
if (!logging.isLevel(level)) {
  throw new Error(`Invalid log level: ${level}`);
}
const log = logging.initialize({
  svc: 'AutoAlarm',
  name: 'realarm-consumer',
  level,
});

// Constants for rate limiting and retries
const DELAY_BETWEEN_OPERATIONS = 200;
const THROTTLING_ERROR_CODES = [
  'Throttling', // CloudWatch (Query protocol) throttle error name
  'ThrottlingException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'RequestThrottled', // SQS throttle error name
];
const BACKOFF_MULTIPLIER = 1.5;

/**
 * Detects throttling errors by matching the error name (precise) and falling
 * back to a message substring match for wrapped/stringified errors.
 */
function isThrottlingError(error: unknown): boolean {
  const errorName = error instanceof Error ? error.name : '';
  return THROTTLING_ERROR_CODES.some(
    (code) => errorName === code || String(error).includes(code),
  );
}
/**
 * Message produced by the ReAlarm producer. The producer resolves all
 * tag-derived facts (bulk Resource Groups Tagging API sweep for the standard
 * cycle, single ListTagsForResource for the override path) and embeds them in
 * the message, so this consumer performs no tag lookups. Note: the Tagging
 * API data the producer reads is eventually consistent and can lag tag
 * changes by minutes.
 */
interface AlarmMessage {
  alarmName: string;
  alarmArn: string;
  alarmActions: string[];
  isOverride?: boolean;
  /** True when the alarm carries autoalarm:re-alarm-enabled=false. */
  reAlarmDisabled?: boolean;
  /** True when the alarm carries a valid autoalarm:re-alarm-minutes tag. */
  hasOverrideTag?: boolean;
}

interface ErrorMetrics {
  throttlingErrors: number;
  totalErrors: number;
  totalCalls: number;
  startTime: number;
}

const metrics: ErrorMetrics = {
  throttlingErrors: 0,
  totalErrors: 0,
  totalCalls: 0,
  startTime: 0,
};

function resetMetrics() {
  metrics.throttlingErrors = 0;
  metrics.totalErrors = 0;
  metrics.totalCalls = 0;
  metrics.startTime = Date.now();
}

function logMetricsSummary() {
  const duration = Date.now() - metrics.startTime;
  log
    .info()
    .str('function', 'logMetricsSummary')
    .num('totalApiCalls', metrics.totalCalls)
    .num('throttlingErrors', metrics.throttlingErrors)
    .num('totalErrors', metrics.totalErrors)
    .num('durationMs', duration)
    .num(
      'callsPerSecond',
      (metrics.totalCalls / (duration / 1000)).toFixed(2) as unknown as number,
    )
    .msg('API call metrics summary');
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function validateAlarm(alarm: AlarmMessage): boolean {
  // Log all actions for this alarm
  log
    .info()
    .str('function', 'validateAlarm')
    .str('alarmName', alarm.alarmName)
    .num('actionCount', alarm.alarmActions.length)
    .str('actions', JSON.stringify(alarm.alarmActions))
    .msg('Alarm actions found');

  // If there are autoscaling actions, log them specifically.
  // Match on the ARN service segment (arn:aws:<service>:...) rather than a
  // substring of the whole ARN so that e.g. an SNS topic named
  // "my-autoscaling-alerts" does not exclude its alarm. EC2 Auto Scaling
  // policies use the 'autoscaling' service; Application Auto Scaling uses
  // 'application-autoscaling'.
  const autoscalingActions = alarm.alarmActions.filter((action) => {
    const service = action.split(':')[2];
    return service === 'autoscaling' || service === 'application-autoscaling';
  });
  if (autoscalingActions.length > 0) {
    log
      .info()
      .str('function', 'validateAlarm')
      .str('alarmName', alarm.alarmName)
      .num('autoscalingActionCount', autoscalingActions.length)
      .str('autoscalingActions', JSON.stringify(autoscalingActions))
      .msg('Autoscaling actions found - alarm will be excluded');
  }

  // Tag-derived facts are resolved by the producer and embedded in the
  // message - no tag lookups happen here. Normalize with Boolean() so
  // messages produced before these fields existed (in-flight during a
  // deploy) keep their historical standard-cycle behavior.
  const reAlarmDisabled = Boolean(alarm.reAlarmDisabled);

  // Only a real positive integer counts as an override (mirrors the tag-event
  // handler); the producer applies that rule when it sets hasOverrideTag.
  const reAlarmOverrideTag = Boolean(alarm.hasOverrideTag);

  const hasAutoScalingAction = autoscalingActions.length > 0;

  // Log the validation decision with all criteria
  log
    .info()
    .str('function', 'validateAlarm')
    .str('alarmName', alarm.alarmName)
    .str('autoalarm:re-alarm-enabled', reAlarmDisabled ? 'false' : 'true')
    .str('reAlarmOverrideTag', String(reAlarmOverrideTag))
    .str('hasAutoScalingAction', String(hasAutoScalingAction))
    .str('isOverride', String(alarm.isOverride))
    .str(
      'isValid',
      String(
        !reAlarmDisabled &&
          !hasAutoScalingAction &&
          reAlarmOverrideTag === Boolean(alarm.isOverride),
      ),
    )
    .msg('Alarm validation result');

  return (
    !reAlarmDisabled &&
    !hasAutoScalingAction &&
    reAlarmOverrideTag === Boolean(alarm.isOverride)
  );
}

async function resetAlarmState(
  alarmName: string,
  isOverride: boolean,
): Promise<void> {
  const stateReason = isOverride
    ? 'Resetting state from reAlarm override Lambda function'
    : 'Resetting state from reAlarm Lambda function';

  try {
    metrics.totalCalls++;
    await cloudwatch.send(
      new SetAlarmStateCommand({
        AlarmName: alarmName,
        StateValue: 'OK',
        StateReason: stateReason,
      }),
    );

    log
      .info()
      .str('function', 'resetAlarmState')
      .str('alarmName', alarmName)
      .str('isOverride', String(isOverride))
      .msg(`Successfully reset alarm: ${alarmName}`);
  } catch (error) {
    metrics.totalErrors++;
    if (isThrottlingError(error)) {
      metrics.throttlingErrors++;
    }

    log
      .fatal()
      .str('function', 'resetAlarmState')
      .str('alarmName', alarmName)
      .str('error', String(error))
      .msg(`Failed to reset alarm: ${alarmName}`);
    throw error;
  }
}

let currentDelay = DELAY_BETWEEN_OPERATIONS;

async function processAlarm(message: AlarmMessage): Promise<void> {
  try {
    const startTime = Date.now();
    let throttleCount = 0;

    try {
      if (validateAlarm(message)) {
        // Reset the throttling error count before the next API call
        const previousThrottleErrors = metrics.throttlingErrors;
        await resetAlarmState(message.alarmName, message.isOverride || false);
        // Count any new throttling errors from resetAlarmState
        throttleCount += metrics.throttlingErrors - previousThrottleErrors;

        const processingTime = Date.now() - startTime;

        // Now our throttling adjustment will work properly
        if (throttleCount > 0) {
          currentDelay = Math.min(currentDelay * BACKOFF_MULTIPLIER, 2000);
          log
            .warn()
            .str('function', 'processAlarm')
            .str('alarmName', message.alarmName)
            .num('throttleCount', throttleCount)
            .num('newDelay', currentDelay)
            .msg('Increasing delay due to throttling');
        } else if (processingTime < currentDelay / 2) {
          currentDelay = Math.max(
            currentDelay / BACKOFF_MULTIPLIER,
            DELAY_BETWEEN_OPERATIONS,
          );
          log
            .info()
            .str('function', 'processAlarm')
            .str('alarmName', message.alarmName)
            .num('processingTime', processingTime)
            .num('newDelay', currentDelay)
            .msg('Decreasing delay due to good performance');
        }

        log
          .info()
          .str('function', 'processAlarm')
          .str('alarmName', message.alarmName)
          .str('finalDelay', String(currentDelay))
          .num('totalThrottleCount', throttleCount)
          .msg('Successfully processed alarm');
      } else {
        log
          .info()
          .str('function', 'processAlarm')
          .str('alarmName', message.alarmName)
          .msg('Alarm validation failed, skipping');
      }

      await delay(currentDelay);
    } catch (error) {
      // Handle errors from the API calls
      if (isThrottlingError(error)) {
        throttleCount++;
        currentDelay = Math.min(currentDelay * BACKOFF_MULTIPLIER, 2000);
        log
          .warn()
          .str('function', 'processAlarm')
          .str('alarmName', message.alarmName)
          .num('throttleCount', throttleCount)
          .num('newDelay', currentDelay)
          .str('error', String(error))
          .msg('Increasing delay due to throttling error');
      }
      throw error; // Re-throw to be handled by outer catch
    }
  } catch (error) {
    // Handle all errors
    log
      .error()
      .str('function', 'processAlarm')
      .str('alarmName', message.alarmName)
      .str('error', String(error))
      .msg('Failed to process alarm');
    throw error;
  }
}

export const handler: SQSHandler = async (
  event: SQSEvent,
): Promise<SQSBatchResponse> => {
  log
    .trace()
    .str('function', 'handler')
    .num('recordCount', event.Records.length)
    .msg('Processing SQS event');

  resetMetrics();

  /**
   * Create batch item failures array to store any failed items from the batch.
   */
  const batchItemFailures: SQSBatchItemFailure[] = [];
  const batchItemBodies: SQSRecord[] = [];

  // Keep the link between each parsed message and its originating SQS record
  // so failures can be attributed to the correct messageId.
  const parsedMessages = event.Records.flatMap((record) => {
    try {
      // Check if the record body contains an error message
      if (record.body && record.body.includes('errorMessage')) {
        log
          .warn()
          .str('messageId', record.messageId)
          .msg('Error message found in record body');
        return [];
      }
      return [{record, message: JSON.parse(record.body) as AlarmMessage}];
    } catch (error) {
      log
        .error()
        .str('messageId', record.messageId)
        .str('error', String(error))
        .msg('Error parsing record body');
      batchItemFailures.push({itemIdentifier: record.messageId});
      batchItemBodies.push(record);
      return [];
    }
  });

  // All tag-derived facts arrive embedded in the message body (resolved by
  // the producer), so every successfully parsed message is processable - no
  // per-alarm tag fetches and no tag-fetch failure handling are needed here.
  const processableMessages = parsedMessages;

  try {
    const processingResults = await Promise.allSettled(
      processableMessages.map(({message}) => processAlarm(message)),
    );

    // Attribute failures by index - processingResults[i] corresponds to
    // processableMessages[i], which carries its originating SQS record.
    const failures = processingResults.filter((result, index) => {
      if (result.status === 'rejected') {
        const {record} = processableMessages[index];
        batchItemFailures.push({itemIdentifier: record.messageId});
        batchItemBodies.push(record);
        return true;
      }
      return false;
    });

    logMetricsSummary();

    if (failures.length > 0) {
      log
        .error()
        .str('function', 'handler')
        .num('failureCount', failures.length)
        .num('successCount', processingResults.length - failures.length)
        .msg('Some alarms failed to process');
      // No longer throw error here
    }

    log
      .info()
      .str('function', 'handler')
      .num('processedAlarms', processingResults.length)
      .msg('Successfully processed all alarms');
  } catch (error) {
    log
      .error()
      .str('function', 'handler')
      .str('error', String(error))
      .msg('Failed to process SQS event');

    // Instead of throwing, mark all remaining records as failed
    for (const record of event.Records) {
      if (
        !batchItemFailures.some((f) => f.itemIdentifier === record.messageId)
      ) {
        batchItemFailures.push({itemIdentifier: record.messageId});
        batchItemBodies.push(record);
      }
    }
  }

  if (batchItemFailures.length > 0) {
    log
      .info()
      .str('function', 'handler')
      .num('failedItems', batchItemFailures.length)
      .obj(
        'failedItemIds',
        batchItemFailures.map((f) => f.itemIdentifier),
      )
      .obj('failedItemBodies', batchItemBodies)
      .msg('Reporting failed items for partial batch processing');
  }

  // Return the batch item failures
  return {
    batchItemFailures: batchItemFailures,
  };
};
