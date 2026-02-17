import {Construct} from 'constructs';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {CustomResource, Duration, Stack, Token} from 'aws-cdk-lib';
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

const HASH_SUBSTRING_LENGTH = 12;
const LAMBDA_TIMEOUT_SECONDS = 30;
const LAMBDA_MEMORY_SIZE_MB = 256;
const HASH_ALGORITHM = 'sha256';

const LAMBDA_ID = 'PriorityAllocatorLambda';
const LAMBDA_ROLE_ID = 'PriorityAllocatorLambdaRole';
const PROVIDER_ID = 'PriorityAllocatorProvider';

const SERVICE_ID_DISALLOWED_CHARS = /[^a-zA-Z0-9-]/g;

function sanitizeStackNameForServiceId(stackName: string): string {
  return stackName.replaceAll(SERVICE_ID_DISALLOWED_CHARS, '-').toLowerCase();
}

function generateShortHash(input: string): string {
  return crypto
    .createHash(HASH_ALGORITHM)
    .update(input)
    .digest('hex')
    .substring(0, HASH_SUBSTRING_LENGTH);
}

export interface PriorityAllocatorProps {
  /**
   * The ARN of the ALB listener for which to allocate a priority.
   */
  readonly listenerArn: string;
}

/**
 * Automatically allocates a unique priority for an ALB listener rule.
 *
 * Priorities are allocated after the highest existing priority. When creating
 * multiple services in the same stack, add dependencies to force sequential
 * creation and avoid priority conflicts.
 *
 * @example
 * ```typescript
 * const service1 = new StandardApplicationFargateService(this, 'Service1', {
 *   listener,
 *   // No targetGroupPriority - automatically allocated
 * });
 *
 * const service2 = new StandardApplicationFargateService(this, 'Service2', {
 *   listener,
 *   // No targetGroupPriority - automatically allocated
 * });
 *
 * // Force sequential creation to avoid priority conflicts
 * service2.node.addDependency(service1);
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

  private static getOrCreateLambda(scope: Construct): NodejsFunction {
    const stack = Stack.of(scope);

    const existing = stack.node.tryFindChild(LAMBDA_ID) as
      | NodejsFunction
      | undefined;
    if (existing) {
      return existing;
    }

    const role = new Role(stack, LAMBDA_ROLE_ID, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for ALB Priority Allocator Lambda function',
    });

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

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['elasticloadbalancing:DescribeRules'],
        resources: ['*'],
      }),
    );

    return new NodejsFunction(stack, LAMBDA_ID, {
      role,
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        'dist',
        'aws-ecs',
        'lib',
        'priority-allocator-handler.js',
      ),
      timeout: Duration.seconds(LAMBDA_TIMEOUT_SECONDS),
      memorySize: LAMBDA_MEMORY_SIZE_MB,
      description: `Allocates unique priorities for ALB listener rules (${stack.stackName})`,
    });
  }

  private static getOrCreateProvider(
    scope: Construct,
    lambda: NodejsFunction,
  ): Provider {
    const stack = Stack.of(scope);

    const existing = stack.node.tryFindChild(PROVIDER_ID) as
      | Provider
      | undefined;
    if (existing) {
      return existing;
    }

    return new Provider(stack, PROVIDER_ID, {
      onEventHandler: lambda,
    });
  }

  private generateServiceIdentifier(listenerArn: string): string {
    const stack = Stack.of(this);
    const input = `${stack.resolve(stack.account)}/${stack.resolve(stack.region)}/${stack.stackName}/${this.node.path}/${listenerArn}`;
    const hash = generateShortHash(input);
    return `${sanitizeStackNameForServiceId(stack.stackName)}-${hash}`;
  }

  constructor(scope: Construct, id: string, props: PriorityAllocatorProps) {
    super(scope, id);

    const lambda = PriorityAllocator.getOrCreateLambda(this);
    const provider = PriorityAllocator.getOrCreateProvider(this, lambda);

    this.serviceIdentifier = this.generateServiceIdentifier(props.listenerArn);

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        ListenerArn: props.listenerArn,
        ServiceIdentifier: this.serviceIdentifier,
      },
    });

    this.priority = Token.asNumber(this.resource.getAtt('Priority'));
  }
}
