import {
  ElasticLoadBalancingV2Client,
  DescribeRulesCommand,
  type DescribeRulesCommandOutput,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {mockClient} from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import * as handlerModule from './priority-allocator-handler';

const elbv2Mock = mockClient(ElasticLoadBalancingV2Client);

describe('PriorityAllocatorHandler', () => {
  beforeEach(() => {
    elbv2Mock.reset();
    jest.clearAllMocks();
  });

  describe('Handler - CREATE operation', () => {
    test('Allocates lowest available priority (gap filling)', async () => {
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
        },
      };

      // Mock: ALB has rules with priorities 1, 3, 4 (gap at 2)
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: '1', RuleArn: 'rule1'},
          {Priority: '3', RuleArn: 'rule3'},
          {Priority: '4', RuleArn: 'rule4'},
          {Priority: 'default', RuleArn: 'default-rule'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('2'); // Should allocate priority 2 (gap)
      expect(result.PhysicalResourceId).toBe(
        'alb-priority-my-service-stack-abc123',
      );
    });

    test('Allocates priority 1 when no rules exist', async () => {
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
        },
      };

      // Mock: ALB has no rules (only default)
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [{Priority: 'default', RuleArn: 'default-rule'}],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('1'); // First available priority
    });

    test('Handles pagination of ALB rules', async () => {
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
        },
      };

      // Mock: First page has priority 1
      elbv2Mock
        .on(DescribeRulesCommand, {
          ListenerArn: event.ResourceProperties.ListenerArn,
          Marker: undefined,
        })
        .resolves({
          Rules: [{Priority: '1', RuleArn: 'rule1'}],
          NextMarker: 'marker-1',
          $metadata: {},
        } as DescribeRulesCommandOutput);

      // Mock: Second page has priority 3
      elbv2Mock
        .on(DescribeRulesCommand, {
          ListenerArn: event.ResourceProperties.ListenerArn,
          Marker: 'marker-1',
        })
        .resolves({
          Rules: [{Priority: '3', RuleArn: 'rule3'}],
          $metadata: {},
        } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('2'); // Gap between 1 and 3
    });

    test('Uses preferred priority when available', async () => {
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
          PreferredPriority: '100',
        },
      };

      // Mock: ALB has priorities 1, 2, 3
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: '1', RuleArn: 'rule1'},
          {Priority: '2', RuleArn: 'rule2'},
          {Priority: '3', RuleArn: 'rule3'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('100'); // Should use preferred priority
    });

    test('Falls back to next available when preferred priority is taken', async () => {
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
          PreferredPriority: '2',
        },
      };

      // Mock: ALB has priorities 1, 2, 3 (preferred priority 2 is taken)
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: '1', RuleArn: 'rule1'},
          {Priority: '2', RuleArn: 'rule2'},
          {Priority: '3', RuleArn: 'rule3'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('4'); // Next available after 1,2,3
    });

    test('Returns error when ALB query fails', async () => {
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
        },
      };

      // Mock: ALB query fails
      elbv2Mock
        .on(DescribeRulesCommand)
        .rejects(new Error('Listener not found'));

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('FAILED');
      expect(result.Reason).toContain('Listener not found');
    });
  });

  describe('Handler - UPDATE operation', () => {
    test('Keeps same priority when ServiceIdentifier unchanged', async () => {
      const event = {
        RequestType: 'Update' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'alb-priority-my-service-stack-abc123',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
        },
        OldResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
          Priority: '5',
        },
      };

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('5'); // Should keep same priority
      expect(elbv2Mock).not.toHaveReceivedCommand(DescribeRulesCommand); // No ALB query needed
    });

    test('Allocates new priority when ServiceIdentifier changed', async () => {
      const event = {
        RequestType: 'Update' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'alb-priority-old-service',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'new-service-stack-xyz789',
        },
        OldResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'old-service-stack-abc123',
          Priority: '5',
        },
      };

      // Mock: ALB has priorities 1, 2, 3
      elbv2Mock.on(DescribeRulesCommand).resolves({
        Rules: [
          {Priority: '1', RuleArn: 'rule1'},
          {Priority: '2', RuleArn: 'rule2'},
          {Priority: '3', RuleArn: 'rule3'},
        ],
        $metadata: {},
      } as DescribeRulesCommandOutput);

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.Priority).toBe('4'); // New allocation
      expect(result.PhysicalResourceId).toBe(
        'alb-priority-new-service-stack-xyz789',
      );
    });
  });

  describe('Handler - DELETE operation', () => {
    test('Returns success without cleanup', async () => {
      const event = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://cloudformation-response.example.com',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/id',
        RequestId: 'request-id',
        ResourceType: 'Custom::PriorityAllocator',
        LogicalResourceId: 'PriorityAllocator',
        PhysicalResourceId: 'alb-priority-my-service-stack-abc123',
        ResourceProperties: {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-alb/abc/def',
          ServiceIdentifier: 'my-service-stack-abc123',
        },
      };

      const result = await handlerModule.handler(event);

      expect(result.Status).toBe('SUCCESS');
      expect(elbv2Mock).not.toHaveReceivedCommand(DescribeRulesCommand); // No ALB queries
    });
  });
});
