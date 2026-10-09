import {Match, Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {AwsLogSourceName, StandardSecurityLake} from './standard-security-lake';

test('Test StandardSecurityLake default', () => {
  const stack = HelperTest.stack();
  new StandardSecurityLake(stack, 'TestSecurityLake');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SecurityLake::DataLake', 1);
  template.resourceCountIs('AWS::IAM::Role', 1);
  template.resourceCountIs('AWS::SecurityLake::AwsLogSource', 0);
  // Security Lake's partition-updater Lambda is hard-coded to assume a role
  // named `AmazonSecurityLakeMetaStoreManagerV2` under `/service-role/`.
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'AmazonSecurityLakeMetaStoreManagerV2',
    Path: '/service-role/',
  });
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
  // Replication role name must be suffixed with the source Region so
  // deploying the construct to multiple Regions in the same account does
  // not collide on the account-global IAM role name.
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'SecurityLakeS3ReplicationRole-us-east-2',
    Path: '/service-role/',
  });
  // Log sources default `accounts` to the data-lake owner account because
  // the CFN `AWS::SecurityLake::AwsLogSource` resource requires `Accounts`.
  template.hasResourceProperties('AWS::SecurityLake::AwsLogSource', {
    SourceName: 'CLOUD_TRAIL_MGMT',
    Accounts: [Match.anyValue()],
  });
  // Replication policy must use the stack partition so `aws-cn`/`aws-us-gov`
  // deployments reference the correct ARN namespace.
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'SecurityLakeS3ReplicationRole-us-east-2',
    Policies: Match.arrayWith([
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowS3Replication',
              Resource: {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {Ref: 'AWS::Partition'},
                    ':s3:::aws-security-data-lake-us-west-2*/*',
                  ],
                ],
              },
            }),
          ]),
        }),
      }),
    ]),
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

test('Test StandardSecurityLake throws when CMK without metaStoreManagerKmsKeyArn', () => {
  const stack = HelperTest.stack();
  expect(
    () =>
      new StandardSecurityLake(stack, 'TestSecurityLake', {
        kmsKeyId:
          'arn:aws:kms:us-east-2:111111111111:key/00000000-0000-0000-0000-000000000000',
      }),
  ).toThrow(/customer-managed `kmsKeyId` requires `metaStoreManagerKmsKeyArn`/);
});

test('Test StandardSecurityLake grants metastore role KMS access on CMK', () => {
  const stack = HelperTest.stack();
  const kmsKeyArn =
    'arn:aws:kms:us-east-2:111111111111:key/cccccccc-cccc-cccc-cccc-cccccccccccc';
  new StandardSecurityLake(stack, 'TestSecurityLake', {
    kmsKeyId: kmsKeyArn,
    metaStoreManagerKmsKeyArn: kmsKeyArn,
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'AmazonSecurityLakeMetaStoreManagerV2',
    Policies: Match.arrayWith([
      Match.objectLike({
        PolicyName: 'AmazonSecurityLakeMetastoreManagerKmsPolicy',
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowMetaStoreManagerKmsAccess',
              Action: [
                'kms:Decrypt',
                'kms:Encrypt',
                'kms:GenerateDataKey',
                'kms:DescribeKey',
              ],
              Resource: kmsKeyArn,
            }),
          ]),
        }),
      }),
    ]),
  });
});

test('Test StandardSecurityLake throws when CMK + replication without KMS ARNs', () => {
  const stack = HelperTest.stack();
  expect(
    () =>
      new StandardSecurityLake(stack, 'TestSecurityLake', {
        kmsKeyId:
          'arn:aws:kms:us-east-2:111111111111:key/00000000-0000-0000-0000-000000000000',
        metaStoreManagerKmsKeyArn:
          'arn:aws:kms:us-east-2:111111111111:key/00000000-0000-0000-0000-000000000000',
        replication: {regions: ['us-west-2']},
      }),
  ).toThrow(/replication with a customer-managed `kmsKeyId`/);
});

test('Test StandardSecurityLake adds KMS statements when CMK + replication', () => {
  const stack = HelperTest.stack();
  const sourceKmsKeyArn =
    'arn:aws:kms:us-east-2:111111111111:key/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const destKmsKeyArn =
    'arn:aws:kms:us-west-2:111111111111:key/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  new StandardSecurityLake(stack, 'TestSecurityLake', {
    kmsKeyId:
      'arn:aws:kms:us-east-2:111111111111:key/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    metaStoreManagerKmsKeyArn: sourceKmsKeyArn,
    replication: {
      regions: ['us-west-2'],
      sourceKmsKeyArn,
      destinationKmsKeyArns: [destKmsKeyArn],
    },
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'SecurityLakeS3ReplicationRole-us-east-2',
    Policies: Match.arrayWith([
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'AllowDecryptSourceKmsKey',
              Action: 'kms:Decrypt',
              Resource: sourceKmsKeyArn,
            }),
            Match.objectLike({
              Sid: 'AllowEncryptDestinationKmsKeys',
              Action: ['kms:Encrypt', 'kms:GenerateDataKey'],
              Resource: destKmsKeyArn,
            }),
          ]),
        }),
      }),
    ]),
  });
});

test('Test StandardSecurityLake omits KMS statements when SSE-S3 + replication', () => {
  const stack = HelperTest.stack();
  new StandardSecurityLake(stack, 'TestSecurityLake', {
    kmsKeyId: 'S3_MANAGED_KEY',
    replication: {regions: ['us-west-2']},
  });
  const template = Template.fromStack(stack);
  const roles = template.findResources('AWS::IAM::Role', {
    Properties: {RoleName: 'SecurityLakeS3ReplicationRole-us-east-2'},
  });
  const [role] = Object.values(roles);
  const statements = (
    role.Properties.Policies as {PolicyDocument: {Statement: {Sid: string}[]}}[]
  )[0].PolicyDocument.Statement;
  expect(statements.map((s) => s.Sid)).not.toContain(
    'AllowDecryptSourceKmsKey',
  );
  expect(statements.map((s) => s.Sid)).not.toContain(
    'AllowEncryptDestinationKmsKeys',
  );
});
