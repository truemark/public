import {Match, Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {AwsLogSourceName, StandardSecurityLake} from './standard-security-lake';

test('Test StandardSecurityLake default', () => {
  const stack = HelperTest.stack();
  new StandardSecurityLake(stack, 'TestSecurityLake');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SecurityLake::DataLake', 1);
  template.resourceCountIs('AWS::IAM::Role', 1);
  template.resourceCountIs('AWS::SecurityLake::AwsLogSource', 0);
});

test('Test StandardSecurityLake with log sources, lifecycle, and replication', () => {
  const stack = HelperTest.stack();
  new StandardSecurityLake(stack, 'TestSecurityLake', {
    kmsKeyId: 'S3_MANAGED_KEY',
    lifecycle: {
      expirationDays: 365,
      transitions: [{days: 30, storageClass: 'STANDARD_IA'}],
    },
    replication: {
      regions: ['us-west-2'],
    },
    logSources: [
      {sourceName: AwsLogSourceName.CLOUD_TRAIL_MGMT},
      {sourceName: AwsLogSourceName.VPC_FLOW, sourceVersion: '2.0'},
    ],
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SecurityLake::DataLake', 1);
  template.resourceCountIs('AWS::SecurityLake::AwsLogSource', 2);
  template.resourceCountIs('AWS::IAM::Role', 2);
  template.hasResourceProperties('AWS::SecurityLake::DataLake', {
    EncryptionConfiguration: {KmsKeyId: 'S3_MANAGED_KEY'},
    LifecycleConfiguration: {
      Expiration: {Days: 365},
      Transitions: Match.arrayWith([
        Match.objectLike({Days: 30, StorageClass: 'STANDARD_IA'}),
      ]),
    },
    ReplicationConfiguration: Match.objectLike({Regions: ['us-west-2']}),
  });
});

test('Test StandardSecurityLake creates Lake Formation SLR when opted in', () => {
  const stack = HelperTest.stack();
  new StandardSecurityLake(stack, 'TestSecurityLake', {
    createLakeFormationServiceLinkedRole: true,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::IAM::ServiceLinkedRole', 1);
  template.hasResourceProperties('AWS::IAM::ServiceLinkedRole', {
    AWSServiceName: 'lakeformation.amazonaws.com',
  });
  template.hasResource('AWS::SecurityLake::DataLake', {
    DependsOn: Match.arrayWith([
      Match.stringLikeRegexp('.*LakeFormationServiceLinkedRole.*'),
    ]),
  });
});
