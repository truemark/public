import {LambdaClient, ListTagsCommand} from '@aws-sdk/client-lambda';
import * as logging from '@nr1e/logging';
import {Tag} from '../types/index.mjs';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteExistingAlarms,
  fetchResourceTags,
  manageServiceAlarms,
} from '../alarm-configs/utils/index.mjs';
import {LAMBDA_CONFIGS} from '../alarm-configs/_index.mjs';

const log: logging.Logger = logging.getLogger('lambda-modules');
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const lambdaClient: LambdaClient = new LambdaClient({
  region: region,
  retryStrategy: retryStrategy,
});

const metricConfigs = LAMBDA_CONFIGS;

export async function fetchLambdaTags(functionArn: string): Promise<Tag> {
  // Default 'rethrow' (not 'return-empty'): a transient ListTags failure must
  // fail the SQS record for retry, not be treated as "no tags" — which would
  // make manageServiceAlarms see autoalarm:enabled absent and delete every
  // alarm for the function. See fetchResourceTags in service-helpers.mts.
  return fetchResourceTags('Lambda', functionArn, async () => {
    const command = new ListTagsCommand({Resource: functionArn});
    const response = await lambdaClient.send(command);
    // Lambda returns tags as a flat key/value map already.
    return response.Tags ?? {};
  });
}

async function checkAndManageLambdaAlarms(
  functionName: string,
  tags: Tag,
): Promise<void> {
  await manageServiceAlarms({
    service: 'Lambda',
    identifier: functionName,
    tags,
    configs: metricConfigs,
    dimensions: [{Name: 'FunctionName', Value: functionName}],
  });
}

export async function manageInactiveLambdaAlarms(
  functionName: string,
): Promise<void> {
  try {
    await deleteExistingAlarms('Lambda', functionName, metricConfigs);
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveLambdaAlarms')
      .err(e)
      .msg(`Error deleting Lambda alarms: ${e}`);
    throw new Error(`Error deleting Lambda alarms: ${e}`);
  }
}

/**
 * Extracts the Lambda function name from a function ARN or returns a bare
 * function name unchanged. The CloudWatch `FunctionName` dimension uses the
 * name, not the ARN, so a trailing version/alias qualifier is intentionally
 * dropped: AutoAlarm monitors function-level errors.
 *
 * arn:aws:lambda:<region>:<account>:function:<name>[:<qualifier>]
 *
 * This does not cause prod/staging alias alarms to collide: Lambda tags can
 * only be attached to the function resource itself (you cannot tag a version
 * or alias), so every tag-change event — and every CloudTrail Create/Delete
 * — carries the unqualified function ARN. There is no per-alias tag flow that
 * could produce two identifiers to merge.
 */
function extractFunctionName(functionArnOrName: string): string {
  if (!functionArnOrName) {
    log
      .error()
      .str('function', 'extractFunctionName')
      .str(
        'functionArnOrName',
        functionArnOrName ? functionArnOrName : 'undefined',
      )
      .msg('Invalid Lambda identifier: function name not found');
    throw new Error('Invalid Lambda identifier: function name not found');
  }
  // Bare name (no ARN) — return as-is.
  if (!functionArnOrName.startsWith('arn:')) {
    return functionArnOrName;
  }
  // arn:aws:lambda:region:account:function:<name>[:<qualifier>]
  const parts = functionArnOrName.split(':');
  const functionSegmentIndex = parts.indexOf('function');
  const name =
    functionSegmentIndex >= 0 ? parts[functionSegmentIndex + 1] : undefined;
  if (!name) {
    log
      .error()
      .str('function', 'extractFunctionName')
      .str('functionArnOrName', functionArnOrName)
      .msg('Could not extract function name from Lambda ARN');
    throw new Error('Could not extract function name from Lambda ARN');
  }
  log
    .debug()
    .str('function', 'extractFunctionName')
    .str('functionArnOrName', functionArnOrName)
    .str('functionName', name)
    .msg('Extracted Lambda function name');
  return name;
}

export async function parseLambdaEventAndCreateAlarms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: Record<string, any>,
): Promise<{
  functionArn: string;
  eventType: string;
  tags: Record<string, string>;
} | void> {
  let functionArn: string = '';
  let eventType: string = '';
  let tags: Record<string, string> = {};

  switch (event['detail-type']) {
    case 'Tag Change on Resource':
      functionArn = event.resources?.[0] ?? '';
      if (!functionArn) {
        log
          .error()
          .str('function', 'parseLambdaEventAndCreateAlarms')
          .obj('event', event)
          .msg('No Lambda ARN found in event for tag change event');
        throw new Error('No Lambda ARN found in event');
      }
      eventType = 'TagChange';
      log
        .info()
        .str('function', 'parseLambdaEventAndCreateAlarms')
        .str('eventType', 'TagChange')
        .str('functionArn', functionArn)
        .str('changedTags', JSON.stringify(event.detail['changed-tag-keys']))
        .msg('Processing Tag Change event');
      tags = await fetchLambdaTags(functionArn);
      log
        .info()
        .str('function', 'parseLambdaEventAndCreateAlarms')
        .str('functionArn', functionArn)
        .str('tags', JSON.stringify(tags))
        .msg('Fetched tags for Lambda TagChange event');
      break;

    case 'AWS API Call via CloudTrail':
      switch (event.detail.eventName) {
        // Lambda records the create API with a version suffix; both the legacy
        // and current (v2) names are matched so the rule fires regardless of
        // which the account emits.
        case 'CreateFunction20150331':
        case 'CreateFunction20150331v2':
          // Failed events (AccessDenied, etc.) have no responseElements — skip.
          if (event.detail.errorCode) {
            log
              .info()
              .str('function', 'parseLambdaEventAndCreateAlarms')
              .str('errorCode', event.detail.errorCode)
              .msg('Skipping failed CreateFunction event');
            return;
          }
          functionArn = event.detail.responseElements?.functionArn ?? '';
          if (!functionArn) {
            log
              .error()
              .str('function', 'parseLambdaEventAndCreateAlarms')
              .obj('event', event)
              .msg('No Lambda ARN found in event for CreateFunction event');
            throw new Error(
              'No Lambda ARN found in event for AWS API Call via CloudTrail event',
            );
          }
          eventType = 'Create';
          log
            .info()
            .str('function', 'parseLambdaEventAndCreateAlarms')
            .str('eventType', 'Create')
            .str('functionArn', functionArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing CreateFunction event');
          tags = await fetchLambdaTags(functionArn);
          log
            .info()
            .str('function', 'parseLambdaEventAndCreateAlarms')
            .str('functionArn', functionArn)
            .str('tags', JSON.stringify(tags))
            .msg('Fetched tags for new CreateFunction event');
          break;

        case 'DeleteFunction20150331':
        case 'DeleteFunction20150331v2':
          // Failed events have no requestParameters — skip.
          if (event.detail.errorCode) {
            log
              .info()
              .str('function', 'parseLambdaEventAndCreateAlarms')
              .str('errorCode', event.detail.errorCode)
              .msg('Skipping failed DeleteFunction event');
            return;
          }
          // DeleteFunction carries the function name (or ARN) in
          // requestParameters.functionName, not in responseElements.
          functionArn = event.detail.requestParameters?.functionName ?? '';
          if (!functionArn) {
            log
              .error()
              .str('function', 'parseLambdaEventAndCreateAlarms')
              .obj('event', event)
              .msg('No Lambda function name found in DeleteFunction event');
            throw new Error(
              'No Lambda function name found in DeleteFunction event',
            );
          }
          eventType = 'Delete';
          log
            .info()
            .str('function', 'parseLambdaEventAndCreateAlarms')
            .str('eventType', 'Delete')
            .str('functionArn', functionArn)
            .str('requestId', event.detail.requestID)
            .msg('Processing DeleteFunction event');
          break;

        default:
          log
            .error()
            .str('function', 'parseLambdaEventAndCreateAlarms')
            .str('eventName', event.detail.eventName)
            .str('requestId', event.detail.requestID)
            .msg('Unexpected CloudTrail event type');
          throw new Error('Unexpected CloudTrail event type');
      }
      break;

    default:
      log
        .error()
        .str('function', 'parseLambdaEventAndCreateAlarms')
        .str('detail-type', event['detail-type'])
        .msg('Unexpected event type');
      throw new Error('Unexpected event type');
  }

  const functionName = extractFunctionName(functionArn);

  log
    .info()
    .str('function', 'parseLambdaEventAndCreateAlarms')
    .str('functionArn', functionArn)
    .str('functionName', functionName)
    .str('eventType', eventType)
    .msg('Finished processing Lambda event');

  if (eventType === 'Create' || eventType === 'TagChange') {
    log
      .info()
      .str('function', 'parseLambdaEventAndCreateAlarms')
      .str('functionName', functionName)
      .str(
        'autoalarm:enabled',
        tags['autoalarm:enabled']
          ? tags['autoalarm:enabled']
          : 'autoalarm tag does not exist',
      )
      .msg('Starting to manage Lambda alarms');
    await checkAndManageLambdaAlarms(functionName, tags);
  } else if (eventType === 'Delete') {
    log
      .info()
      .str('function', 'parseLambdaEventAndCreateAlarms')
      .str('functionName', functionName)
      .msg('Starting to manage inactive Lambda alarms');
    await manageInactiveLambdaAlarms(functionName);
  }

  return {functionArn, eventType, tags};
}
