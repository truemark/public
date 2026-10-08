import {Match, Template} from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {NatInstance} from './nat-instance';

test('NatInstance rejects empty instanceTypes array', () => {
  const stack = HelperTest.stack();
  const vpc = new ec2.Vpc(stack, 'TestVpc', {
    maxAzs: 2,
    natGateways: 0,
  });

  const publicSubnet = vpc.publicSubnets[0];
  const privateSubnetCidrBlocks = vpc.privateSubnets.map(
    (s) => s.ipv4CidrBlock,
  );

  expect(() => {
    new NatInstance(stack, 'TestNatInstance', {
      vpc,
      publicSubnet,
      privateSubnetCidrBlocks,
      instanceTypes: [], // Explicitly empty array should be rejected
    });
  }).toThrow(/instanceTypes must contain at least one instance type.*default/i);
});

test('NatInstance accepts valid instanceTypes array', () => {
  const stack = HelperTest.stack();
  const vpc = new ec2.Vpc(stack, 'TestVpc', {
    maxAzs: 2,
    natGateways: 0,
  });

  const publicSubnet = vpc.publicSubnets[0];
  const privateSubnetCidrBlocks = vpc.privateSubnets.map(
    (s) => s.ipv4CidrBlock,
  );

  // Should not throw with valid instance types
  expect(() => {
    new NatInstance(stack, 'TestNatInstance', {
      vpc,
      publicSubnet,
      privateSubnetCidrBlocks,
      instanceTypes: [
        new ec2.InstanceType('t4g.micro'),
        new ec2.InstanceType('t4g.small'),
      ],
    });
  }).not.toThrow();
});

test('NatInstance creates required infrastructure', () => {
  const stack = HelperTest.stack();
  const vpc = new ec2.Vpc(stack, 'TestVpc', {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      {
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: 'Private',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
    ],
  });

  const publicSubnet = vpc.publicSubnets[0];
  const privateSubnetCidrBlocks = vpc.privateSubnets.map(
    (s) => s.ipv4CidrBlock,
  );
  const privateRouteTableIds = vpc.privateSubnets.map(
    (s) => s.routeTable.routeTableId,
  );

  new NatInstance(stack, 'TestNatInstance', {
    vpc,
    publicSubnet,
    privateSubnetCidrBlocks,
    privateRouteTableIds,
  });

  const template = Template.fromStack(stack);

  // Verify ENI is created with SourceDestCheck disabled
  template.hasResourceProperties('AWS::EC2::NetworkInterface', {
    SourceDestCheck: false,
    SubnetId: Match.anyValue(),
  });

  // Verify Auto Scaling Group is created
  template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
  template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
    MinSize: '1',
    MaxSize: '1',
    DesiredCapacity: '1',
  });

  // Verify Launch Template is created
  template.resourceCountIs('AWS::EC2::LaunchTemplate', 1);

  // Verify IAM role is created with required permissions
  template.resourceCountIs('AWS::IAM::Role', 1);
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Principal: {Service: 'ec2.amazonaws.com'},
        }),
      ]),
    }),
  });

  // Verify security group is created
  template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupDescription: Match.stringLikeRegexp('NAT'),
  });

  // Verify default routes (0.0.0.0/0) targeting the ENI are created
  const allRoutes = template.findResources('AWS::EC2::Route', {
    Properties: {
      DestinationCidrBlock: '0.0.0.0/0',
    },
  });
  // Filter to only NAT instance routes (those with NetworkInterfaceId, not GatewayId)
  const natRoutes = Object.values(allRoutes).filter(
    (route: any) => route.Properties.NetworkInterfaceId !== undefined,
  );
  // Should have one route per private subnet (2 in this test)
  expect(natRoutes.length).toBe(2);
});
