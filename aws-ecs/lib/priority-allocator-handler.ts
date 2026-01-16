import {
  ElasticLoadBalancingV2Client,
  DescribeRulesCommand,
  type DescribeRulesCommandOutput,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
  ConditionalCheckFailedException,
  type QueryCommandOutput,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import * as crypto from 'node:crypto';

// CloudFormation Custom Resource event interface
interface CustomResourceEvent {
  readonly RequestType: 'Create' | 'Update' | 'Delete';
  readonly ResponseURL: string;
  readonly StackId: string;
  readonly RequestId: string;
  readonly ResourceType: string;
  readonly LogicalResourceId: string;
  readonly PhysicalResourceId?: string;
  readonly ResourceProperties: {
    readonly ListenerArn: string;
    readonly ServiceIdentifier: string;
    readonly TableName: string;
    readonly PreferredPriority?: string;
  };
  readonly OldResourceProperties?: {
    readonly ListenerArn: string;
    readonly ServiceIdentifier: string;
    readonly TableName: string;
    readonly PreferredPriority?: string;
  };
}

interface CustomResourceResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  NoEcho?: boolean;
  Data?: {
    Priority: string;
  };
}

const elbv2Client = new ElasticLoadBalancingV2Client({});
const dynamoClient = new DynamoDBClient({});

const MAX_PRIORITY = 50000;
const MAX_RETRIES = 10;

/**
 * Creates a deterministic hash of the service identifier
 */
function hashServiceIdentifier(serviceIdentifier: string): string {
  return crypto.createHash('sha256').update(serviceIdentifier).digest('hex');
}

/**
 * Creates a success response
 */
function success(
  event: CustomResourceEvent,
  physicalResourceId: string,
  priority: number,
): CustomResourceResponse {
  return {
    Status: 'SUCCESS',
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {
      Priority: priority.toString(),
    },
  };
}

/**
 * Creates a failure response
 */
function fail(
  event: CustomResourceEvent,
  physicalResourceId: string,
  reason: string,
): CustomResourceResponse {
  return {
    Status: 'FAILED',
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
  };
}

/**
 * Extracts valid priority from a rule
 */
function extractPriorityFromRule(rule: {Priority?: string}): number | null {
  if (!rule.Priority || rule.Priority === 'default') {
    return null;
  }
  const priority = Number.parseInt(rule.Priority, 10);
  return Number.isNaN(priority) ? null : priority;
}

/**
 * Formats priority list for logging
 */
function formatPrioritiesForLog(priorities: Set<number>): string {
  const sorted = Array.from(priorities).sort((a, b) => a - b);
  const preview = sorted.slice(0, 10).join(', ');
  return priorities.size > 10 ? `${preview}...` : preview;
}

/**
 * Gets all priorities currently in use on the ALB listener
 */
async function getAlbListenerPriorities(
  listenerArn: string,
): Promise<Set<number>> {
  const priorities = new Set<number>();

  try {
    let nextMarker: string | undefined = undefined;

    do {
      const command = new DescribeRulesCommand({
        ListenerArn: listenerArn,
        Marker: nextMarker,
      });

      const response: DescribeRulesCommandOutput =
        await elbv2Client.send(command);

      if (response.Rules) {
        for (const rule of response.Rules) {
          const priority = extractPriorityFromRule(rule);
          if (priority !== null) {
            priorities.add(priority);
          }
        }
      }

      nextMarker = response.NextMarker;
    } while (nextMarker);

    const formatted = formatPrioritiesForLog(priorities);
    console.log(
      `Found ${priorities.size} priorities in use on ALB listener: ${formatted}`,
    );
  } catch (error) {
    console.error('Error fetching ALB listener priorities:', error);
    throw error;
  }

  return priorities;
}

/**
 * Extracts valid priority from a DynamoDB item
 */
function extractPriorityFromDynamoItem(
  item: Record<string, AttributeValue>,
): number | null {
  if (!item.Priority?.N) {
    return null;
  }
  const priority = Number.parseInt(item.Priority.N, 10);
  return Number.isNaN(priority) ? null : priority;
}

/**
 * Gets all priorities tracked in DynamoDB for this listener
 */
async function getDynamoDbPriorities(
  tableName: string,
  listenerArn: string,
): Promise<Set<number>> {
  const priorities = new Set<number>();

  try {
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined =
      undefined;

    do {
      const command = new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'ListenerArn = :arn',
        ExpressionAttributeValues: {
          ':arn': {S: listenerArn},
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response: QueryCommandOutput = await dynamoClient.send(command);

      if (response.Items) {
        for (const item of response.Items) {
          const priority = extractPriorityFromDynamoItem(item);
          if (priority !== null) {
            priorities.add(priority);
          }
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(
      `Found ${priorities.size} priorities tracked in DynamoDB for listener`,
    );
  } catch (error) {
    console.error('Error fetching DynamoDB priorities:', error);
    throw error;
  }

  return priorities;
}

/**
 * Checks if the service already has an allocated priority (for idempotency)
 */
async function getExistingAllocation(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
): Promise<number | null> {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'ServiceIdentifierIndex',
      KeyConditionExpression: 'ServiceIdentifier = :sid AND ListenerArn = :arn',
      ExpressionAttributeValues: {
        ':sid': {S: serviceIdentifier},
        ':arn': {S: listenerArn},
      },
    });

    const response: QueryCommandOutput = await dynamoClient.send(command);

    if (response.Items?.[0]) {
      const item = response.Items[0];
      if (item.Priority?.N) {
        const priority = Number.parseInt(item.Priority.N, 10);
        console.log(
          `Found existing allocation: priority ${priority} for service ${serviceIdentifier}`,
        );
        return priority;
      }
    }

    return null;
  } catch (error) {
    console.error('Error checking existing allocation:', error);
    throw error;
  }
}

/**
 * Attempts to allocate a specific priority atomically
 */
async function tryAllocatePriority(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
  priority: number,
): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    const command = new PutItemCommand({
      TableName: tableName,
      Item: {
        ListenerArn: {S: listenerArn},
        Priority: {N: priority.toString()},
        ServiceIdentifier: {S: serviceIdentifier},
        AllocatedAt: {S: now},
        Source: {S: 'CDK'},
      },
      ConditionExpression: 'attribute_not_exists(ListenerArn)',
    });

    await dynamoClient.send(command);
    console.log(
      `Successfully allocated priority ${priority} for service ${serviceIdentifier}`,
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      console.log(
        `Priority ${priority} already taken (race condition), will try next available`,
      );
      return false;
    }
    console.error('Error allocating priority:', error);
    throw error;
  }
}

/**
 * Validates if a priority is within valid range
 */
function isValidPriorityRange(priority: number): boolean {
  return priority >= 1 && priority <= MAX_PRIORITY;
}

/**
 * Attempts to allocate preferred priority if available
 */
async function tryPreferredPriority(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
  preferredPriority: number,
  usedPriorities: Set<number>,
): Promise<number | null> {
  if (!isValidPriorityRange(preferredPriority)) {
    return null;
  }

  if (usedPriorities.has(preferredPriority)) {
    console.log(
      `Preferred priority ${preferredPriority} is already in use, finding next available`,
    );
    return null;
  }

  const allocated = await tryAllocatePriority(
    tableName,
    listenerArn,
    serviceIdentifier,
    preferredPriority,
  );
  return allocated ? preferredPriority : null;
}

/**
 * Finds lowest available priority with gap filling
 */
async function findLowestAvailablePriority(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
  usedPriorities: Set<number>,
): Promise<number> {
  let retries = 0;

  for (let priority = 1; priority <= MAX_PRIORITY; priority++) {
    if (usedPriorities.has(priority)) {
      continue;
    }

    const allocated = await tryAllocatePriority(
      tableName,
      listenerArn,
      serviceIdentifier,
      priority,
    );

    if (allocated) {
      return priority;
    }

    // Race condition: someone else took this priority, try next
    retries++;
    if (retries >= MAX_RETRIES) {
      throw new Error(
        `Failed to allocate priority after ${MAX_RETRIES} retries due to race conditions`,
      );
    }
  }

  throw new Error(`No available priorities found (all ${MAX_PRIORITY} in use)`);
}

/**
 * Finds the lowest available priority and allocates it
 */
async function allocatePriority(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
  preferredPriority?: number,
): Promise<number> {
  // Step 1: Check if service already has an allocation (idempotency)
  const existingPriority = await getExistingAllocation(
    tableName,
    listenerArn,
    serviceIdentifier,
  );
  if (existingPriority !== null) {
    return existingPriority;
  }

  // Step 2: Get all used priorities from ALB
  const albPriorities = await getAlbListenerPriorities(listenerArn);

  // Step 3: Get all tracked priorities from DynamoDB
  const dynamoPriorities = await getDynamoDbPriorities(tableName, listenerArn);

  // Step 4: Merge both sources to get complete picture
  const allUsedPriorities = new Set([...albPriorities, ...dynamoPriorities]);

  console.log(
    `Total priorities in use (ALB + DynamoDB): ${allUsedPriorities.size}`,
  );

  // Step 5: Try preferred priority first if provided
  if (preferredPriority) {
    const result = await tryPreferredPriority(
      tableName,
      listenerArn,
      serviceIdentifier,
      preferredPriority,
      allUsedPriorities,
    );
    if (result !== null) {
      return result;
    }
  }

  // Step 6: Find lowest available priority (gap filling)
  return findLowestAvailablePriority(
    tableName,
    listenerArn,
    serviceIdentifier,
    allUsedPriorities,
  );
}

/**
 * Deletes a priority allocation from DynamoDB
 */
async function deletePriorityAllocation(
  tableName: string,
  listenerArn: string,
  serviceIdentifier: string,
): Promise<void> {
  try {
    // Find the priority allocated to this service
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'ServiceIdentifierIndex',
      KeyConditionExpression: 'ServiceIdentifier = :sid AND ListenerArn = :arn',
      ExpressionAttributeValues: {
        ':sid': {S: serviceIdentifier},
        ':arn': {S: listenerArn},
      },
    });

    const response = await dynamoClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      console.log(
        `No priority found for service ${serviceIdentifier}, nothing to delete`,
      );
      return;
    }

    const item = response.Items[0];
    const priorityValue = item.Priority?.N;
    if (!priorityValue) {
      console.error('Priority not found in item:', item);
      return;
    }

    const priority = Number.parseInt(priorityValue, 10);

    // Delete the allocation
    const deleteCommand = new DeleteItemCommand({
      TableName: tableName,
      Key: {
        ListenerArn: {S: listenerArn},
        Priority: {N: priority.toString()},
      },
    });

    await dynamoClient.send(deleteCommand);
    console.log(
      `Successfully deleted priority ${priority} for service ${serviceIdentifier}`,
    );
  } catch (error) {
    console.error('Error deleting priority allocation:', error);
    throw error;
  }
}

/**
 * Main Lambda handler for the Custom Resource
 */
export async function handler(
  event: CustomResourceEvent,
): Promise<CustomResourceResponse> {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const listenerArn = event.ResourceProperties.ListenerArn;
  const serviceIdentifier = event.ResourceProperties.ServiceIdentifier;
  const tableName = event.ResourceProperties.TableName;
  const preferredPriority = event.ResourceProperties.PreferredPriority
    ? Number.parseInt(event.ResourceProperties.PreferredPriority, 10)
    : undefined;

  // Physical resource ID is based on listener ARN and service identifier
  const physicalResourceId = hashServiceIdentifier(
    `${listenerArn}/${serviceIdentifier}`,
  );

  try {
    // Handle Delete operation
    if (event.RequestType === 'Delete') {
      console.log('Handling DELETE request - removing priority allocation');
      await deletePriorityAllocation(tableName, listenerArn, serviceIdentifier);
      // Return success with priority 0 (doesn't matter for delete)
      return success(event, physicalResourceId, 0);
    }

    // Handle Create and Update operations
    console.log(`Handling ${event.RequestType} request - allocating priority`);
    const priority = await allocatePriority(
      tableName,
      listenerArn,
      serviceIdentifier,
      preferredPriority,
    );

    return success(event, physicalResourceId, priority);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in handler:', errorMessage);
    return fail(event, physicalResourceId, errorMessage);
  }
}
