/**
 * Shared helpers for the per-service modules.
 *
 * These consolidate the checkAndManage<Service>StatusAlarms,
 * fetch<Service>Tags, and findArn-in-stringified-event logic that used to be
 * copy-pasted across the service modules. EC2 keeps its bespoke alarm
 * management (storage-path/platform-specific alarms and Prometheus rules) and
 * is intentionally not routed through {@link manageServiceAlarms}.
 */
import * as logging from '@nr1e/logging';
import {MetricAlarmConfig, Tag} from '../../types/index.mjs';
import {Dimension} from '../../types/module-types.mjs';
import {
  buildExpectedAlarmNames,
  deleteExistingAlarms,
  getAlarmsByIdentityTags,
  getCWAlarmsForInstance,
  handleAnomalyAlarms,
  handleStaticAlarms,
  massDeleteAlarms,
} from './alarm-tools.mjs';
import {parseMetricAlarmOptions} from './alarm-config.mjs';

const log = logging.getLogger('service-helpers');

/**
 * Returns the subset of a resource's existing alarms that should be deleted:
 * alarms that exactly match one of the names AutoAlarm could have created for
 * this resource (so we never touch alarms of another resource whose
 * identifier shares a prefix) and that are not in the keep set.
 *
 * Pure function so the reconcile diffing is unit-testable without a
 * CloudWatch client.
 */
export function filterAlarmsToDelete(
  existingAlarms: string[],
  expectedAlarmNames: Set<string>,
  alarmsToKeep: Set<string>,
): string[] {
  return existingAlarms
    .filter((alarm) => expectedAlarmNames.has(alarm))
    .filter((alarm) => !alarmsToKeep.has(alarm));
}

/**
 * Computes the alarms to delete during reconciliation from the two ownership
 * lookups:
 *
 * - identityTaggedAlarms: alarms carrying this resource's
 *   autoalarm:service/autoalarm:resource-id identity tags (Resource Groups
 *   Tagging API). These are authoritatively ours and are deleted when not
 *   kept, regardless of their name.
 * - prefixFetchedAlarms: alarms found via the AlarmNamePrefix fetch. These
 *   are only trusted when their names exactly match a name AutoAlarm could
 *   have created for this resource (expectedAlarmNames), so a resource whose
 *   identifier is a prefix of another's can never delete its sibling's
 *   alarms.
 *
 * The union exists for migration and consistency reasons: alarms created
 * before identity tags existed are only found by name, and the Tagging API
 * is eventually consistent (newly tagged alarms can lag GetResources by
 * minutes). After one full reconcile cycle every touched alarm carries
 * identity tags, at which point the name-based fallback can be retired.
 *
 * Pure function so the reconcile diffing is unit-testable without CloudWatch
 * or Tagging API clients.
 */
export function buildAlarmsToDelete(
  identityTaggedAlarms: string[],
  prefixFetchedAlarms: string[],
  expectedAlarmNames: Set<string>,
  alarmsToKeep: Set<string>,
): string[] {
  const alarmsToDelete = new Set<string>(
    identityTaggedAlarms.filter((alarm) => !alarmsToKeep.has(alarm)),
  );
  for (const alarm of filterAlarmsToDelete(
    prefixFetchedAlarms,
    expectedAlarmNames,
    alarmsToKeep,
  )) {
    alarmsToDelete.add(alarm);
  }
  return [...alarmsToDelete];
}

export interface ManageServiceAlarmsOptions {
  /**
   * Service name used in alarm names and the AlarmNamePrefix fetch
   * (e.g. 'SQS', 'ALB', 'RDSCluster').
   */
  service: string;
  /**
   * Resource identifier embedded in alarm names (queue name, ARN,
   * instance id, ...).
   */
  identifier: string;
  /** Tags currently on the resource. */
  tags: Tag;
  /** The service's alarm configs. */
  configs: MetricAlarmConfig[];
  /** CloudWatch dimensions applied to every alarm for this resource. */
  dimensions: Dimension[];
  /**
   * When false, skips the autoalarm:enabled gate. For modules whose entry
   * point performs its own enabled/disabled handling before calling this
   * (e.g. ECS and log groups, which gate on the tag in their event parsers).
   * Defaults to true.
   */
  checkEnabled?: boolean;
}

/**
 * Generic alarm reconciliation for a tagged resource. Implements the shape
 * every non-EC2 service module shared:
 *
 * 1. If alarms are not enabled (autoalarm:enabled !== 'true'), delete all of
 *    this resource's AutoAlarm alarms and return.
 * 2. For each config with a default-create flag or a tag override, dispatch
 *    to the anomaly or static alarm handler and collect the created alarm
 *    names.
 * 3. Fetch the resource's existing AutoAlarm alarms, restrict them to the
 *    exact expected names for this resource, and delete any that were not
 *    just created/kept.
 */
export async function manageServiceAlarms(
  options: ManageServiceAlarmsOptions,
): Promise<void> {
  const {service, identifier, tags, configs, dimensions} = options;

  log
    .info()
    .str('function', 'manageServiceAlarms')
    .str('Service', service)
    .str('Identifier', identifier)
    .msg('Starting alarm management process');

  if (options.checkEnabled ?? true) {
    const isAlarmEnabled = tags['autoalarm:enabled'] === 'true';
    if (!isAlarmEnabled) {
      log
        .info()
        .str('function', 'manageServiceAlarms')
        .str('Service', service)
        .str('Identifier', identifier)
        .msg('Alarm creation disabled by tag settings');
      await deleteExistingAlarms(service, identifier, configs);
      return;
    }
  }

  const alarmsToKeep = new Set<string>();

  for (const config of configs) {
    log
      .info()
      .str('function', 'manageServiceAlarms')
      .obj('config', config)
      .str('Service', service)
      .str('Identifier', identifier)
      .msg('Processing metric configuration');

    const tagValue = tags[`autoalarm:${config.tagKey}`];
    const updatedDefaults = parseMetricAlarmOptions(
      tagValue || '',
      config.defaults,
    );

    if (config.defaultCreate || tagValue !== undefined) {
      const isAnomaly = config.tagKey.includes('anomaly');
      log
        .info()
        .str('function', 'manageServiceAlarms')
        .str('Service', service)
        .str('Identifier', identifier)
        .msg(
          isAnomaly
            ? 'Tag key indicates anomaly alarm. Handling anomaly alarms'
            : 'Tag key indicates static alarm. Handling static alarms',
        );
      const alarmHandler = isAnomaly ? handleAnomalyAlarms : handleStaticAlarms;
      const alarmNames = await alarmHandler(
        config,
        service,
        identifier,
        dimensions,
        updatedDefaults,
        undefined,
        tags['autoalarm:re-alarm-enabled'],
      );
      alarmNames.forEach((alarmName) => alarmsToKeep.add(alarmName));
    } else {
      log
        .info()
        .str('function', 'manageServiceAlarms')
        .str('Service', service)
        .str('Identifier', identifier)
        .str('tagKey', config.tagKey)
        .msg(
          'No default or overridden alarm values. Marking alarms for deletion.',
        );
    }
  }

  // Delete alarms that are not in the alarmsToKeep set. Ownership is
  // resolved identity-first: the primary lookup asks the Resource Groups
  // Tagging API for alarms carrying this resource's identity tags
  // (autoalarm:service + autoalarm:resource-id), which every alarm receives
  // at creation/update. That set is UNIONed with the legacy name-based
  // lookup (AlarmNamePrefix fetch restricted to this resource's exact
  // expected alarm names, so we never delete alarms of another resource
  // whose identifier shares a prefix, e.g. 'orders' vs 'orders-dlq').
  //
  // Migration story: the name-based fallback covers (a) alarms created
  // before identity tags existed and (b) the Tagging API's
  // eventual-consistency lag (newly tagged alarms can take minutes to show
  // up in GetResources). After one full reconcile cycle every touched alarm
  // carries identity tags, so the fallback can be retired later.
  const expectedAlarmNames = buildExpectedAlarmNames(
    service,
    identifier,
    configs,
  );
  const [identityTaggedAlarms, prefixFetchedAlarms] = await Promise.all([
    getAlarmsByIdentityTags(service, identifier),
    getCWAlarmsForInstance(service, identifier),
  ]);
  const alarmsToDelete = buildAlarmsToDelete(
    identityTaggedAlarms,
    prefixFetchedAlarms,
    expectedAlarmNames,
    alarmsToKeep,
  );

  log
    .info()
    .str('function', 'manageServiceAlarms')
    .str('Service', service)
    .str('Identifier', identifier)
    .obj('alarms to delete', alarmsToDelete)
    .msg('Deleting alarms that are no longer needed');
  await massDeleteAlarms(alarmsToDelete);

  log
    .info()
    .str('function', 'manageServiceAlarms')
    .str('Service', service)
    .str('Identifier', identifier)
    .msg('Finished alarm management process');
}

/**
 * Generic tag fetcher owning the shared log-and-handle-error contract of the
 * per-service fetch<Service>Tags wrappers. The caller supplies a closure that
 * performs the service's SDK call and extracts a Tag record from the
 * response.
 *
 * @param service - Service label used in log messages (e.g. 'SQS').
 * @param resourceId - Resource identifier/ARN, for log context only.
 * @param fetchFn - Closure performing the SDK call and Tag extraction.
 * @param onError - 'rethrow' (default) propagates fetch errors so a transient
 * API error fails the record (and is retried) instead of being treated as
 * "no tags" and deleting the alarms. 'return-empty' preserves the legacy
 * behavior of some modules that treat fetch errors as an empty tag set.
 */
export async function fetchResourceTags(
  service: string,
  resourceId: string,
  fetchFn: () => Promise<Tag>,
  onError: 'rethrow' | 'return-empty' = 'rethrow',
): Promise<Tag> {
  try {
    const tags = await fetchFn();

    log
      .info()
      .str('function', 'fetchResourceTags')
      .str('Service', service)
      .str('ResourceId', resourceId)
      .str('tags', JSON.stringify(tags))
      .msg(`Fetched ${service} tags`);

    return tags;
  } catch (error) {
    log
      .error()
      .str('function', 'fetchResourceTags')
      .str('Service', service)
      .str('ResourceId', resourceId)
      .err(error)
      .msg(`Error fetching ${service} tags`);
    if (onError === 'return-empty') {
      return {};
    }
    // Rethrow so a transient API error fails the record (and is retried)
    // instead of being treated as "no tags" and deleting the alarms.
    throw error;
  }
}

/**
 * Searches an event for the first occurrence of an ARN starting with the
 * given prefix. Serializes the event to a JSON string (unless it already is
 * one), looks for the prefix, and extracts everything up to the next
 * whitespace or quotation mark. Returns an empty string if no matching ARN
 * can be found.
 *
 * @param event - A JSON-serializable object (or pre-serialized JSON string)
 * to search.
 * @param arnPrefix - The ARN prefix to look for (e.g. 'arn:aws:rds').
 * @param options.notFoundLogLevel - Level to log a "prefix not found" miss at.
 * Defaults to 'error'. The LOGS module passes 'debug' because CreateLogGroup
 * events legitimately carry no ARN in the body (the ARN is reconstructed from
 * requestParameters), so a miss there is a normal fallback, not an error.
 * @returns The extracted ARN, or an empty string if not found.
 */
export function findArnInEvent(
  event: unknown,
  arnPrefix: string,
  options: {notFoundLogLevel?: 'error' | 'debug'} = {},
): string {
  const {notFoundLogLevel = 'error'} = options;
  const eventString = typeof event === 'string' ? event : JSON.stringify(event);

  // 1) Find where the ARN starts.
  const startIndex = eventString.indexOf(arnPrefix);
  if (startIndex === -1) {
    const entry = notFoundLogLevel === 'debug' ? log.debug() : log.error();
    entry
      .str('function', 'findArnInEvent')
      .str('arnPrefix', arnPrefix)
      .str('event', eventString)
      .msg('No ARN matching prefix found in event');
    return '';
  }

  // 2) ARNs contain no whitespace or quotes — extract up to the first of these.
  const tail = eventString.slice(startIndex);
  const arnMatch = tail.match(/^[^\s"]+/);
  if (!arnMatch) {
    log
      .error()
      .str('function', 'findArnInEvent')
      .str('arnPrefix', arnPrefix)
      .str('event', eventString)
      .msg('No ending delimiter found for ARN');
    return '';
  }

  // 3) Extract the ARN
  const arn = arnMatch[0];

  log
    .info()
    .str('function', 'findArnInEvent')
    .str('arn', arn)
    .msg('Extracted ARN from event');

  return arn;
}
