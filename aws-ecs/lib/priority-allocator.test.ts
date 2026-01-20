import {Template, Match} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {PriorityAllocator} from './priority-allocator';
import {Stack} from 'aws-cdk-lib';
import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {Vpc} from 'aws-cdk-lib/aws-ec2';

describe('PriorityAllocator', () => {
  test('Creates DynamoDB table, Lambda function, and Custom Resource', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
    });

    const template = Template.fromStack(stack);

    // Verify DynamoDB table ensurer (AwsCustomResource that creates table)
    template.resourceCountIs('Custom::AWS', 1);
    // The table is created/imported via AwsCustomResource, not directly as CloudFormation resource

    // Verify Lambda function (check by unique properties, VPC creates other Lambdas)
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      FunctionName: 'priority-allocator-singleton',
      Timeout: 30,
      MemorySize: 256,
    });

    // Verify Custom Resource
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      ListenerArn: Match.anyValue(),
      ServiceIdentifier: Match.stringLikeRegexp('teststack-.*'),
      TableName: 'alb-listener-priorities',
    });

    // Verify Lambda IAM permissions
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              'elasticloadbalancing:DescribeListeners',
              'elasticloadbalancing:DescribeRules',
            ],
            Effect: 'Allow',
            Resource: '*',
          }),
          Match.objectLike({
            Action: [
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:DeleteItem',
            ],
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('Creates outputs for debugging', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
    });

    const template = Template.fromStack(stack);

    // Verify outputs exist (outputs are prefixed with construct path)
    const outputs = template.toJSON().Outputs;
    const outputKeys = Object.keys(outputs);

    // Find outputs that match our descriptions
    const serviceIdOutput = outputKeys.find(
      (key) =>
        outputs[key].Description ===
        'Service identifier for priority allocation tracking',
    );
    const priorityOutput = outputKeys.find(
      (key) =>
        outputs[key].Description ===
        'Auto-allocated priority for ALB listener rule',
    );

    expect(serviceIdOutput).toBeDefined();
    expect(priorityOutput).toBeDefined();
  });

  test('Supports preferred priority', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
      preferredPriority: 100,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      PreferredPriority: '100',
    });
  });

  test('Singleton pattern - multiple allocators share Lambda and DynamoDB', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    // Create three allocators
    new PriorityAllocator(stack, 'PriorityAllocator1', {
      listenerArn: listener.listenerArn,
    });
    new PriorityAllocator(stack, 'PriorityAllocator2', {
      listenerArn: listener.listenerArn,
    });
    new PriorityAllocator(stack, 'PriorityAllocator3', {
      listenerArn: listener.listenerArn,
    });

    const template = Template.fromStack(stack);

    // Should only have ONE PriorityAllocator Lambda (identified by name)
    // ONE table ensurer (Custom::AWS), but THREE priority allocation Custom Resources
    const lambdas = template.findResources('AWS::Lambda::Function', {
      Properties: {
        FunctionName: 'priority-allocator-singleton',
      },
    });
    expect(Object.keys(lambdas).length).toBe(1);

    template.resourceCountIs('Custom::AWS', 1); // Table ensurer
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 3); // Priority allocators
  });

  test('Different stacks create separate resources (not singleton across stacks)', () => {
    const stack1 = new Stack(undefined, 'Stack1');
    const stack2 = new Stack(undefined, 'Stack2');

    const vpc1 = new Vpc(stack1, 'Vpc');
    const alb1 = new ApplicationLoadBalancer(stack1, 'ALB', {vpc: vpc1});
    const listener1 = new ApplicationListener(stack1, 'Listener', {
      loadBalancer: alb1,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    const vpc2 = new Vpc(stack2, 'Vpc');
    const alb2 = new ApplicationLoadBalancer(stack2, 'ALB', {vpc: vpc2});
    const listener2 = new ApplicationListener(stack2, 'Listener', {
      loadBalancer: alb2,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    new PriorityAllocator(stack1, 'PriorityAllocator', {
      listenerArn: listener1.listenerArn,
    });
    new PriorityAllocator(stack2, 'PriorityAllocator', {
      listenerArn: listener2.listenerArn,
    });

    const template1 = Template.fromStack(stack1);
    const template2 = Template.fromStack(stack2);

    // Each stack should have its own PriorityAllocator resources
    // (verify by checking for the unique function name and table ensurer)
    template1.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'priority-allocator-singleton',
    });
    template1.resourceCountIs('Custom::AWS', 1); // Table ensurer
    template2.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'priority-allocator-singleton',
    });
    template2.resourceCountIs('Custom::AWS', 1); // Table ensurer
  });

  test('Service identifier is deterministic and includes stack name', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    const allocator = new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
    });

    // Service identifier should include stack name and hash
    expect(allocator.serviceIdentifier).toMatch(/^teststack-[a-f0-9]{12}$/);
  });

  test('DynamoDB table ensurer has RETAIN removal policy', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
    });

    const template = Template.fromStack(stack);

    // The table ensurer (Custom::AWS) has RETAIN policy
    template.hasResource('Custom::AWS', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('Priority is extracted from custom resource', () => {
    const stack = HelperTest.stack();
    const vpc = new Vpc(stack, 'Vpc');
    const alb = new ApplicationLoadBalancer(stack, 'ALB', {vpc});
    const listener = new ApplicationListener(stack, 'Listener', {
      loadBalancer: alb,
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'OK',
      }),
    });

    const allocator = new PriorityAllocator(stack, 'PriorityAllocator', {
      listenerArn: listener.listenerArn,
    });

    // Priority should be a token (unresolved at synth time)
    expect(allocator.priority).toBeDefined();
    expect(typeof allocator.priority).toBe('number');
  });
});
