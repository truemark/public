import {
  CloudWatchClient,
  ComparisonOperator,
  DeleteAlarmsCommand,
  DeleteAnomalyDetectorCommand,
  DescribeAlarmsCommand,
  DescribeAlarmsCommandOutput,
  MetricAlarm,
  PutAnomalyDetectorCommand,
  PutAnomalyDetectorCommandInput,
  PutMetricAlarmCommand,
  PutMetricAlarmCommandInput,
  Statistic,
  MetricDataQuery,
  Tag as CloudWatchTag,
  TagResourceCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  GetResourcesCommand,
  GetResourcesCommandOutput,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';

import {
  MetricAlarmConfig,
  MetricAlarmOptions,
  AlarmClassification,
} from '../../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import * as logging from '@nr1e/logging';

const retryStrategy = new ConfiguredRetryStrategy(20);
const log = logging.getLogger('alarm-tools');
const region = process.env.AWS_REGION;
const cloudWatchClient = new CloudWatchClient({
  region,
  retryStrategy: retryStrategy,
});
const taggingClient = new ResourceGroupsTaggingAPIClient({
  region,
  retryStrategy: retryStrategy,
});

/**
 * Tag keys carrying an alarm's identity: the AutoAlarm service label and the
 * identifier of the resource the alarm monitors. These tags are the system's
 * primary key for alarm ownership — reconciliation looks alarms up by these
 * tags first and only falls back to name matching for alarms created before
 * identity tags existed (see {@link getAlarmsByIdentityTags}).
 */
export const ALARM_IDENTITY_SERVICE_TAG = 'autoalarm:service';
export const ALARM_IDENTITY_RESOURCE_ID_TAG = 'autoalarm:resource-id';

/**
 * Builds the identity tags stamped on every alarm AutoAlarm creates or
 * updates. The service and identifier are stored exactly as passed by the
 * service module so the tag-based lookup in {@link getAlarmsByIdentityTags}
 * (which uses the same values) always matches.
 */
export function buildAlarmIdentityTags(
  service: string,
  serviceIdentifier: string,
): CloudWatchTag[] {
  return [
    {Key: ALARM_IDENTITY_SERVICE_TAG, Value: service},
    {Key: ALARM_IDENTITY_RESOURCE_ID_TAG, Value: serviceIdentifier},
  ];
}

/**
 * Builds a CloudWatch alarm ARN from the Lambda's region (AWS_REGION) and the
 * account id provided to the main function via the ACCT_ID environment
 * variable (set by the CDK stack). Returns undefined when either is missing
 * so callers can skip ARN-based operations instead of building a bad ARN.
 */
export function buildAlarmArn(alarmName: string): string | undefined {
  // Read at call time (not module load) so the values are current and the
  // function is testable.
  const arnRegion = process.env.AWS_REGION;
  const accountId = process.env.ACCT_ID;
  if (!arnRegion || !accountId) {
    return undefined;
  }
  return `arn:aws:cloudwatch:${arnRegion}:${accountId}:alarm:${alarmName}`;
}

/**
 * Tags an alarm with its severity and identity tags via TagResource.
 *
 * PutMetricAlarm only applies its Tags parameter when the alarm is being
 * CREATED; tags passed on an update of an existing alarm are silently
 * ignored. Calling TagResource after every successful PutMetricAlarm covers
 * that update path (and is an idempotent no-op when PutMetricAlarm already
 * applied the tags at creation), so pre-existing alarms pick up identity
 * tags the first time they are reconciled.
 *
 * Failures are logged but not rethrown: the alarm itself was created or
 * updated successfully, and an untagged alarm is still found by the
 * name-based reconciliation fallback until the next reconcile retags it.
 */
async function applyAlarmIdentityTags(
  alarmName: string,
  service: string,
  serviceIdentifier: string,
  classification: AlarmClassification,
  reAlarmEnabled?: string,
): Promise<void> {
  const alarmArn = buildAlarmArn(alarmName);
  if (!alarmArn) {
    log
      .warn()
      .str('function', 'applyAlarmIdentityTags')
      .str('AlarmName', alarmName)
      .msg(
        'AWS_REGION or ACCT_ID is not set; cannot build alarm ARN. Skipping TagResource (identity tags will only be applied at alarm creation)',
      );
    return;
  }

  const tags: CloudWatchTag[] = [
    {Key: 'severity', Value: classification},
    ...buildAlarmIdentityTags(service, serviceIdentifier),
  ];
  if (reAlarmEnabled !== undefined) {
    tags.push({Key: 'autoalarm:re-alarm-enabled', Value: reAlarmEnabled});
  }

  try {
    await cloudWatchClient.send(
      new TagResourceCommand({
        ResourceARN: alarmArn,
        Tags: tags,
      }),
    );
    log
      .debug()
      .str('function', 'applyAlarmIdentityTags')
      .str('AlarmName', alarmName)
      .str('Service', service)
      .str('Identifier', serviceIdentifier)
      .msg('Applied identity tags to alarm');
  } catch (e) {
    log
      .error()
      .str('function', 'applyAlarmIdentityTags')
      .str('AlarmName', alarmName)
      .str('AlarmArn', alarmArn)
      .err(e)
      .msg(
        'Failed to tag alarm with identity tags. The alarm remains discoverable via the name-based fallback and will be retagged on the next reconcile',
      );
  }
}

/**
 * Looks up the alarms owned by a resource via the Resource Groups Tagging
 * API, using the identity tags stamped on every alarm at creation/update.
 * This is the authoritative ownership lookup; alarm names are not parsed.
 *
 * Returns alarm names extracted from the returned alarm ARNs
 * (arn:aws:cloudwatch:region:account:alarm:NAME).
 *
 * Errors are logged and an empty array is returned so reconciliation
 * gracefully degrades to the name-based lookup (the exact behavior before
 * identity tags existed) instead of failing the record. The union with the
 * name-based lookup also covers the Tagging API's eventual consistency lag
 * (newly tagged alarms can take minutes to appear in GetResources).
 */
export async function getAlarmsByIdentityTags(
  service: string,
  serviceIdentifier: string,
): Promise<string[]> {
  if (!serviceIdentifier) {
    log
      .error()
      .str('function', 'getAlarmsByIdentityTags')
      .str('serviceName', service)
      .msg('Service identifier is empty. Refusing to fetch alarms by tags');
    throw new Error(
      `getAlarmsByIdentityTags called with empty identifier for service ${service}`,
    );
  }

  const alarmNames: string[] = [];
  let paginationToken: string | undefined = undefined;

  try {
    do {
      const response: GetResourcesCommandOutput = await taggingClient.send(
        new GetResourcesCommand({
          ResourceTypeFilters: ['cloudwatch:alarm'],
          TagFilters: [
            {Key: ALARM_IDENTITY_SERVICE_TAG, Values: [service]},
            {Key: ALARM_IDENTITY_RESOURCE_ID_TAG, Values: [serviceIdentifier]},
          ],
          PaginationToken: paginationToken,
        }),
      );

      for (const resource of response.ResourceTagMappingList ?? []) {
        const arn = resource.ResourceARN;
        if (!arn) {
          continue;
        }
        const marker = ':alarm:';
        const markerIndex = arn.indexOf(marker);
        if (markerIndex === -1) {
          continue;
        }
        alarmNames.push(arn.substring(markerIndex + marker.length));
      }

      // GetResources signals "no more pages" with an empty string.
      paginationToken = response.PaginationToken || undefined;
    } while (paginationToken);

    log
      .info()
      .str('function', 'getAlarmsByIdentityTags')
      .str('Service', service)
      .str('Identifier', serviceIdentifier)
      .obj('alarms', alarmNames)
      .msg('Fetched alarms by identity tags');
    return alarmNames;
  } catch (error) {
    log
      .error()
      .str('function', 'getAlarmsByIdentityTags')
      .str('Service', service)
      .str('Identifier', serviceIdentifier)
      .err(error)
      .msg(
        'Failed to fetch alarms by identity tags. Falling back to name-based lookup only',
      );
    return [];
  }
}

export async function doesAlarmExist(alarmName: string): Promise<boolean> {
  //initialize response variable
  let response: DescribeAlarmsCommandOutput;
  try {
    response = await cloudWatchClient.send(
      new DescribeAlarmsCommand({AlarmNames: [alarmName]}),
    );
    log
      .info()
      .str('function', 'doesAlarmExist')
      .str('alarmName', alarmName)
      .str('response', JSON.stringify(response))
      .msg('Checking if alarm exists');
  } catch (error) {
    log
      .error()
      .str('function', 'doesAlarmExist')
      .str('alarmName', alarmName)
      .str('error', String(error))
      .msg('Failed to check if alarm exists');
    throw error;
  }
  return (response.MetricAlarms?.length ?? 0) > 0;
}

// The DeleteAlarms API accepts at most 100 alarm names per call.
const DELETE_ALARMS_MAX_BATCH_SIZE = 100;

/**
 * Splits an array of alarm names into chunks no larger than the DeleteAlarms
 * API limit (100 names per call).
 */
export function chunkAlarmNames(alarmNames: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < alarmNames.length; i += DELETE_ALARMS_MAX_BATCH_SIZE) {
    chunks.push(alarmNames.slice(i, i + DELETE_ALARMS_MAX_BATCH_SIZE));
  }
  return chunks;
}

/**
 * Builds the exact set of alarm names AutoAlarm could have created for a
 * resource, based on the service's alarm configs. Reuses {@link buildAlarmName}
 * so the formats stay identical to alarm creation. Used to ensure deletion
 * only ever targets this resource's own alarms and never alarms belonging to
 * another resource whose identifier shares a prefix (e.g., 'orders' vs
 * 'orders-dlq').
 *
 * Note: EC2 is intentionally not reconciled via this helper. EC2 storage
 * alarms embed dynamic storage paths and platform-resolved metric names, so
 * the EC2 module keeps prefix-based reconciliation (instance ids are
 * fixed-format and cannot prefix-collide).
 */
export function buildExpectedAlarmNames(
  service: string,
  identifier: string,
  configs: MetricAlarmConfig[],
): Set<string> {
  const expectedAlarmNames = new Set<string>();
  for (const config of configs) {
    const alarmVariant = config.tagKey.includes('anomaly')
      ? 'anomaly'
      : 'static';
    for (const classification of Object.values(AlarmClassification)) {
      expectedAlarmNames.add(
        buildAlarmName(
          config,
          service,
          identifier,
          classification,
          alarmVariant,
        ),
      );
    }
  }
  return expectedAlarmNames;
}

export async function deleteExistingAlarms(
  service: string,
  identifier: string,
  configs: MetricAlarmConfig[],
) {
  if (!identifier) {
    log
      .error()
      .str('function', 'deleteExistingAlarms')
      .str('Service', service)
      .msg('Identifier is empty. Refusing to delete alarms by service prefix');
    throw new Error(
      `deleteExistingAlarms called with empty identifier for service ${service}`,
    );
  }

  log
    .info()
    .str('function', 'deleteExistingAlarms')
    .str('Service', service)
    .str('Identifier', identifier)
    .msg('Fetching and deleting existing alarms');
  const expectedAlarmNames = buildExpectedAlarmNames(
    service,
    identifier,
    configs,
  );
  // Identity-first lookup: alarms tagged with this resource's identity tags
  // are authoritatively ours and are deleted regardless of their name.
  // UNION with the name-based lookup, restricted to alarms whose names
  // exactly match the names AutoAlarm could have created for this resource
  // (so the AlarmNamePrefix fetch can never delete alarms belonging to
  // another resource whose identifier shares a prefix with this one). The
  // name-based fallback covers alarms created before identity tags existed
  // and the Tagging API's eventual-consistency lag.
  const [taggedAlarms, prefixFetchedAlarms] = await Promise.all([
    getAlarmsByIdentityTags(service, identifier),
    getCWAlarmsForInstance(service, identifier),
  ]);
  const activeAutoAlarms = [
    ...new Set([
      ...taggedAlarms,
      ...prefixFetchedAlarms.filter((alarmName) =>
        expectedAlarmNames.has(alarmName),
      ),
    ]),
  ];

  log
    .info()
    .str('function', 'deleteExistingAlarms')
    .obj('AlarmName', activeAutoAlarms)
    .msg('Deleting alarm');
  await massDeleteAlarms(activeAutoAlarms);
}

async function deleteAlarmsForConfig(
  config: MetricAlarmConfig,
  service: string,
  serviceIdentifier: string,
  dimensions: {Name: string; Value: string}[],
  statistic: string | undefined,
) {
  // Only delete the alarm variant this config represents. Deleting both
  // variants here would let a no-threshold anomaly config delete the sibling
  // static alarms managed by a different config (and vice versa).
  const alarmVariant = config.tagKey.includes('anomaly') ? 'anomaly' : 'static';
  for (const classification of Object.values(AlarmClassification)) {
    const alarmName = buildAlarmName(
      config,
      service,
      serviceIdentifier,
      classification,
      alarmVariant,
    );
    await deleteAlarm(alarmName);
  }

  // Anomaly alarms are backed by an anomaly detector model created via
  // PutAnomalyDetector. Delete it as well so orphaned models do not
  // accumulate toward the regional anomaly detector quota.
  if (alarmVariant === 'anomaly') {
    await deleteAnomalyDetector(config, dimensions, statistic);
  }
}

async function deleteAnomalyDetector(
  config: MetricAlarmConfig,
  dimensions: {Name: string; Value: string}[],
  statistic: string | undefined,
) {
  try {
    await cloudWatchClient.send(
      new DeleteAnomalyDetectorCommand({
        Namespace: config.metricNamespace,
        MetricName: config.metricName,
        Dimensions: [...dimensions],
        Stat: statistic,
      }),
    );
    log
      .info()
      .str('function', 'deleteAnomalyDetector')
      .str('Namespace', config.metricNamespace)
      .str('MetricName', config.metricName)
      .msg('Successfully deleted anomaly detector');
  } catch (e) {
    if (e instanceof Error && e.name === 'ResourceNotFoundException') {
      log
        .debug()
        .str('function', 'deleteAnomalyDetector')
        .str('Namespace', config.metricNamespace)
        .str('MetricName', config.metricName)
        .msg('Anomaly detector does not exist. Nothing to delete');
      return;
    }
    log
      .error()
      .str('function', 'deleteAnomalyDetector')
      .str('Namespace', config.metricNamespace)
      .str('MetricName', config.metricName)
      .err(e)
      .msg('Error deleting anomaly detector');
    throw e;
  }
}

export async function deleteAlarm(alarmName: string) {
  log
    .info()
    .str('function', 'deleteAlarm')
    .str('AlarmName', alarmName)
    .msg('Attempting to delete alarm');
  try {
    await cloudWatchClient.send(
      new DeleteAlarmsCommand({AlarmNames: [alarmName]}),
    );
    log
      .info()
      .str('function', 'deleteAlarm')
      .str('AlarmName', alarmName)
      .msg('Successfully deleted alarm');
  } catch (e) {
    log
      .error()
      .str('function', 'deleteAlarm')
      .str('AlarmName', alarmName)
      .err(e)
      .msg('Error deleting alarm');
  }
}

export async function massDeleteAlarms(alarmNames: string[]) {
  if (alarmNames.length === 0) {
    log
      .info()
      .str('function', 'massDeleteAlarms')
      .msg('No alarms to delete. Skipping DeleteAlarms call');
    return;
  }
  log
    .info()
    .str('function', 'massDeleteAlarms')
    .str('AlarmNames', JSON.stringify(alarmNames))
    .msg('Attempting to delete alarms');
  try {
    // DeleteAlarms accepts at most 100 alarm names per call, so delete in chunks.
    for (const alarmNamesChunk of chunkAlarmNames(alarmNames)) {
      await cloudWatchClient.send(
        new DeleteAlarmsCommand({AlarmNames: alarmNamesChunk}),
      );
    }
    log
      .info()
      .str('function', 'massDeleteAlarms')
      .str('AlarmNames', JSON.stringify(alarmNames))
      .msg('Successfully deleted alarms');
  } catch (e) {
    log
      .error()
      .str('function', 'massDeleteAlarms')
      .str('AlarmNames', JSON.stringify(alarmNames))
      .err(e)
      .msg('Error deleting alarms');
    // Rethrow so callers can fail the record instead of silently dropping the
    // deletion and acknowledging the event.
    throw e;
  }
}

export function buildAlarmName(
  config: MetricAlarmConfig,
  service: string,
  serviceIdentifier: string,
  classification: AlarmClassification,
  alarmVariant: 'anomaly' | 'static',
  storagePath?: string,
) {
  if (storagePath) {
    const alarmName =
      alarmVariant === 'anomaly'
        ? `AutoAlarm-${service.toUpperCase()}-${serviceIdentifier}-${config.metricName}-${storagePath}-anomaly-${classification}`
        : `AutoAlarm-${service.toUpperCase()}-${serviceIdentifier}-${config.metricName}-${storagePath}-${classification}`;
    log
      .info()
      .str('function', 'buildAlarmName')
      .str('AlarmName', alarmName)
      .msg('Built alarm name name');
    return alarmName;
  } else {
    const alarmName =
      alarmVariant === 'anomaly'
        ? `AutoAlarm-${service.toUpperCase()}-${serviceIdentifier}-${config.metricName}-anomaly-${classification}`
        : `AutoAlarm-${service.toUpperCase()}-${serviceIdentifier}-${config.metricName}-${classification}`;
    log
      .info()
      .str('function', 'buildAlarmName')
      .str('AlarmName', alarmName)
      .msg('Built alarm name name');
    return alarmName;
  }
}

// used as input validation to ensure that the period value is always a valid number for the cloudwatch api
// Valid CloudWatch periods are 10, 30, and any multiple of 60.
function validatePeriod(period: number) {
  if (period === 10 || period === 30 || (period >= 60 && period % 60 === 0)) {
    log
      .info()
      .str('function', 'validatePeriod')
      .str('period', period.toString())
      .msg('Period is valid');
    return period;
  } else if (period < 10) {
    log
      .info()
      .str('function', 'validatePeriod')
      .str('period', period.toString())
      .msg('Period is less than 10, setting to 10');
    return 10;
  } else if (period < 30) {
    log
      .info()
      .str('function', 'validatePeriod')
      .str('period', period.toString())
      .msg('Period is between 11 and 29, setting to 30');
    return 30;
  } else {
    log
      .info()
      .str('function', 'validatePeriod')
      .str('period', period.toString())
      .msg(
        'Period is greater than 30 and not a multiple of 60, rounding up to the next multiple of 60',
      );
    return Math.ceil(period / 60) * 60;
  }
}

/**
 * Comparison operators that are only valid for anomaly detection alarms.
 * Static threshold alarms must NOT use these, and anomaly alarms must ONLY use these.
 */
const ANOMALY_COMPARISON_OPERATORS: ComparisonOperator[] = [
  ComparisonOperator.GreaterThanUpperThreshold,
  ComparisonOperator.LessThanLowerThreshold,
  ComparisonOperator.LessThanLowerOrGreaterThanUpperThreshold,
];

/**
 * Ensures the comparison operator matches the alarm variant (anomaly vs static).
 * Tag parsing accepts any valid ComparisonOperator, so a mismatched operator
 * (e.g. a static operator on an anomaly alarm) would make PutMetricAlarm reject
 * the request and send the record to the DLQ. If a mismatch is detected, log a
 * warning and fall back to the config's default operator.
 */
function validateComparisonOperator(
  config: MetricAlarmConfig,
  updatedDefaults: MetricAlarmOptions,
  variant: 'anomaly' | 'static',
): void {
  const isAnomalyOperator = ANOMALY_COMPARISON_OPERATORS.includes(
    updatedDefaults.comparisonOperator,
  );

  if (
    (variant === 'anomaly' && !isAnomalyOperator) ||
    (variant === 'static' && isAnomalyOperator)
  ) {
    log
      .warn()
      .str('function', 'validateComparisonOperator')
      .str('tagKey', config.tagKey)
      .str('variant', variant)
      .str('comparisonOperator', updatedDefaults.comparisonOperator)
      .str('defaultComparisonOperator', config.defaults.comparisonOperator)
      .msg(
        'Comparison operator is not valid for this alarm variant. Falling back to the config default operator.',
      );
    updatedDefaults.comparisonOperator = config.defaults.comparisonOperator;
  }
}

async function handleAnomalyDetectionWorkflow(
  alarmName: string,
  updatedDefaults: MetricAlarmOptions,
  config: MetricAlarmConfig,
  dimensions: {Name: string; Value: string}[],
  classification: AlarmClassification,
  threshold: number,
  service: string,
  serviceIdentifier: string,
  reAlarmEnabled?: string,
) {
  log
    .info()
    .str('function', 'handleAnomalyDetectionWorkflow')
    .str('AlarmName', alarmName)
    .msg('Handling anomaly detection alarm workflow');

  try {
    const anomalyDetectorInput: PutAnomalyDetectorCommandInput = {
      Namespace: config.metricNamespace,
      MetricName: config.metricName,
      Dimensions: [...dimensions],
      Stat: updatedDefaults.statistic,
      Configuration: {MetricTimezone: 'UTC'},
    };

    const response = await cloudWatchClient.send(
      new PutAnomalyDetectorCommand(anomalyDetectorInput),
    );
    log
      .info()
      .str('function', 'handleAnomalyDetectionWorkflow')
      .str('AlarmName', alarmName)
      .obj('response', response)
      .msg('Successfully created or updated anomaly detector');

    const metrics: MetricDataQuery[] = [
      {
        Id: 'primaryMetric',
        MetricStat: {
          Metric: {
            Namespace: config.metricNamespace,
            MetricName: config.metricName,
            Dimensions: [...dimensions],
          },
          Period: updatedDefaults.period,
          Stat: updatedDefaults.statistic,
        },
      },
      {
        Id: 'anomalyDetectionBand',
        Expression: `ANOMALY_DETECTION_BAND(primaryMetric, ${threshold})`,
      },
    ];

    const alarmInput: PutMetricAlarmCommandInput = {
      AlarmName: alarmName,
      ComparisonOperator: updatedDefaults.comparisonOperator,
      EvaluationPeriods: updatedDefaults.evaluationPeriods,
      DatapointsToAlarm: updatedDefaults.dataPointsToAlarm,
      Metrics: metrics,
      ThresholdMetricId: 'anomalyDetectionBand',
      ActionsEnabled: false,
      // Tags are only applied when the alarm is CREATED; updates of existing
      // alarms ignore them, hence the TagResource call below.
      Tags: [
        {Key: 'severity', Value: classification},
        ...buildAlarmIdentityTags(service, serviceIdentifier),
      ],
      TreatMissingData: updatedDefaults.missingDataTreatment,
    };

    log
      .info()
      .str('function', 'handleAnomalyDetectionWorkflow')
      .obj('AlarmInput', alarmInput)
      .msg('Sending PutMetricAlarmCommand');

    const alarmResponse = await cloudWatchClient.send(
      new PutMetricAlarmCommand(alarmInput),
    );
    log
      .info()
      .str('function', 'handleAnomalyDetectionWorkflow')
      .str('AlarmName', alarmName)
      .obj('response', alarmResponse)
      .msg('Successfully created or updated anomaly detection alarm');

    await applyAlarmIdentityTags(
      alarmName,
      service,
      serviceIdentifier,
      classification,
      reAlarmEnabled,
    );
  } catch (e) {
    log
      .error()
      .str('function', 'handleAnomalyDetectionWorkflow')
      .str('AlarmName', alarmName)
      .err(e)
      .msg('Error creating or updating anomaly detection alarm');
    // Rethrow the error so it can be caught by the caller
    throw e;
  }
}

/**
 * Shared implementation behind {@link handleAnomalyAlarms} and
 * {@link handleStaticAlarms}. Creates/updates the warning and critical alarms
 * for a config when their thresholds are set, deletes them when not, and
 * deletes everything for the config when no thresholds are defined at all.
 *
 * @returns The names of the alarms created or updated.
 */
async function handleAlarmsForVariant(
  variant: 'anomaly' | 'static',
  config: MetricAlarmConfig,
  service: string,
  serviceIdentifier: string,
  dimensions: {Name: string; Value: string}[],
  updatedDefaults: MetricAlarmOptions,
  storagePath?: string,
  reAlarmEnabled?: string,
): Promise<string[]> {
  const functionName =
    variant === 'anomaly' ? 'handleAnomalyAlarms' : 'handleStaticAlarms';
  const createdAlarms: string[] = [];

  // Validate if thresholds are set correctly
  const warningThresholdSet =
    updatedDefaults.warningThreshold !== undefined &&
    updatedDefaults.warningThreshold !== null;
  const criticalThresholdSet =
    updatedDefaults.criticalThreshold !== undefined &&
    updatedDefaults.criticalThreshold !== null;

  // If no thresholds are set, log and exit early
  if (!warningThresholdSet && !criticalThresholdSet && !config.defaultCreate) {
    const alarmPrefix =
      variant === 'anomaly'
        ? `AutoAlarm-${service}-${serviceIdentifier}-${config.metricName}-anomaly-`
        : `AutoAlarm-${service}-${serviceIdentifier}-${config.metricName}`;
    log
      .info()
      .str('function', functionName)
      .str('Service Identifier', serviceIdentifier)
      .str('alarm prefix: ', alarmPrefix)
      .msg(
        'No thresholds defined, skipping alarm creation and deleting alarms for config if they exist.',
      );
    await deleteAlarmsForConfig(
      config,
      service,
      serviceIdentifier,
      dimensions,
      updatedDefaults.statistic,
    );
    return createdAlarms;
  }

  updatedDefaults.period = validatePeriod(updatedDefaults.period);
  validateComparisonOperator(config, updatedDefaults, variant);

  const workflow =
    variant === 'anomaly'
      ? handleAnomalyDetectionWorkflow
      : handleStaticThresholdWorkflow;

  const classifications: {
    classification: AlarmClassification;
    thresholdSet: boolean;
    threshold: number | null;
  }[] = [
    {
      classification: AlarmClassification.Warning,
      thresholdSet: warningThresholdSet,
      threshold: updatedDefaults.warningThreshold,
    },
    {
      classification: AlarmClassification.Critical,
      thresholdSet: criticalThresholdSet,
      threshold: updatedDefaults.criticalThreshold,
    },
  ];

  for (const {classification, thresholdSet, threshold} of classifications) {
    const alarmName = buildAlarmName(
      config,
      service,
      serviceIdentifier,
      classification,
      variant,
      storagePath,
    );
    if (thresholdSet) {
      log
        .info()
        .str('function', functionName)
        .str('AlarmName', alarmName)
        .msg(
          `Creating or updating ${classification.toLowerCase()} ${variant} alarms`,
        );
      await workflow(
        alarmName,
        updatedDefaults,
        config,
        dimensions,
        classification,
        threshold as number,
        service,
        serviceIdentifier,
        reAlarmEnabled,
      );
      createdAlarms.push(alarmName);
    } else {
      log
        .info()
        .str('function', functionName)
        .str('AlarmName', alarmName)
        .msg(
          `Deleting existing ${classification.toLowerCase()} ${variant} alarm due to no threshold.`,
        );
      await deleteAlarm(alarmName);
    }
  }

  return createdAlarms;
}

//TODO: Confirm that we do not need to differentiate between Standard Statistics and Extended Statistics
export async function handleAnomalyAlarms(
  config: MetricAlarmConfig,
  service: string,
  serviceIdentifier: string,
  dimensions: {Name: string; Value: string}[],
  updatedDefaults: MetricAlarmOptions,
  storagePath?: string,
  reAlarmEnabled?: string,
): Promise<string[]> {
  return handleAlarmsForVariant(
    'anomaly',
    config,
    service,
    serviceIdentifier,
    dimensions,
    updatedDefaults,
    storagePath,
    reAlarmEnabled,
  );
}

async function handleStaticThresholdWorkflow(
  alarmName: string,
  updatedDefaults: MetricAlarmOptions,
  config: MetricAlarmConfig,
  dimensions: {Name: string; Value: string}[],
  classification: AlarmClassification,
  threshold: number,
  service: string,
  serviceIdentifier: string,
  reAlarmEnabled?: string,
) {
  log
    .info()
    .str('function', 'handleStaticThresholdWorkflow')
    .str('AlarmName', alarmName)
    .msg('Handling static threshold alarm workflow');

  try {
    const alarmInput: PutMetricAlarmCommandInput = {
      AlarmName: alarmName,
      ComparisonOperator: updatedDefaults.comparisonOperator,
      EvaluationPeriods: updatedDefaults.evaluationPeriods,
      DatapointsToAlarm: updatedDefaults.dataPointsToAlarm,
      MetricName: config.metricName,
      Namespace: config.metricNamespace,
      Period: updatedDefaults.period,
      ...([
        'p',
        'tm',
        'tc',
        'ts',
        'wm',
        'IQM',
        'WM',
        'PR',
        'TC',
        'TM',
        'TS',
      ].some((prefix) => updatedDefaults.statistic!.startsWith(prefix))
        ? {ExtendedStatistic: updatedDefaults.statistic}
        : {Statistic: updatedDefaults.statistic as Statistic}),
      Threshold: threshold,
      ActionsEnabled: false,
      Dimensions: [...dimensions],
      // Tags are only applied when the alarm is CREATED; updates of existing
      // alarms ignore them, hence the TagResource call below.
      Tags: [
        {Key: 'severity', Value: classification},
        ...buildAlarmIdentityTags(service, serviceIdentifier),
      ],
      TreatMissingData: updatedDefaults.missingDataTreatment,
    };

    const response = await cloudWatchClient.send(
      new PutMetricAlarmCommand(alarmInput),
    );
    log
      .info()
      .str('function', 'handleStaticThresholdWorkflow')
      .str('AlarmName', alarmName)
      .obj('response', response)
      .msg('Successfully created or updated static threshold alarm');

    await applyAlarmIdentityTags(
      alarmName,
      service,
      serviceIdentifier,
      classification,
      reAlarmEnabled,
    );
  } catch (e) {
    log
      .error()
      .str('function', 'handleStaticThresholdWorkflow')
      .str('AlarmName', alarmName)
      .err(e)
      .msg('Error creating or updating static threshold alarm');
    // Rethrow the error so it can be caught by the caller
    throw e;
  }
}

export async function handleStaticAlarms(
  config: MetricAlarmConfig,
  service: string,
  serviceIdentifier: string,
  dimensions: {Name: string; Value: string}[],
  updatedDefaults: MetricAlarmOptions,
  storagePath?: string,
  reAlarmEnabled?: string,
): Promise<string[]> {
  return handleAlarmsForVariant(
    'static',
    config,
    service,
    serviceIdentifier,
    dimensions,
    updatedDefaults,
    storagePath,
    reAlarmEnabled,
  );
}

/**
 * Retrieves all active CloudWatch auto alarms for a given instance and returns them as an array.
 * This array is typically used when the deleteCWAlarm function is called from within service module files.
 *
 * @param {string} serviceName - Service name (e.g., ec2, ecs, eks, rds)
 * @param {string} serviceIdentifier - Instance identifier used by CloudWatch to pull alarm information
 * @returns {Promise<string[]>} Array of alarm names to be used for deletion
 * @throws {Error} If fetching alarms fails
 *
 * @example Instance Identifier Formats:
 * - EC2: instanceID
 * - ECS: [TBD]
 * - EKS: [TBD]
 * - RDS: [TBD]
 */
export async function getCWAlarmsForInstance(
  serviceName: string,
  serviceIdentifier: string,
): Promise<string[]> {
  if (!serviceIdentifier) {
    log
      .error()
      .str('function', 'getCWAlarmsForInstance')
      .str('serviceName', serviceName)
      .msg(
        'Service identifier is empty. Refusing to fetch alarms by service-wide prefix',
      );
    throw new Error(
      `getCWAlarmsForInstance called with empty identifier for service ${serviceName}`,
    );
  }
  let nextToken: string | undefined = undefined;
  const activeAutoAlarms: MetricAlarm[] = [];
  let hasMorePages = true;

  try {
    log
      .info()
      .str('function', 'getCWAlarmsForInstance')
      .str('serviceName', serviceName)
      .str('serviceIdentifier', serviceIdentifier)
      .msg('Fetching alarms for instance');

    // Keep fetching until no more pages
    while (hasMorePages) {
      const describeAlarmsCommand: DescribeAlarmsCommand =
        new DescribeAlarmsCommand({
          AlarmNamePrefix: `AutoAlarm-${serviceName.toUpperCase()}-${serviceIdentifier}`,
          NextToken: nextToken,
          MaxRecords: 100,
        });

      const describeAlarmsResponse = await cloudWatchClient.send(
        describeAlarmsCommand,
      );

      // Accumulate alarms from this page
      if (describeAlarmsResponse.MetricAlarms) {
        activeAutoAlarms.push(...describeAlarmsResponse.MetricAlarms);
      }

      // Check if there are more pages
      if (!describeAlarmsResponse.NextToken) {
        hasMorePages = false;
      }
      nextToken = describeAlarmsResponse.NextToken;
    }

    const alarms = activeAutoAlarms.map((alarm) => alarm.AlarmName || '');
    log
      .info()
      .str('function', 'getCWAlarmsForInstance')
      .str(`${serviceName}`, serviceIdentifier)
      .obj('alarms', alarms)
      .msg('Fetched alarms for instance');
    return alarms;
  } catch (error) {
    log
      .error()
      .str('function', 'getCWAlarmsForInstance')
      .err(error)
      .str(`${serviceName}`, serviceIdentifier)
      .msg('Failed to fetch alarms for instance');
    throw new Error(`Failed to fetch alarms for instance: ${error as string}`);
  }
}
