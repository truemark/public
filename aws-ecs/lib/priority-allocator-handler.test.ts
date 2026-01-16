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
} from '@aws-sdk/client-dynamodb';
import {mockClient} from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import * as handlerModule from './priority-allocator-handler';

const elbv2Mock = mockClient(ElasticLoadBalancingV2Client);
const dynamoMock = mockClient(DynamoDBClient);

describe('PriorityAllocatorHandler', () => {
  beforeEach(() => {
    elbv2Mock.reset();
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  describe('Handler - CREATE operation', () => {
    test('Allocates new priority when service does not exist', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist yet
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has rules with priorities 1 and 3
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: '1', RuleArn: 'rule1'},
          {Priority: '3', RuleArn: 'rule3'},
          {Priority: 'default', RuleArn: 'default-rule'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has priority 1
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: '1'},
              ServiceIdentifier: {S: 'other-service'},
            },
          ],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('2'); // Should allocate priority 2 (gap between 1 and 3)
      expect(dynamoMock).toHaveReceivedCommandWith(PutItemCommand, {
        TableName: 'alb-listener-priorities',
        Item: {
          ListenerArn: {S: event.ResourceProperties.ListenerArn},
          Priority: {N: '2'},
          ServiceIdentifier: {S: 'my-service-stack-abc123'},
          AllocatedAt: expect.any(Object),
          Source: {S: 'CDK'},
        },
        ConditionExpression: 'attribute_not_exists(ListenerArn)',
      });
    });

    test('Returns existing priority if service already allocated (idempotent)', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service already exists with priority 5
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: '5'},
              ServiceIdentifier: {S: 'my-service-stack-abc123'},
            },
          ],
          $metadata: {},
        } as QueryCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('5');
      // Should NOT call PutItemCommand since priority already exists
      expect(dynamoMock).not.toHaveReceivedCommand(PutItemCommand);
    });

    test('Uses preferred priority if available', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
          PreferredPriority: '100',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has no rules
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has no priorities
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('100');
      expect(dynamoMock).toHaveReceivedCommandWith(PutItemCommand, {
        Item: expect.objectContaining({
          Priority: {N: '100'},
        }),
      });
    });

    test('Falls back to next available if preferred priority is taken', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
          PreferredPriority: '100',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has priority 100 already
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [{Priority: '100', RuleArn: 'rule100'}],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has priority 100
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: '100'},
            },
          ],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1'); // Should fall back to priority 1
    });

    test('Handles race condition and retries', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has no rules
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has no priorities
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: First allocation fails (race condition), second succeeds
      dynamoMock
        .on(PutItemCommand)
        .rejectsOnce(
          new ConditionalCheckFailedException({
            message: 'Conditional check failed',
            $metadata: {},
          }),
        )
        .resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('2'); // Retried and got priority 2
      expect(dynamoMock).toHaveReceivedCommandTimes(PutItemCommand, 2);
    });

    test('Handles pagination for ALB rules', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB rules with pagination
      elbv2Mock
        .on(DescribeRulesCommand)
        .resolvesOnce({
          Rules: [{Priority: '1', RuleArn: 'rule1'}],
          NextMarker: 'marker1',
          $metadata: {},
        } as DescribeRulesCommandOutput)
        .resolvesOnce({
          Rules: [{Priority: '2', RuleArn: 'rule2'}],
          $metadata: {},
        } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has no priorities
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('3'); // Should skip 1 and 2
      expect(elbv2Mock).toHaveReceivedCommandTimes(DescribeRulesCommand, 2);
    });

    test('Handles pagination for DynamoDB queries', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has no rules
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB with pagination
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolvesOnce({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: '1'},
            },
          ],
          LastEvaluatedKey: {
            ListenerArn: {S: event.ResourceProperties.ListenerArn},
            Priority: {N: '1'},
          },
          $metadata: {},
        } as QueryCommandOutput)
        .resolvesOnce({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: '2'},
            },
          ],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('3'); // Should skip 1 and 2
    });
  });

  describe('Handler - DELETE operation', () => {
    test('Deletes priority allocation on stack deletion', async () => {
      const event = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'physical-resource-id',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Find existing priority
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            ListenerArn: {S: event.ResourceProperties.ListenerArn},
            Priority: {N: '5'},
            ServiceIdentifier: {S: 'my-service-stack-abc123'},
          },
        ],
        $metadata: {},
      } as QueryCommandOutput);

      // Mock: Successful deletion
      dynamoMock.on(DeleteItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: 'alb-listener-priorities',
        Key: {
          ListenerArn: {S: event.ResourceProperties.ListenerArn},
          Priority: {N: '5'},
        },
      });
    });

    test('Handles deletion when priority does not exist', async () => {
      const event = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'physical-resource-id',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Priority not found
      dynamoMock.on(QueryCommand).resolves({
        Items: [],
        $metadata: {},
      } as QueryCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      // Should NOT call DeleteItemCommand
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });
  });

  describe('Handler - UPDATE operation', () => {
    test('Treats UPDATE as CREATE and allocates priority', async () => {
      const event = {
        RequestType: 'Update' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'physical-resource-id',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
        OldResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service already exists (idempotent)
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            ListenerArn: {S: event.ResourceProperties.ListenerArn},
            Priority: {N: '5'},
            ServiceIdentifier: {S: 'my-service-stack-abc123'},
          },
        ],
        $metadata: {},
      } as QueryCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('5');
    });
  });

  describe('Error handling', () => {
    test('Returns FAILED status on ALB API error', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock.on(QueryCommand).resolves({
        Items: [],
        $metadata: {},
      });

      // Mock: ALB API error
      elbv2Mock.on(DescribeRulesCommand).rejects(new Error('ALB API error'));

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('FAILED');
      expect(result.Reason).toContain('ALB API error');
    });

    test('Returns FAILED status on DynamoDB error', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: DynamoDB error
      dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB error'));

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('FAILED');
      expect(result.Reason).toContain('DynamoDB error');
    });

    test('Handles invalid priority in ALB rules', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has rules with invalid priorities
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: 'not-a-number', RuleArn: 'rule1'},
          {Priority: undefined, RuleArn: 'rule2'},
          {Priority: 'default', RuleArn: 'default-rule'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has no priorities
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      // Should still succeed and allocate priority 1
      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1');
    });

    test('Handles invalid priority in DynamoDB items', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      // Mock: Service doesn't exist
      dynamoMock
        .on(QueryCommand, {
          IndexName: 'ServiceIdentifierIndex',
        })
        .resolves({
          Items: [],
          $metadata: {},
        });

      // Mock: ALB has no rules
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      // Mock: DynamoDB has items with invalid priorities
      dynamoMock
        .on(QueryCommand, {
          KeyConditionExpression: 'ListenerArn = :arn',
        })
        .resolves({
          Items: [
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {N: 'not-a-number'},
            },
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
              Priority: {S: 'wrong-type'},
            },
            {
              ListenerArn: {S: event.ResourceProperties.ListenerArn},
            },
          ],
          $metadata: {},
        } as QueryCommandOutput);

      // Mock: Successful allocation
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      // Should still succeed and allocate priority 1
      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1');
    });
  });

  describe('Edge cases', () => {
    test('Handles empty ALB rules list', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      dynamoMock.on(QueryCommand).resolves({Items: [], $metadata: {}});
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: undefined,
        $metadata: {},
      } as DescribeRulesCommandOutput);
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1');
    });

    test('Handles empty DynamoDB items list', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
        },
      };

      dynamoMock.on(QueryCommand).resolves({Items: undefined, $metadata: {}});
      elbv2Mock.on(DescribeRulesCommand).resolves({Rules: [], $metadata: {}});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1');
    });

    test('Handles preferred priority out of range', async () => {
      const event = {
        RequestType: 'Create' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          TableName: 'alb-listener-priorities',
          PreferredPriority: '60000', // Out of range
        },
      };

      dynamoMock.on(QueryCommand).resolves({Items: [], $metadata: {}});
      elbv2Mock.on(DescribeRulesCommand).resolves({Rules: [], $metadata: {}});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await handlerModule.handler(event);

      // Should ignore invalid preferred priority and use priority 1
      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1');
    });
  });
});
