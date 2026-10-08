import {SecretValue} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {SimpleAd} from './simple-ad';

test('Create SimpleAd', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new SimpleAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::DirectoryService::SimpleAD', 1);
  template.hasResourceProperties('AWS::DirectoryService::SimpleAD', {
    Name: 'corp.example.com',
    Size: 'Small',
  });
});

test('SimpleAd requires at least two subnets', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  expect(
    () =>
      new SimpleAd(stack, 'Ad', {
        domainName: 'corp.example.com',
        password: SecretValue.unsafePlainText('Sup3rS3cret!'),
        vpc,
        subnets: [vpc.privateSubnets[0]],
      }),
  ).toThrow('At least 2 subnets');
});
