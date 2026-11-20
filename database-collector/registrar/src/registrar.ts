import type {EventBridgeEvent} from 'aws-lambda';

/**
 * Receives tag change events for RDS instances and Secrets Manager secrets,
 * plus a periodic reconcile event, and keeps one EventBridge Scheduler
 * schedule per tagged database.
 *
 * Scaffold only: schedule management is not implemented yet. When it is,
 * schedules must use `cron(* * * * ? *)` rather than `rate(1 minute)`: cron
 * fires near second 0, which the collector's rounding of timestamps to the
 * minute relies on. They also need a RetryPolicy with MaximumRetryAttempts 0
 * and MaximumEventAgeInSeconds 60, since a late collection would duplicate
 * the next minute's metrics. The `query-sets` tag value is passed through
 * unchanged as the schedule input's `querySets` field.
 */
export async function handler(
  event: EventBridgeEvent<string, unknown>,
): Promise<void> {
  console.log(
    JSON.stringify({
      message: 'Received event',
      source: event.source,
      detailType: event['detail-type'],
      resources: event.resources,
    }),
  );
}
