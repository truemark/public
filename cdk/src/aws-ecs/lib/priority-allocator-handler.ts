import {
  ElasticLoadBalancingV2Client,
  DescribeRulesCommand,
  type DescribeRulesCommandOutput,
} from '@aws-sdk/client-elastic-load-balancing-v2';

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
    readonly PreferredPriority?: string;
  };
  readonly OldResourceProperties?: {
    readonly ListenerArn: string;
    readonly ServiceIdentifier: string;
    readonly PreferredPriority?: string;
    readonly Priority?: string;
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

const MAX_PRIORITY = 50000;

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
 * Gets all priorities currently in use on the ALB listener.
 * The ALB is the single source of truth for priority allocation.
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
 * Finds the lowest available priority (gap filling).
 * If preferredPriority is specified and available, uses that instead.
 */
function findNextAvailablePriority(
  usedPriorities: Set<number>,
  preferredPriority?: number,
): number {
  // Try preferred priority first if specified
  if (
    preferredPriority &&
    preferredPriority >= 1 &&
    preferredPriority <= MAX_PRIORITY &&
    !usedPriorities.has(preferredPriority)
  ) {
    console.log(`Using preferred priority: ${preferredPriority}`);
    return preferredPriority;
  }

  if (preferredPriority) {
    console.log(
      `Preferred priority ${preferredPriority} is not available, finding next available`,
    );
  }

  // Find lowest available priority (gap filling)
  for (let priority = 1; priority <= MAX_PRIORITY; priority++) {
    if (!usedPriorities.has(priority)) {
      console.log(`Allocated priority: ${priority}`);
      return priority;
    }
  }

  throw new Error(`No available priorities found (all ${MAX_PRIORITY} in use)`);
}

/**
 * Handles Create request - allocates a new priority
 */
async function handleCreate(event: CustomResourceEvent): Promise<number> {
  const listenerArn = event.ResourceProperties.ListenerArn;
  const preferredPriority = event.ResourceProperties.PreferredPriority
    ? Number.parseInt(event.ResourceProperties.PreferredPriority, 10)
    : undefined;

  console.log('Handling CREATE request - allocating priority');

  // Query ALB for currently used priorities
  const usedPriorities = await getAlbListenerPriorities(listenerArn);

  // Find next available priority
  const priority = findNextAvailablePriority(usedPriorities, preferredPriority);

  console.log(
    `Successfully allocated priority ${priority} for service ${event.ResourceProperties.ServiceIdentifier}`,
  );

  return priority;
}

/**
 * Handles Update request - returns same priority if ServiceIdentifier unchanged
 */
async function handleUpdate(event: CustomResourceEvent): Promise<number> {
  const oldServiceId = event.OldResourceProperties?.ServiceIdentifier;
  const newServiceId = event.ResourceProperties.ServiceIdentifier;

  // If ServiceIdentifier hasn't changed, keep the same priority (idempotency)
  if (oldServiceId === newServiceId) {
    // Get the previously allocated priority from old properties
    const oldPriority = event.OldResourceProperties?.Priority
      ? Number.parseInt(event.OldResourceProperties.Priority, 10)
      : undefined;

    if (oldPriority) {
      console.log(
        `ServiceIdentifier unchanged - keeping existing priority: ${oldPriority}`,
      );
      return oldPriority;
    }
  }

  // ServiceIdentifier changed - allocate a new priority
  console.log('ServiceIdentifier changed - allocating new priority');
  return handleCreate(event);
}

/**
 * Handles Delete request - no-op since CloudFormation deletes the listener rule
 */
function handleDelete(): number {
  console.log('Handling DELETE request - no cleanup needed');
  console.log(
    'CloudFormation will delete the listener rule, which automatically frees the priority',
  );
  // Return 0 as placeholder (doesn't matter for delete)
  return 0;
}

/**
 * Main Lambda handler for the Custom Resource.
 * Allocates unique priorities for ALB listener rules using the ALB as the source of truth.
 */
export async function handler(
  event: CustomResourceEvent,
): Promise<CustomResourceResponse> {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const serviceIdentifier = event.ResourceProperties.ServiceIdentifier;

  // Physical resource ID is based on service identifier
  const physicalResourceId = `alb-priority-${serviceIdentifier}`;

  try {
    let priority: number;

    if (event.RequestType === 'Delete') {
      priority = handleDelete();
    } else if (event.RequestType === 'Update') {
      priority = await handleUpdate(event);
    } else {
      // Create
      priority = await handleCreate(event);
    }

    return success(event, physicalResourceId, priority);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in handler:', errorMessage);
    return fail(event, physicalResourceId, errorMessage);
  }
}
