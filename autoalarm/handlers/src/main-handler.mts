import {
  Handler,
  SQSEvent,
  SQSBatchResponse,
  SQSBatchItemFailure,
  SQSRecord,
} from 'aws-lambda';
import * as logging from '@nr1e/logging';
import * as ServiceModules from './service-modules/_index.mjs';
import {routeEvent} from './event-router.mjs';
import {EC2AlarmManagerArray} from './types/index.mjs';

// Initialize logging
//TODO: maybe initialize logging in src so we can get child loggers across all modules
const level = process.env.LOG_LEVEL || 'info';
if (!logging.isLevel(level)) {
  throw new Error(`Invalid log level: ${level}`);
}
const log = logging.initialize({
  svc: 'AutoAlarm',
  name: 'main-handler',
  level,
});

/**
 * Pairs a parsed event body with the SQS record it came from so that
 * failures during deferred EC2 processing can be reported per record.
 */
interface EC2EventRecord {
  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any;
  record: SQSRecord;
}

/**
 * Processes accumulated EC2 instance state-change events. Returns the SQS
 * records whose events could not be processed so the handler can report them
 * as batch item failures without failing the whole batch.
 */
async function processEC2Event(
  eventRecords: EC2EventRecord[],
): Promise<SQSRecord[]> {
  const activeInstancesInfoArray: EC2AlarmManagerArray = [];
  const inactiveInstancesInfoArray: EC2AlarmManagerArray = [];
  const activeRecords: SQSRecord[] = [];
  const inactiveRecords: SQSRecord[] = [];
  const failedRecords: SQSRecord[] = [];

  for (const {event, record} of eventRecords) {
    try {
      const instanceId = event.detail['instance-id'];
      const state = event.detail.state;
      const tags = await ServiceModules.fetchInstanceTags(instanceId);

      // checking our liveStates set to see if the instance is in a state that we should be managing alarms for.
      if (
        instanceId &&
        ServiceModules.liveStates.has(state) &&
        tags['autoalarm:enabled'] === 'true'
      ) {
        activeInstancesInfoArray.push({
          instanceID: instanceId,
          tags: tags,
          state: state,
        });
        activeRecords.push(record);
      } else if (
        ServiceModules.deadStates.has(state) ||
        !tags['autoalarm:enabled']
      ) {
        // An instance in a dead state (regardless of the autoalarm:enabled tag
        // value) or without the autoalarm:enabled tag takes the inactive path
        // so its alarms are cleaned up.
        inactiveInstancesInfoArray.push({
          instanceID: instanceId,
          tags: tags,
          state: state,
        });
        inactiveRecords.push(record);
      }
    } catch (error) {
      log
        .error()
        .str('function', 'processEC2Event')
        .str('messageId', record.messageId)
        .err(error)
        .msg('Error processing EC2 event');
      failedRecords.push(record);
    }
  }

  // Manage alarms once with the fully accumulated arrays (matches the shape
  // of processEC2TagEvent) instead of re-running the managers per event.
  if (activeInstancesInfoArray.length > 0) {
    try {
      await ServiceModules.manageActiveEC2InstanceAlarms(
        activeInstancesInfoArray,
      );
    } catch (error) {
      log.error().err(error).msg('Error managing active EC2 instance alarms');
      failedRecords.push(...activeRecords);
    }
  }

  // If the instance is in a state that we should not be managing alarms for, we will remove the alarms.
  if (inactiveInstancesInfoArray.length > 0) {
    try {
      await ServiceModules.manageInactiveInstanceAlarms(
        inactiveInstancesInfoArray,
      );
    } catch (error) {
      log.error().err(error).msg('Error managing inactive EC2 instance alarms');
      failedRecords.push(...inactiveRecords);
    }
  }

  return failedRecords;
}

/**
 * Processes accumulated EC2 tag events. Returns the SQS records whose events
 * could not be processed so the handler can report them as batch item
 * failures without failing the whole batch.
 */
async function processEC2TagEvent(
  eventRecords: EC2EventRecord[],
): Promise<SQSRecord[]> {
  const activeInstancesInfoArray: EC2AlarmManagerArray = [];
  const inactiveInstancesInfoArray: EC2AlarmManagerArray = [];
  const activeRecords: SQSRecord[] = [];
  const inactiveRecords: SQSRecord[] = [];
  const failedRecords: SQSRecord[] = [];

  for (const {event, record} of eventRecords) {
    try {
      const {instanceId, state} = await ServiceModules.getEC2IdAndState(event);
      const tags = await ServiceModules.fetchInstanceTags(instanceId);
      if (tags['autoalarm:enabled'] === 'false') {
        inactiveInstancesInfoArray.push({
          instanceID: instanceId,
          tags: tags,
          state: state,
        });
        inactiveRecords.push(record);
        log
          .info()
          .str('function', 'processEC2TagEvent')
          .str('instanceId', instanceId)
          .str('autoalarm:enabled', tags['autoalarm:enabled'])
          .msg(
            'autoalarm:enabled tag set to false. Adding to inactiveInstancesInfoArray for alarm deletion',
          );
      } else if (
        tags['autoalarm:enabled'] === 'true' &&
        instanceId &&
        ServiceModules.liveStates.has(state)
      ) {
        activeInstancesInfoArray.push({
          instanceID: instanceId,
          tags: tags,
          state: state,
        });
        activeRecords.push(record);
      } else if (
        !tags['autoalarm:enabled'] ||
        tags['autoalarm:enabled'] === undefined
      ) {
        inactiveInstancesInfoArray.push({
          instanceID: instanceId,
          tags: tags,
          state: state,
        });
        inactiveRecords.push(record);
        log
          .info()
          .str('function', 'processEC2TagEvent')
          .str('instanceId', instanceId)
          .msg(
            'autoalarm:enabled tag not found. Adding to inactiveInstancesInfoArray for alarm deletion',
          );
      }
    } catch (error) {
      log
        .error()
        .str('function', 'processEC2TagEvent')
        .str('messageId', record.messageId)
        .err(error)
        .msg('Error processing EC2 tag event');
      failedRecords.push(record);
    }
  }

  if (activeInstancesInfoArray.length > 0) {
    try {
      await ServiceModules.manageActiveEC2InstanceAlarms(
        activeInstancesInfoArray,
      );
    } catch (error) {
      log.error().err(error).msg('Error managing active EC2 instance alarms');
      failedRecords.push(...activeRecords);
    }
  }

  if (inactiveInstancesInfoArray.length > 0) {
    try {
      await ServiceModules.manageInactiveInstanceAlarms(
        inactiveInstancesInfoArray,
      );
    } catch (error) {
      log.error().err(error).msg('Error managing inactive EC2 instance alarms');
      failedRecords.push(...inactiveRecords);
    }
  }

  return failedRecords;
}

export const handler: Handler = async (
  event: SQSEvent,
): Promise<void | SQSBatchResponse> => {
  log.trace().unknown('event', event).msg('Received event');
  // Create an array for all the EC2 events to be stored in and passed to the processEC2Event function imported form ec2-modules.mts
  // Still need to figure out type for event objects as they can vary from event to event
  // Each entry carries the originating SQS record so failures during deferred
  // processing can be reported per messageId.
  const ec2Events: EC2EventRecord[] = [];
  const ec2TagEvents: EC2EventRecord[] = [];
  /**
   * Create batch item failures array to store any failed items from the batch.
   */
  const batchItemFailures: SQSBatchItemFailure[] = [];
  const batchItemBodies: SQSRecord[] = [];

  if (!event.Records) {
    log.warn().msg('No Records found in event');
    throw new Error('No Records found in event');
  }

  for (const record of event.Records) {
    // Parse the body of the SQS message into a json object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(record.body);
    } catch (error) {
      log
        .error()
        .str('messageId', record.messageId)
        .err(error)
        .msg('Failed to parse record body as JSON');
      batchItemFailures.push({itemIdentifier: record.messageId});
      batchItemBodies.push(record);
      continue;
    }

    // Skip error envelopes forwarded by the upstream sqs-handler (Lambda
    // destination/error payloads carry a top-level errorMessage property).
    if (
      parsedBody &&
      typeof parsedBody === 'object' &&
      'errorMessage' in parsedBody
    ) {
      log
        .warn()
        .str('messageId', record.messageId)
        .msg('Error message found in record body');
      continue;
    }

    log.trace().obj('body', parsedBody).msg('Processing message body');

    try {
      const {name, action} = routeEvent(parsedBody);

      log
        .debug()
        .str('function', 'handler')
        .str('route', name)
        .str('source', parsedBody.source)
        .str('messageId', record.messageId)
        .msg('Matched route entry');

      switch (action.kind) {
        case 'module':
          if (action.args === 'record-account') {
            await action.handler(record, process.env.ACCT_ID!);
          } else if (action.args === 'record') {
            await action.handler(record);
          } else {
            await action.handler(parsedBody);
          }
          break;

        case 'accumulate-ec2':
          // EC2 instance events are accumulated and processed in one batch
          // after the loop (see processEC2Event).
          ec2Events.push({event: parsedBody, record: record});
          break;

        case 'accumulate-ec2-tag':
          // EC2 instance tag events are accumulated and processed in one
          // batch after the loop (see processEC2TagEvent).
          ec2TagEvents.push({event: parsedBody, record: record});
          break;

        case 'skip':
          if (!action.silent) {
            log
              .warn()
              .str('function', 'handler')
              .str('route', name)
              .msg(action.message(parsedBody));
          }
          break;

        case 'fail':
          log[action.level]()
            .str('function', 'handler')
            .str('route', name)
            .msg(action.message(parsedBody));
          batchItemFailures.push({itemIdentifier: record.messageId});
          batchItemBodies.push(record);
          break;
      }
    } catch (error) {
      log.error().err(error).msg('Error processing event');
      batchItemFailures.push({itemIdentifier: record.messageId});
      batchItemBodies.push(record);
    }
  }

  // If there were EC2 events after all iterations of the event records from the for loop, process them
  if (ec2Events.length > 0) {
    try {
      const failedEC2Records = await processEC2Event(ec2Events);
      for (const failedRecord of failedEC2Records) {
        batchItemFailures.push({itemIdentifier: failedRecord.messageId});
        batchItemBodies.push(failedRecord);
      }
    } catch (error) {
      // If EC2 processing throws, fail every record that contributed an EC2
      // event rather than losing the partial-batch response.
      log.error().err(error).msg('Error processing EC2 events');
      for (const {record} of ec2Events) {
        batchItemFailures.push({itemIdentifier: record.messageId});
        batchItemBodies.push(record);
      }
    }
  }

  // If there were EC2 tag events after all iterations of the event records from the for loop, process them
  if (ec2TagEvents.length > 0) {
    try {
      const failedEC2TagRecords = await processEC2TagEvent(ec2TagEvents);
      for (const failedRecord of failedEC2TagRecords) {
        batchItemFailures.push({itemIdentifier: failedRecord.messageId});
        batchItemBodies.push(failedRecord);
      }
    } catch (error) {
      // If EC2 tag processing throws, fail every record that contributed an
      // EC2 tag event rather than losing the partial-batch response.
      log.error().err(error).msg('Error processing EC2 tag events');
      for (const {record} of ec2TagEvents) {
        batchItemFailures.push({itemIdentifier: record.messageId});
        batchItemBodies.push(record);
      }
    }
  }

  if (batchItemFailures.length > 0) {
    log
      .error()
      .str('function', 'handler')
      .num('failedItems', batchItemFailures.length)
      .msg('Batch item failures found');
    log
      .error()
      .obj('batchItemBodies', batchItemBodies)
      .msg('Batch item bodies');
    return {
      batchItemFailures: batchItemFailures,
    };
  }
};
