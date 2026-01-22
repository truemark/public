import {test, expect} from 'vitest';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {StandardFargateRunTask} from './standard-fargate-runtask';
import {Cluster, ContainerImage} from 'aws-cdk-lib/aws-ecs';
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import {Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';

test('Create StandardFargateRunTask with minimal configuration', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
  });

  const template = Template.fromStack(stack);

  // Verify task definition is created
  template.resourceCountIs('AWS::ECS::TaskDefinition', 1);

  // Verify security group is created
  template.resourceCountIs('AWS::EC2::SecurityGroup', 1);

  // Verify log group is created (default behavior)
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
});

test('Task Definition has correct Fargate configuration', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    cpu: 512,
    memoryLimitMiB: 1024,
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '512',
    Memory: '1024',
    NetworkMode: 'awsvpc',
    RequiresCompatibilities: ['FARGATE'],
  });
});

test('Container definition has correct configuration', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('nginx:latest'),
    containerName: 'my-container',
    environment: {
      ENV_VAR: 'value',
    },
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: [
      Match.objectLike({
        Name: 'my-container',
        Image: Match.stringLikeRegexp('nginx'),
        Environment: Match.arrayWith([
          {
            Name: 'ENV_VAR',
            Value: 'value',
          },
        ]),
      }),
    ],
  });
});

test('Log configuration is applied when enabled', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    logConfiguration: {
      enabled: true,
    },
  });

  const template = Template.fromStack(stack);

  // Verify log group is created
  template.resourceCountIs('AWS::Logs::LogGroup', 1);

  // Verify container has log configuration
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: [
      Match.objectLike({
        LogConfiguration: {
          LogDriver: 'awslogs',
          Options: Match.objectLike({
            'awslogs-stream-prefix': Match.anyValue(),
          }),
        },
      }),
    ],
  });
});

test('Log configuration is not created when disabled', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    logConfiguration: {
      enabled: false,
    },
  });

  const template = Template.fromStack(stack);

  // Verify no log group is created
  template.resourceCountIs('AWS::Logs::LogGroup', 0);
});

test('grantRunTask creates correct IAM policies', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const runTask = new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
  });

  const role = new Role(stack, 'TestRole', {
    assumedBy: new ServicePrincipal('states.amazonaws.com'),
  });

  runTask.grantRunTask(role);

  const template = Template.fromStack(stack);

  // Verify IAM policy for ecs:RunTask
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'ecs:RunTask',
          Effect: 'Allow',
          Resource: Match.anyValue(),
        }),
      ]),
    },
  });

  // Verify IAM policy for iam:PassRole
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'iam:PassRole',
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('grantRunTask via constructor creates correct IAM policies', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const role = new Role(stack, 'TestRole', {
    assumedBy: new ServicePrincipal('states.amazonaws.com'),
  });

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    grantPrincipal: role,
  });

  const template = Template.fromStack(stack);

  // Verify IAM policies are created
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'ecs:RunTask',
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('Security group allows all outbound traffic by default', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    SecurityGroupEgress: [
      {
        CidrIp: '0.0.0.0/0',
        Description: 'Allow all outbound traffic by default',
        IpProtocol: '-1',
      },
    ],
  });
});

test('Container command and entrypoint are configured correctly', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    entryPoint: ['sh', '-c'],
    command: ['echo "Hello World"'],
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: [
      Match.objectLike({
        EntryPoint: ['sh', '-c'],
        Command: ['echo "Hello World"'],
      }),
    ],
  });
});

test('Custom VPC subnets are configured correctly', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const runTask = new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    vpcSubnets: {
      subnetType: vpc.privateSubnets[0].subnetType,
    },
  });

  // Verify that vpcSubnets property is set
  expect(runTask.vpcSubnets).toBeDefined();
});

test('Task definition with custom task role', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const taskRole = new Role(stack, 'CustomTaskRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
  });

  new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    taskRole,
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    TaskRoleArn: {
      'Fn::GetAtt': [Match.stringLikeRegexp('CustomTaskRole'), 'Arn'],
    },
  });
});

test('Public IP assignment is configurable', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const runTask = new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
    assignPublicIp: true,
  });

  expect(runTask.assignPublicIp).toBe(true);
});

test('Container name defaults to "Container" when not specified', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'TestVpc');
  const cluster = new Cluster(stack, 'TestCluster', {vpc});

  const runTask = new StandardFargateRunTask(stack, 'TestRunTask', {
    cluster,
    image: ContainerImage.fromRegistry('alpine:latest'),
  });

  expect(runTask.containerName).toBe('Container');

  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: [
      Match.objectLike({
        Name: 'Container',
      }),
    ],
  });
});
