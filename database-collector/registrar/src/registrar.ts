import type {EventBridgeEvent} from 'aws-lambda';

/**
 * Receives tag change events for RDS instances and Secrets Manager secrets,
 * plus a periodic reconcile event, and keeps one EventBridge Scheduler
 * schedule per tagged database.
 *
 * Scaffold only: schedule management is not implemented yet.
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
