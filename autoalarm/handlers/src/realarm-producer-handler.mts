import {Handler} from 'aws-lambda';
import {
  CloudWatchClient,
  paginateDescribeAlarms,
  MetricAlarm,
  DescribeAlarmsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  ResourceGroupsTaggingAPIClient,
  paginateGetResources,
  ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import * as logging from '@nr1e/logging';
import * as crypto from 'crypto';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  buildReAlarmTagSets,
  parseOverrideMinutes,
  ReAlarmTagSets,
  REALARM_DISABLED_TAG_KEY,
  REALARM_OVERRIDE_TAG_KEY,
} from './realarm-tag-sets.mjs';

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
const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  retryStrategy: retryStrategy,
});
const taggingApi = new ResourceGroupsTaggingAPIClient({
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
  name: 'realarm-producer',
  level,
});

const PAGE_SIZE = 100;
const SQS_BATCH_SIZE = 10;
// Number of SendMessageBatch calls issued concurrently per group
const MAX_CONCURRENT_SQS_BATCHES = 5;
// Small fixed pause between concurrent groups to smooth burst traffic to SQS;
// throttling itself is handled by the SDK retry strategy.
const DELAY_BETWEEN_BATCH_GROUPS = 100;
const THROTTLING_ERROR_CODES = [
  'Throttling', // CloudWatch (Query protocol) throttle error name
  'ThrottlingException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'RequestThrottled', // SQS throttle error name
];

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

function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({length: Math.ceil(array.length / size)}, (_, index) =>
    array.slice(index * size, index * size + size),
  );
}

/**
 * Tag-derived facts embedded in each SQS message so the consumer can validate
 * without any per-alarm tag lookups.
 */
interface ReAlarmTagFacts {
  reAlarmDisabled: boolean;
  hasOverrideTag: boolean;
}

const TAGGING_API_PAGE_SIZE = 100;

/**
 * Bulk pre-filter: one Resource Groups Tagging API sweep per re-alarm tag key
 * per run. GetResources only returns TAGGED resources, so this builds the
 * EXCLUSION/OVERRIDE sets - never the eligible set. DescribeAlarms remains
 * the eligibility enumerator; alarms with no tags stay eligible (ReAlarm is
 * opt-out by design).
 *
 * NOTE on eventual consistency: Resource Groups Tagging API data can lag tag
 * changes by several minutes. Worst case, an alarm tagged
 * autoalarm:re-alarm-enabled=false moments before a run is re-alarmed one
 * extra time, or a freshly untagged alarm is skipped for one cycle. The
 * single-alarm override path below uses ListTagsForResource directly and is
 * not affected.
 */
async function fetchReAlarmTagSets(): Promise<ReAlarmTagSets> {
  const mappings: ResourceTagMapping[] = [];

  // GetResources ANDs multiple TagFilters together, so sweep once per tag
  // key to find resources carrying EITHER re-alarm tag.
  for (const tagKey of [REALARM_DISABLED_TAG_KEY, REALARM_OVERRIDE_TAG_KEY]) {
    try {
      const paginator = paginateGetResources(
        {client: taggingApi},
        {
          ResourceTypeFilters: ['cloudwatch:alarm'],
          TagFilters: [{Key: tagKey}],
          ResourcesPerPage: TAGGING_API_PAGE_SIZE,
        },
      );

      for await (const page of paginator) {
        metrics.totalCalls++;
        mappings.push(...(page.ResourceTagMappingList ?? []));
      }
    } catch (error) {
      metrics.totalErrors++;
      if (isThrottlingError(error)) {
        metrics.throttlingErrors++;
      }
      log
        .error()
        .str('function', 'fetchReAlarmTagSets')
        .str('tagKey', tagKey)
        .str('error', String(error))
        .msg('Failed to fetch tagged alarms from Resource Groups Tagging API');
      throw error;
    }
  }

  const tagSets = buildReAlarmTagSets(mappings);

  log
    .info()
    .str('function', 'fetchReAlarmTagSets')
    .num('taggedResources', mappings.length)
    .num('excludedArns', tagSets.excludedArns.size)
    .num('overrideArns', tagSets.overrideByArn.size)
    .msg('Built ReAlarm exclusion/override sets from Tagging API');

  return tagSets;
}

/**
 * Single-alarm tag lookup for the override path (per-alarm EventBridge
 * schedule rules invoke the producer for ONE alarm). One ListTagsForResource
 * call is the cheapest correct form here - the Tagging API cannot filter by
 * resource ARN, and a direct lookup avoids its propagation lag.
 */
async function fetchAlarmTagFacts(
  alarmName: string,
  alarmArn: string,
): Promise<ReAlarmTagFacts> {
  try {
    metrics.totalCalls++;
    const response = await cloudwatch.send(
      new ListTagsForResourceCommand({ResourceARN: alarmArn}),
    );
    const tags = response.Tags ?? [];

    return {
      reAlarmDisabled: tags.some(
        (tag) => tag.Key === REALARM_DISABLED_TAG_KEY && tag.Value === 'false',
      ),
      hasOverrideTag: tags.some(
        (tag) =>
          tag.Key === REALARM_OVERRIDE_TAG_KEY &&
          parseOverrideMinutes(tag.Value) !== null,
      ),
    };
  } catch (error) {
    metrics.totalErrors++;
    if (isThrottlingError(error)) {
      metrics.throttlingErrors++;
    }
    log
      .error()
      .str('function', 'fetchAlarmTagFacts')
      .str('alarmName', alarmName)
      .str('alarmArn', alarmArn)
      .str('error', String(error))
      .msg('Failed to fetch tags for override alarm');
    throw error;
  }
}

async function getOverriddenAlarm(alarmName: string): Promise<MetricAlarm[]> {
  try {
    // Fetch the specific alarm by name
    const response = await cloudwatch.send(
      new DescribeAlarmsCommand({AlarmNames: [alarmName]}),
    );

    if (!response.MetricAlarms?.length) {
      log
        .info()
        .str('function', 'getOverriddenAlarm')
        .str('alarmName', alarmName)
        .msg('Alarm not found');
      return [];
    }

    // Check if the alarm needs processing by verifying it's not already in OK state
    const alarm = response.MetricAlarms[0];
    if (alarm.StateValue === 'OK') {
      log
        .info()
        .str('function', 'getOverriddenAlarm')
        .str('alarmName', alarmName)
        .str('currentState', alarm.StateValue || 'UNKNOWN')
        .msg('Override alarm already in OK state, skipping');
      return [];
    }

    // If we get here, the alarm needs processing
    log
      .info()
      .str('function', 'getOverriddenAlarm')
      .str('alarmName', alarmName)
      .str('currentState', alarm.StateValue || 'UNKNOWN')
      .msg('Found override alarm requiring processing');

    return response.MetricAlarms;
  } catch (error) {
    log
      .error()
      .str('function', 'getOverriddenAlarm')
      .str('alarmName', alarmName)
      .str('error', String(error))
      .msg('Failed to fetch override alarm');
    throw error;
  }
}

async function sendAlarmsToSQS(
  alarms: MetricAlarm[],
  queueUrl: string,
  isOverride: boolean,
  tagFacts: ReAlarmTagFacts,
): Promise<void> {
  // Filter out alarms that are already in OK state
  const alarmsToProcess = alarms.filter((alarm) => {
    const isNotOk = alarm.StateValue !== 'OK';
    if (!isNotOk) {
      log
        .debug()
        .str('function', 'sendAlarmsToSQS')
        .str('alarmName', alarm.AlarmName || '')
        .str('state', alarm.StateValue || '')
        .msg('Skipping alarm already in OK state');
    }
    return isNotOk;
  });

  // Early return if no alarms need processing
  if (alarmsToProcess.length === 0) {
    log
      .info()
      .num('skippedAlarms', alarms.length)
      .msg('No alarms need processing - all in OK state');
    return;
  }

  // Process alarms in batches for efficiency
  const batches = chunk(alarmsToProcess, SQS_BATCH_SIZE);

  log
    .info()
    .str('function', 'sendAlarmsToSQS')
    .num('totalAlarms', alarmsToProcess.length)
    .num('skippedAlarms', alarms.length - alarmsToProcess.length)
    .num('totalBatches', batches.length)
    .str('isOverride', String(isOverride))
    .msg('Starting to send alarms to SQS');

  // Create hash for unique message id
  const messageHash = (alarm: string): string => {
    return crypto
      .createHash('sha256')
      .update(alarm)
      .digest('hex')
      .substring(0, 8);
  };

  const sendBatch = async (
    batch: MetricAlarm[],
    batchIndex: number,
  ): Promise<void> => {
    // Prepare messages for the batch
    const entries: SendMessageBatchRequestEntry[] = batch.map((alarm, i) => ({
      Id: `${batchIndex}-${i}`,
      MessageBody: JSON.stringify({
        alarmName: alarm.AlarmName,
        alarmArn: alarm.AlarmArn,
        alarmActions: alarm.AlarmActions || [],
        isOverride,
        // Tag-derived facts resolved by the producer (bulk Tagging API sweep
        // for the standard cycle, single ListTagsForResource for overrides)
        // so the consumer needs no tag lookups.
        reAlarmDisabled: tagFacts.reAlarmDisabled,
        hasOverrideTag: tagFacts.hasOverrideTag,
      }),
      MessageGroupId: `realarm-producer-${messageHash(`${alarm.AlarmName}${alarm.AlarmArn}${alarm.AlarmActions}${isOverride}-${i}`)}`,
    }));

    try {
      metrics.totalCalls++;
      await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries,
        }),
      );
    } catch (error) {
      metrics.totalErrors++;
      if (isThrottlingError(error)) {
        metrics.throttlingErrors++;
      }

      log
        .error()
        .str('function', 'sendAlarmsToSQS')
        .num('batchIndex', batchIndex)
        .str('error', String(error))
        .msg('Failed to send batch to SQS');
      throw error;
    }
  };

  // Send batches with bounded concurrency. Throttling is handled by the SDK
  // retry strategy (backoff), so no adaptive inter-batch delay is needed -
  // just a small fixed pause between groups to avoid bursting the SQS API.
  const indexedBatches = batches.map((batch, index) => ({batch, index}));
  const batchGroups = chunk(indexedBatches, MAX_CONCURRENT_SQS_BATCHES);

  for (const [groupIndex, group] of batchGroups.entries()) {
    await Promise.all(group.map(({batch, index}) => sendBatch(batch, index)));

    if (groupIndex < batchGroups.length - 1) {
      await delay(DELAY_BETWEEN_BATCH_GROUPS);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any): Promise<void> => {
  // Extract the actual event data from the nested structure
  const eventData = event.event || event; // Fallback to the original event if not nested

  log
    .trace()
    .str('function', 'handler')
    .unknown('event', event)
    .str(
      'isOverrideAlarm',
      eventData['reAlarmOverride-AlarmName'] ? 'true' : 'false',
    )
    .str('overrideAlarmName', eventData['reAlarmOverride-AlarmName'] ?? '')
    .msg('Received event');

  if (!process.env.CONSUMER_QUEUE_URL) {
    throw new Error('CONSUMER_QUEUE_URL environment variable is required');
  }

  resetMetrics();
  let totalAlarms = 0;

  try {
    if (eventData['reAlarmOverride-AlarmName']) {
      // Handle override alarm case
      const overrideAlarms = await getOverriddenAlarm(
        eventData['reAlarmOverride-AlarmName'],
      );
      if (overrideAlarms.length > 0) {
        // Single-alarm path: resolve tag facts with one direct lookup. The
        // consumer enforces the same parity rule as before (a message is only
        // valid when hasOverrideTag matches isOverride), so an alarm whose
        // override tag was removed after its schedule rule fired is skipped.
        const alarm = overrideAlarms[0];
        const tagFacts = await fetchAlarmTagFacts(
          alarm.AlarmName ?? '',
          alarm.AlarmArn ?? '',
        );
        await sendAlarmsToSQS(
          overrideAlarms,
          process.env.CONSUMER_QUEUE_URL,
          true,
          tagFacts,
        );
      }
    } else {
      // Handle standard alarms case. Build the exclusion/override sets once
      // per run via the Tagging API (GetResources only returns tagged
      // resources); DescribeAlarms below remains the eligibility enumerator
      // so untagged alarms stay eligible.
      const tagSets = await fetchReAlarmTagSets();
      let skippedExcluded = 0;
      let skippedOverride = 0;

      const paginator = paginateDescribeAlarms(
        {client: cloudwatch, pageSize: PAGE_SIZE},
        {AlarmTypes: ['MetricAlarm']},
      );

      for await (const page of paginator) {
        if (!page.MetricAlarms?.length) {
          continue;
        }

        // Pre-filter: skip alarms explicitly opted out
        // (autoalarm:re-alarm-enabled=false) and alarms with a valid
        // re-alarm-minutes override (those are handled by their own
        // per-alarm schedule rules via the isOverride path).
        const eligibleAlarms = page.MetricAlarms.filter((alarm) => {
          const arn = alarm.AlarmArn ?? '';
          if (tagSets.excludedArns.has(arn)) {
            skippedExcluded++;
            return false;
          }
          if (tagSets.overrideByArn.has(arn)) {
            skippedOverride++;
            return false;
          }
          return true;
        });

        totalAlarms += eligibleAlarms.length;
        if (eligibleAlarms.length > 0) {
          await sendAlarmsToSQS(
            eligibleAlarms,
            process.env.CONSUMER_QUEUE_URL,
            false,
            // By construction every enqueued standard-cycle alarm is neither
            // opted out nor override-tagged.
            {reAlarmDisabled: false, hasOverrideTag: false},
          );
        }

        log
          .info()
          .str('function', 'handler')
          .num('processedAlarms', totalAlarms)
          .num('skippedExcluded', skippedExcluded)
          .num('skippedOverride', skippedOverride)
          .msg('Processed page of alarms');
      }
    }

    logMetricsSummary();
  } catch (error) {
    log
      .error()
      .str('function', 'handler')
      .str('error', String(error))
      .num('processedAlarms', totalAlarms)
      .msg('Failed to process alarms');
    throw error;
  }
};
