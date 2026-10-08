import type {ResourceTagMapping} from '@aws-sdk/client-resource-groups-tagging-api';

/**
 * Tag keys that influence ReAlarm behavior. ReAlarm operates on ALL account
 * alarms by default with tag OPT-OUT, so these tags only ever build
 * exclusion/override sets - never an "eligible" set. Alarms with no tags at
 * all must remain eligible for the standard re-alarm cycle.
 */
export const REALARM_DISABLED_TAG_KEY = 'autoalarm:re-alarm-enabled';
export const REALARM_OVERRIDE_TAG_KEY = 'autoalarm:re-alarm-minutes';

export interface ReAlarmTagSets {
  /**
   * Alarm ARNs explicitly opted out of ReAlarm via
   * autoalarm:re-alarm-enabled=false.
   */
  excludedArns: Set<string>;
  /**
   * Alarm ARNs with a valid autoalarm:re-alarm-minutes override tag, mapped
   * to the override interval. These alarms are re-alarmed by their own
   * per-alarm EventBridge schedule rule (the isOverride path), not by the
   * standard cycle.
   */
  overrideByArn: Map<string, number>;
}

/**
 * Parses an autoalarm:re-alarm-minutes tag value. Only a real positive
 * integer counts as an override (mirrors the tag-event handler).
 * Number('') === 0, so a bare !isNaN check would treat ''/' '/'0' as an
 * override and exclude the alarm from BOTH re-alarm paths.
 */
export function parseOverrideMinutes(value: string | undefined): number | null {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Builds the ReAlarm exclusion and override sets from Resource Groups
 * Tagging API GetResources results. Duplicate mappings for the same ARN
 * (e.g. an alarm returned by sweeps for both tag keys) are harmless because
 * each mapping carries the resource's full tag list.
 *
 * Matching rules intentionally mirror the consumer's historical per-alarm
 * validation:
 * - excluded: a tag with Key 'autoalarm:re-alarm-enabled' and Value exactly
 *   'false' (case-sensitive).
 * - override: a tag with Key 'autoalarm:re-alarm-minutes' whose value is a
 *   positive integer.
 */
export function buildReAlarmTagSets(
  mappings: ResourceTagMapping[],
): ReAlarmTagSets {
  const excludedArns = new Set<string>();
  const overrideByArn = new Map<string, number>();

  for (const mapping of mappings) {
    const arn = mapping.ResourceARN;
    if (!arn) {
      continue;
    }

    for (const tag of mapping.Tags ?? []) {
      if (tag.Key === REALARM_DISABLED_TAG_KEY && tag.Value === 'false') {
        excludedArns.add(arn);
      } else if (tag.Key === REALARM_OVERRIDE_TAG_KEY) {
        const minutes = parseOverrideMinutes(tag.Value);
        if (minutes !== null) {
          overrideByArn.set(arn, minutes);
        }
      }
    }
  }

  return {excludedArns, overrideByArn};
}
