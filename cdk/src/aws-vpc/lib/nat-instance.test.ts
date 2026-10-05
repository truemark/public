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
