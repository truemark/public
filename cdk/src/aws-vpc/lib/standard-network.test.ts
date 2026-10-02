import {Match, Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {StandardNetwork} from './standard-network';

test('Happy path test for StandardNetwork', () => {
  const stack = HelperTest.stack();
  new StandardNetwork(stack, 'TestNetwork', {
    name: 'TestNetwork',
    vpcCidr: '10.0.0.0/16',
    azCount: 3,
    natType: 'nat_instance',
  });
  const template = Template.fromStack(stack);

  // One VPC named as configured.
  template.resourceCountIs('AWS::EC2::VPC', 1);
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.0.0.0/16',
    Tags: Match.arrayWith([{Key: 'Name', Value: 'TestNetwork'}]),
  });

  // Five default subnet groups (public, private, intra, database,
  // elasticache; redshift is off by default) across 3 AZs => 15 subnets.
  template.resourceCountIs('AWS::EC2::Subnet', 15);

  // natType defaults to 'none', so no NAT gateways are created.
  template.resourceCountIs('AWS::EC2::NatGateway', 0);

  // S3 and DynamoDB gateway endpoints are created by default.
  template.resourceCountIs('AWS::EC2::VPCEndpoint', 2);

  // SSM parameters are published for the VPC and subnet groups.
  expect(
    Object.keys(template.findResources('AWS::SSM::Parameter')).length,
  ).toBeGreaterThan(0);

  // CloudFormation outputs are exported for the VPC and subnet IDs.
  template.hasOutput('*', {
    Export: {Name: `${stack.stackName}:VpcId`},
  });
});

test('StandardNetwork with IPv6 enabled', () => {
  const stack = HelperTest.stack();
  new StandardNetwork(stack, 'TestNetworkIpv6', {
    name: 'TestNetworkIpv6',
    vpcCidr: '10.0.0.0/20',
    azCount: 2,
    enableIpv6: true,
  });
  const template = Template.fromStack(stack);

  // Verify VPC has IPv6 enabled (dual-stack mode)
  template.resourceCountIs('AWS::EC2::VPC', 1);
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.0.0.0/20',
  });

  // Verify IPv6 CIDR block is associated with the VPC
  template.resourceCountIs('AWS::EC2::VPCCidrBlock', 1);
  template.hasResourceProperties('AWS::EC2::VPCCidrBlock', {
    AmazonProvidedIpv6CidrBlock: true,
  });

  // Five default subnet groups across 2 AZs => 10 subnets
  template.resourceCountIs('AWS::EC2::Subnet', 10);
});
