import {
  ElasticLoadBalancingV2Client,
  DescribeRulesCommand,
  type DescribeRulesCommandOutput,
} from '@aws-sdk/client-elastic-load-balancing-v2';

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
  };
  readonly OldResourceProperties?: {
    readonly ListenerArn: string;
    readonly ServiceIdentifier: string;
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
const PHYSICAL_RESOURCE_ID_PREFIX = 'alb-priority-';

function extractPriorityFromRule(rule: {Priority?: string}): number | null {
  if (!rule.Priority || rule.Priority === 'default') {
    return null;
  }
  const priority = Number.parseInt(rule.Priority, 10);
  return Number.isNaN(priority) ? null : priority;
}

function parseOldPriority(physicalResourceId?: string): number | undefined {
  if (!physicalResourceId) {
    return undefined;
  }
  const match = /-p(\d+)$/.exec(physicalResourceId);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function buildPhysicalResourceId(
  serviceIdentifier: string,
  priority: number,
): string {
  return `${PHYSICAL_RESOURCE_ID_PREFIX}${serviceIdentifier}-p${priority}`;
}

function getFallbackPhysicalResourceId(
  serviceIdentifier: string,
  existingId?: string,
): string {
  return existingId || `${PHYSICAL_RESOURCE_ID_PREFIX}${serviceIdentifier}`;
}

async function getAlbListenerPriorities(
  listenerArn: string,
): Promise<Set<number>> {
  const priorities = new Set<number>();
  let nextMarker: string | undefined;

  do {
    const response: DescribeRulesCommandOutput = await elbv2Client.send(
      new DescribeRulesCommand({
        ListenerArn: listenerArn,
        Marker: nextMarker,
      }),
    );

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

  return priorities;
}

function findNextAvailablePriority(usedPriorities: Set<number>): number {
  if (usedPriorities.size === 0) {
    return 1;
  }
  return Math.max(...usedPriorities) + 1;
}

async function handleCreate(event: CustomResourceEvent): Promise<number> {
  const usedPriorities = await getAlbListenerPriorities(
    event.ResourceProperties.ListenerArn,
  );
  return findNextAvailablePriority(usedPriorities);
}

async function handleUpdate(event: CustomResourceEvent): Promise<number> {
  const oldServiceId = event.OldResourceProperties?.ServiceIdentifier;
  const newServiceId = event.ResourceProperties.ServiceIdentifier;

  if (oldServiceId === newServiceId) {
    const oldPriority = parseOldPriority(event.PhysicalResourceId);
    if (oldPriority !== undefined) {
      return oldPriority;
    }
  }

  return handleCreate(event);
}

export async function handler(
  event: CustomResourceEvent,
): Promise<CustomResourceResponse> {
  const serviceIdentifier = event.ResourceProperties.ServiceIdentifier;

  try {
    let priority: number;
    let physicalResourceId: string;

    if (event.RequestType === 'Delete') {
      physicalResourceId = getFallbackPhysicalResourceId(
        serviceIdentifier,
        event.PhysicalResourceId,
      );
      priority = 0;
    } else if (event.RequestType === 'Update') {
      priority = await handleUpdate(event);
      physicalResourceId = buildPhysicalResourceId(serviceIdentifier, priority);
    } else {
      priority = await handleCreate(event);
      physicalResourceId = buildPhysicalResourceId(serviceIdentifier, priority);
    }

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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in handler:', errorMessage);

    return {
      Status: 'FAILED',
      Reason: errorMessage,
      PhysicalResourceId: getFallbackPhysicalResourceId(
        serviceIdentifier,
        event.PhysicalResourceId,
      ),
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      NoEcho: false,
    };
  }
}
