import {Construct} from 'constructs';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {CustomResource, Duration, Stack, CfnOutput, Token} from 'aws-cdk-lib';
import {Provider} from 'aws-cdk-lib/custom-resources';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import * as crypto from 'node:crypto';

export interface PriorityAllocatorProps {
  /**
   * The ARN of the ALB listener for which to allocate a priority.
   */
  readonly listenerArn: string;

  /**
   * Optional preferred priority. If available, this priority will be allocated.
   * If not available, the next available priority will be allocated.
   *
   * @default - Next available priority is allocated
   */
  readonly preferredPriority?: number;
}

/**
 * Allocates a unique priority for an ALB listener rule using a Lambda-backed Custom Resource.
 *
 * This construct implements a singleton pattern for the Lambda function per CloudFormation stack,
 * allowing multiple stacks to share the same ALB listener without resource conflicts.
 *
 * The allocation algorithm:
 * 1. Queries all priorities currently in use on the ALB listener (single source of truth)
 * 2. Finds lowest available priority (gap filling)
 * 3. Returns allocated priority to CloudFormation
 *
 * On stack updates, the custom resource maintains its state to preserve the allocated priority
 * (idempotency). On stack deletion, CloudFormation automatically deletes the listener rule,
 * which frees the priority for reuse.
 *
 * Multiple stacks can deploy services to the same ALB without conflicts. Race conditions are
 * handled by CloudFormation's retry mechanism - if two deployments try to use the same priority,
 * one will fail and retry with the next available priority.
 *
 * @example
 * ```typescript
 * const allocator = new PriorityAllocator(this, 'PriorityAllocator', {
 *   listenerArn: listener.listenerArn,
 * });
 *
 * // Use the allocated priority
 * listener.addTargetGroups('TargetGroup', {
 *   targetGroups: [targetGroup],
 *   priority: allocator.priority,
 * });
 * ```
 */
export class PriorityAllocator extends Construct {
  /**
   * The allocated priority for the ALB listener rule.
   */
  readonly priority: number;

  /**
   * The service identifier used for tracking this allocation.
   */
  readonly serviceIdentifier: string;

  /**
   * The Custom Resource that manages the priority allocation.
   */
  readonly resource: CustomResource;

  /**
   * Gets or creates the singleton Lambda function for priority allocation.
   * One Lambda function exists per CloudFormation stack, allowing multiple stacks
   * to share the same ALB without CloudFormation resource conflicts.
   */
  private static getOrCreateLambda(scope: Construct): NodejsFunction {
    const stack = Stack.of(scope);
    const lambdaId = 'PriorityAllocatorLambda';

    // Try to find existing Lambda in the stack
    const existing = stack.node.tryFindChild(lambdaId) as
      | NodejsFunction
      | undefined;
    if (existing) {
      return existing;
    }

    // Create IAM role for Lambda
    const role = new Role(stack, 'PriorityAllocatorLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for ALB Priority Allocator Lambda function',
    });

    // CloudWatch Logs permissions
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
      }),
    );

    // ALB read permissions
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DescribeRules',
        ],
        resources: ['*'],
      }),
    );

    // Create Lambda function with stack-scoped name to allow multiple stacks
    // to share the same ALB without CloudFormation resource conflicts
    const functionName = `priority-allocator-${stack.stackName}`;

    return new NodejsFunction(stack, lambdaId, {
      role,
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'priority-allocator-handler.js'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: `Allocates unique priorities for ALB listener rules (${stack.stackName})`,
      functionName,
    });
  }

  /**
   * Gets or creates the singleton Custom Resource Provider.
   * One provider exists per CloudFormation stack.
   */
  private static getOrCreateProvider(
    scope: Construct,
    lambda: NodejsFunction,
  ): Provider {
    const stack = Stack.of(scope);
    const providerId = 'PriorityAllocatorProvider';

    // Try to find existing provider in the stack
    const existing = stack.node.tryFindChild(providerId) as
      | Provider
      | undefined;
    if (existing) {
      return existing;
    }

    // Create new provider at stack level (singleton)
    return new Provider(stack, providerId, {
      onEventHandler: lambda,
    });
  }

  /**
   * Generates a deterministic service identifier based on the construct path and listener ARN.
   */
  private generateServiceIdentifier(listenerArn: string): string {
    const stack = Stack.of(this);
    const region = stack.region;
    const account = stack.account;
    const stackName = stack.stackName;
    const constructPath = this.node.path;

    // Create deterministic hash
    const input = `${account}/${region}/${stackName}/${constructPath}/${listenerArn}`;
    const hash = crypto
      .createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 12);

    // Create human-readable identifier with stack name and hash
    const sanitizedStackName = stackName
      .replaceAll(/[^a-zA-Z0-9-]/g, '-')
      .toLowerCase();
    return `${sanitizedStackName}-${hash}`;
  }

  constructor(scope: Construct, id: string, props: PriorityAllocatorProps) {
    super(scope, id);

    // Get or create singleton resources
    const lambda = PriorityAllocator.getOrCreateLambda(this);
    const provider = PriorityAllocator.getOrCreateProvider(this, lambda);

    // Generate service identifier
    this.serviceIdentifier = this.generateServiceIdentifier(props.listenerArn);

    // Create Custom Resource for this specific service
    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        ListenerArn: props.listenerArn,
        ServiceIdentifier: this.serviceIdentifier,
        PreferredPriority: props.preferredPriority?.toString(),
        // Add timestamp to ensure update on property changes
        Timestamp: Date.now().toString(),
      },
    });

    // Extract priority from custom resource
    this.priority = Token.asNumber(this.resource.getAtt('Priority'));

    // Add CloudFormation outputs for debugging
    new CfnOutput(this, 'ServiceIdentifier', {
      value: this.serviceIdentifier,
      description: 'Service identifier for priority allocation tracking',
    });

    new CfnOutput(this, 'AllocatedPriority', {
      value: this.priority.toString(),
      description: 'Auto-allocated priority for ALB listener rule',
    });
  }
}
