import {Construct} from 'constructs';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  CfnOutput,
  Token,
} from 'aws-cdk-lib';
import {Provider} from 'aws-cdk-lib/custom-resources';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {AttributeType, BillingMode, Table} from 'aws-cdk-lib/aws-dynamodb';
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
 * This construct implements a singleton pattern for the Lambda function and DynamoDB table,
 * ensuring that only one instance of each exists per AWS account/region regardless of how
 * many services use priority allocation.
 *
 * The allocation algorithm:
 * 1. Checks if this service already has an allocated priority (idempotent)
 * 2. Queries all priorities currently on the ALB listener (source of truth)
 * 3. Queries priorities tracked in DynamoDB
 * 4. Merges both sources to get complete picture
 * 5. Finds lowest available priority (gap filling)
 * 6. Allocates atomically with DynamoDB conditional write
 * 7. Returns allocated priority to CloudFormation
 *
 * On stack deletion, the priority is released back to the pool for reuse.
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
   * Singleton table name - shared across all priority allocators in the account/region.
   */
  private static readonly TABLE_NAME = 'alb-listener-priorities';

  /**
   * Gets or creates the singleton DynamoDB table for priority tracking.
   * Only one table exists per AWS account/region.
   */
  private static getOrCreateTable(scope: Construct): Table {
    const stack = Stack.of(scope);
    const tableId = 'PriorityAllocatorTable';

    // Try to find existing table in the stack
    const existing = stack.node.tryFindChild(tableId) as Table | undefined;
    if (existing) {
      return existing;
    }

    // Create new table at stack level (singleton)
    const table = new Table(stack, tableId, {
      tableName: PriorityAllocator.TABLE_NAME,
      partitionKey: {
        name: 'ListenerArn',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Priority',
        type: AttributeType.NUMBER,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Never delete - shared infrastructure
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for querying by service identifier
    table.addGlobalSecondaryIndex({
      indexName: 'ServiceIdentifierIndex',
      partitionKey: {
        name: 'ServiceIdentifier',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'ListenerArn',
        type: AttributeType.STRING,
      },
    });

    return table;
  }

  /**
   * Gets or creates the singleton Lambda function for priority allocation.
   * Only one Lambda function exists per AWS account/region.
   */
  private static getOrCreateLambda(
    scope: Construct,
    table: Table,
  ): NodejsFunction {
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

    // DynamoDB permissions
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:Query',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    );

    // Create Lambda function
    return new NodejsFunction(stack, lambdaId, {
      role,
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'priority-allocator-handler.js'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Allocates unique priorities for ALB listener rules',
      functionName: 'priority-allocator-singleton',
    });
  }

  /**
   * Gets or creates the singleton Custom Resource Provider.
   * Only one provider exists per AWS account/region.
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
    const table = PriorityAllocator.getOrCreateTable(this);
    const lambda = PriorityAllocator.getOrCreateLambda(this, table);
    const provider = PriorityAllocator.getOrCreateProvider(this, lambda);

    // Generate service identifier
    this.serviceIdentifier = this.generateServiceIdentifier(props.listenerArn);

    // Create Custom Resource for this specific service
    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        ListenerArn: props.listenerArn,
        ServiceIdentifier: this.serviceIdentifier,
        TableName: PriorityAllocator.TABLE_NAME,
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
