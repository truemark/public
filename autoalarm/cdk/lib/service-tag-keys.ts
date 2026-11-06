/**
 * Per-service `autoalarm:` tag keys used by the EventBridge tag-change rules
 * (`changed-tag-keys` filters) in service-eventbridge-subconstruct.ts.
 *
 * Each list is derived from the corresponding alarm-config array in
 * handlers/src/alarm-configs/*-configs.mts:
 *
 *   ['autoalarm:enabled', ...CONFIGS.map((c) => `autoalarm:${c.tagKey}`),
 *    ...NON_CONFIG_TAG_KEYS[service] ?? []]
 *
 * The handlers package is ESM (.mts) and cannot be imported directly into
 * this CommonJS CDK build (TS would need `module: nodenext` plus
 * require(esm) support to import an ES module from CJS), so the lists are
 * materialized here and guarded against drift by service-tag-keys.test.ts,
 * which loads the real handler configs (bundled with esbuild) and asserts
 * these lists match exactly. Adding, removing, or renaming a `tagKey` in
 * handlers without updating this file fails CI.
 */

/**
 * Services that have an EventBridge "Tag Change on Resource" rule filtered
 * by changed-tag-keys. (ecs, logs, and sqs receive tag events via
 * CloudTrail TagResource/UntagResource API-call rules instead.)
 */
export type TagRuleService =
  | 'alb'
  | 'cloudfront'
  | 'ec2'
  | 'lambda'
  | 'opensearch'
  | 'rds'
  | 'rdscluster'
  | 'route53resolver'
  | 'sfn'
  | 'targetgroup'
  | 'transitgateway'
  | 'vpn';

/**
 * Tag keys AutoAlarm reacts to that are NOT backed by a MetricAlarmConfig
 * entry (behavior/routing tags rather than per-metric alarm tags).
 */
export const NON_CONFIG_TAG_KEYS: Partial<Record<TagRuleService, string[]>> = {
  // Routes EC2 alarms between CloudWatch and Prometheus
  // (see handlers/src/service-modules/ec2-modules.mts).
  ec2: ['autoalarm:target'],
};

/**
 * changed-tag-keys for each service's tag rule, in the same order as the
 * corresponding *_CONFIGS array (order is irrelevant to EventBridge
 * matching; keeping config order makes the drift test a strict equality).
 */
export const SERVICE_TAG_KEYS: Record<TagRuleService, string[]> = {
  alb: [
    'autoalarm:enabled',
    'autoalarm:4xx-count',
    'autoalarm:4xx-count-anomaly',
    'autoalarm:5xx-count',
    'autoalarm:5xx-count-anomaly',
    'autoalarm:request-count',
    'autoalarm:request-count-anomaly',
  ],
  cloudfront: [
    'autoalarm:enabled',
    'autoalarm:4xx-errors',
    'autoalarm:4xx-errors-anomaly',
    'autoalarm:5xx-errors',
    'autoalarm:5xx-errors-anomaly',
  ],
  ec2: [
    'autoalarm:enabled',
    'autoalarm:cpu',
    'autoalarm:cpu-anomaly',
    'autoalarm:memory',
    'autoalarm:memory-anomaly',
    'autoalarm:storage',
    'autoalarm:storage-anomaly',
    'autoalarm:network-in',
    'autoalarm:network-in-anomaly',
    'autoalarm:network-out',
    'autoalarm:network-out-anomaly',
    'autoalarm:target',
  ],
  lambda: ['autoalarm:enabled', 'autoalarm:errors'],
  opensearch: [
    'autoalarm:enabled',
    'autoalarm:4xx-errors',
    'autoalarm:4xx-errors-anomaly',
    'autoalarm:5xx-errors',
    'autoalarm:5xx-errors-anomaly',
    'autoalarm:cpu',
    'autoalarm:cpu-anomaly',
    'autoalarm:iops-throttle',
    'autoalarm:iops-throttle-anomaly',
    'autoalarm:jvm-memory',
    'autoalarm:jvm-memory-anomaly',
    'autoalarm:read-latency',
    'autoalarm:read-latency-anomaly',
    'autoalarm:search-latency',
    'autoalarm:search-latency-anomaly',
    'autoalarm:snapshot-failure',
    'autoalarm:storage',
    'autoalarm:storage-anomaly',
    'autoalarm:throughput-throttle',
    'autoalarm:throughput-throttle-anomaly',
    'autoalarm:write-latency',
    'autoalarm:write-latency-anomaly',
    'autoalarm:yellow-cluster',
    'autoalarm:red-cluster',
    'autoalarm:index-writes-blocked',
  ],
  rds: [
    'autoalarm:enabled',
    'autoalarm:cpu',
    'autoalarm:db-connections-anomaly',
    'autoalarm:dbload-anomaly',
    'autoalarm:freeable-memory',
    'autoalarm:freeable-memory-anomaly',
    'autoalarm:write-latency',
    'autoalarm:write-latency-anomaly',
    'autoalarm:read-latency',
    'autoalarm:read-latency-anomaly',
    'autoalarm:swap-usage',
    'autoalarm:deadlocks',
    'autoalarm:disk-queue-depth',
    'autoalarm:disk-queue-depth-anomaly',
    'autoalarm:read-throughput-anomaly',
    'autoalarm:write-throughput-anomaly',
  ],
  rdscluster: [
    'autoalarm:enabled',
    'autoalarm:db-connections-anomaly',
    'autoalarm:replica-lag',
    'autoalarm:replica-lag-anomaly',
  ],
  route53resolver: [
    'autoalarm:enabled',
    'autoalarm:inbound-query-volume',
    'autoalarm:inbound-query-volume-anomaly',
    'autoalarm:outbound-query-volume',
    'autoalarm:outbound-query-volume-anomaly',
  ],
  sfn: [
    'autoalarm:enabled',
    'autoalarm:executions-failed',
    'autoalarm:executions-failed-anomaly',
    'autoalarm:executions-timed-out',
    'autoalarm:executions-timed-out-anomaly',
  ],
  targetgroup: [
    'autoalarm:enabled',
    'autoalarm:4xx-count',
    'autoalarm:4xx-count-anomaly',
    'autoalarm:5xx-count',
    'autoalarm:5xx-count-anomaly',
    'autoalarm:response-time',
    'autoalarm:response-time-anomaly',
    'autoalarm:unhealthy-host-count',
    'autoalarm:healthy-host-count',
  ],
  transitgateway: [
    'autoalarm:enabled',
    'autoalarm:bytes-in',
    'autoalarm:bytes-in-anomaly',
    'autoalarm:bytes-out',
    'autoalarm:bytes-out-anomaly',
  ],
  vpn: [
    'autoalarm:enabled',
    'autoalarm:tunnel-state',
    'autoalarm:tunnel-state-anomaly',
  ],
};
