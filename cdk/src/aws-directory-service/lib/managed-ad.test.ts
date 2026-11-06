import {SecretValue} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {ManagedAd} from './managed-ad';

// Asserts that some IAM policy in the template grants the given action. Handles
// both string (single-action) and array (multi-action) Action values, since CDK
// collapses single-element action arrays to a string.
function policyWithAction(template: Template, action: string): void {
  const policies = template.findResources('AWS::IAM::Policy');
  const found = Object.values(policies).some((policy) => {
    const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
    return statements.some((s: {Action?: string | string[]}) =>
      Array.isArray(s.Action) ? s.Action.includes(action) : s.Action === action,
    );
  });
  expect(found, `expected an IAM policy granting ${action}`).toBe(true);
}

test('Create ManagedAd', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new ManagedAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::DirectoryService::MicrosoftAD', 1);
  template.hasResourceProperties('AWS::DirectoryService::MicrosoftAD', {
    Name: 'corp.example.com',
    Edition: 'Standard',
  });
});

test('ManagedAd requires at least two subnets', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  expect(
    () =>
      new ManagedAd(stack, 'Ad', {
        domainName: 'corp.example.com',
        password: SecretValue.unsafePlainText('Sup3rS3cret!'),
        vpc,
        subnets: [vpc.privateSubnets[0]],
      }),
  ).toThrow('At least 2 subnets');
});

test('ManagedAd radius enables RADIUS via custom resource', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new ManagedAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
    radius: {
      radiusServers: ['10.0.0.10'],
      sharedSecret: SecretValue.unsafePlainText('shh'),
    },
  });
  const template = Template.fromStack(stack);
  policyWithAction(template, 'ds:EnableRadius');
});

test('ManagedAd radius validates radiusTimeout bounds', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  expect(
    () =>
      new ManagedAd(stack, 'Ad', {
        domainName: 'corp.example.com',
        password: SecretValue.unsafePlainText('Sup3rS3cret!'),
        vpc,
        subnets: vpc.privateSubnets,
        radius: {
          radiusServers: ['10.0.0.10'],
          sharedSecret: SecretValue.unsafePlainText('shh'),
          radiusTimeout: 99,
        },
      }),
  ).toThrow('radiusTimeout must be between 1 and 20');
});

test('ManagedAd sso with alias enables SSO and creates an alias', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new ManagedAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
    sso: {alias: 'corp-access'},
  });
  const template = Template.fromStack(stack);
  policyWithAction(template, 'ds:EnableSso');
  policyWithAction(template, 'ds:CreateAlias');
});

test('ManagedAd logForwarding creates a log group and subscription', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new ManagedAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
    logForwarding: {},
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
  policyWithAction(template, 'ds:CreateLogSubscription');
});

test('ManagedAd sharing shares the directory with target accounts', () => {
  const stack = HelperTest.stack();
  const vpc = new Vpc(stack, 'Vpc', {maxAzs: 2});
  new ManagedAd(stack, 'Ad', {
    domainName: 'corp.example.com',
    password: SecretValue.unsafePlainText('Sup3rS3cret!'),
    vpc,
    subnets: vpc.privateSubnets,
    sharing: {targetAccountIds: ['222222222222']},
  });
  const template = Template.fromStack(stack);
  policyWithAction(template, 'ds:ShareDirectory');
});
