import {test, expect} from 'vitest';
import {App} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {
  AwsWorkspacesFoundationStack,
  AwsWorkspacesUserStack,
} from './aws-workspaces-stack.js';

function makeFoundationStack(extraProps = {}) {
  const app = new App();
  return new AwsWorkspacesFoundationStack(app, 'TestStack', {
    env: {account: '123456789012', region: 'us-east-2'},
    directory: {existingDirectoryId: 'd-1234567890'},
    ...extraProps,
  });
}

test('synthesizes KMS key with rotation', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::KMS::Key', {
    EnableKeyRotation: true,
  });
});

test('synthesizes VPC with isolated subnets', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::VPC', 1);
  template.hasResourceProperties('AWS::EC2::Subnet', {
    MapPublicIpOnLaunch: false,
  });
});

test('synthesizes S3 storage bucket with RETAIN policy', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  const buckets = template.findResources('AWS::S3::Bucket');
  const retainBuckets = Object.values(buckets).filter(
    (b) => (b as {DeletionPolicy?: string}).DeletionPolicy === 'Retain',
  );
  expect(retainBuckets.length).toBeGreaterThanOrEqual(1);
});

test('synthesizes WorkSpaces IAM role', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'workspaces_DefaultRole',
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {Service: 'workspaces.amazonaws.com'},
        },
      ],
    },
  });
});

test('foundation stack contains no WorkSpace resources', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::WorkSpaces::Workspace', 0);
});

test('WorkSpace resource created in user stack', () => {
  const app = new App();
  const stack = new AwsWorkspacesUserStack(app, 'UserStack', {
    env: {account: '123456789012', region: 'us-east-2'},
    directoryId: 'd-1234567890',
    kmsKeyArn: 'arn:aws:kms:us-east-2:123456789012:key/test-key-id',
    patchGroupName: 'TestStack-workspaces',
    userName: 'testuser',
    bundleId: 'wsb-g5rbnq51n',
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::WorkSpaces::Workspace', 1);
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    UserName: 'testuser',
    RootVolumeEncryptionEnabled: true,
    UserVolumeEncryptionEnabled: true,
  });
});

test('flow logs created for new VPC', () => {
  const stack = makeFoundationStack();
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::FlowLog', 2);
});

test('no flow logs created when using existing VPC', () => {
  const app = new App();
  const stack = new AwsWorkspacesFoundationStack(app, 'TestStack', {
    env: {account: '123456789012', region: 'us-east-2'},
    networking: {existingVpcId: 'vpc-existing'},
    directory: {existingDirectoryId: 'd-1234567890'},
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::FlowLog', 0);
});
