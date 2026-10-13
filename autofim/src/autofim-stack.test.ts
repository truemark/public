import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {describe, expect, test} from 'vitest';
import {AutoFimStack} from './autofim-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

function synth(
  props: {
    monitoredPath?: string;
    criticalFilePatterns?: string;
    findingSeverity?: string;
    inventorySchedule?: string;
    inventoryTagKey?: string;
    inventoryTagValue?: string;
  } = {},
): Template {
  const app = new ExtendedApp({
    account: TEST_ENV.account,
    region: TEST_ENV.region,
    standardTags: {
      automationTags: {
        id: 'autofim',
        url: 'https://github.com/truemark/public/tree/main/autofim',
      },
    },
  });
  const stack = new AutoFimStack(app, 'AutoFim', {
    env: TEST_ENV,
    monitoredPath: props.monitoredPath ?? '/etc/paymentapp/',
    criticalFilePatterns:
      props.criticalFilePatterns ?? '^/etc/paymentapp/config.*$',
    findingSeverity: props.findingSeverity,
    inventorySchedule: props.inventorySchedule,
    inventoryTagKey: props.inventoryTagKey,
    inventoryTagValue: props.inventoryTagValue,
  });
  return Template.fromStack(stack);
}

describe('AutoFimStack', () => {
  test('creates two S3 buckets (logging + inventory) both versioned', () => {
    const template = synth();
    template.resourceCountIs('AWS::S3::Bucket', 2);
    const buckets = template.findResources('AWS::S3::Bucket');
    for (const resource of Object.values(buckets)) {
      expect(
        (resource as {Properties: {VersioningConfiguration: {Status: string}}})
          .Properties.VersioningConfiguration.Status,
      ).toBe('Enabled');
    }
  });

  test('logging bucket does NOT enable Object Lock (incompatible with access logging)', () => {
    // S3 rejects server-access-log delivery to a destination bucket with
    // Object Lock enabled, so the logging bucket must not have it even
    // though "immutable logs" would otherwise be the stronger default.
    const template = synth();
    const buckets = template.findResources('AWS::S3::Bucket');
    const loggingBucket = Object.entries(buckets).find(([k]) =>
      k.startsWith('LoggingBucket'),
    );
    expect(loggingBucket).toBeDefined();
    const props = loggingBucket?.[1].Properties as {
      ObjectLockEnabled?: boolean;
    };
    expect(props.ObjectLockEnabled).toBeUndefined();
  });

  test('logging bucket enforces access-log retention via lifecycle rule', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('^fim-logs-'),
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: 'ExpireAccessLogs',
            Status: 'Enabled',
            ExpirationInDays: 365,
            NoncurrentVersionExpiration: Match.objectLike({
              NoncurrentDays: 90,
            }),
          }),
        ]),
      },
    });
  });

  test('inventory bucket allows SSM to GetBucketAcl and PutObject', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SSMBucketPermissionsCheck',
            Action: 's3:GetBucketAcl',
            Principal: {Service: 'ssm.amazonaws.com'},
          }),
          Match.objectLike({
            Sid: 'SSMBucketDelivery',
            Action: 's3:PutObject',
            Principal: {Service: 'ssm.amazonaws.com'},
          }),
        ]),
      }),
    });
  });

  test('creates the change-detector Lambda with reserved concurrency 10', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'fim-change-detector',
      Runtime: 'python3.12',
      Handler: 'lambda_function.lambda_handler',
      ReservedConcurrentExecutions: 10,
      Environment: {
        Variables: {
          CRITICAL_FILE_PATTERNS: '^/etc/paymentapp/config.*$',
          SEVERITY_LABEL: 'MEDIUM',
        },
      },
    });
  });

  test('creates a DLQ with 14-day retention', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fim-change-detector-dlq',
      MessageRetentionPeriod: 1209600,
    });
  });

  test('creates the SSM Resource Data Sync in JsonSerDe format', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SSM::ResourceDataSync', {
      SyncFormat: 'JsonSerDe',
    });
  });

  test('creates an SSM association targeting the FIM tag', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SSM::Association', {
      Name: 'AWS-GatherSoftwareInventory',
      ScheduleExpression: 'rate(30 minutes)',
      Targets: [{Key: 'tag:FIM-Enabled', Values: ['true']}],
    });
  });

  test('honors custom tag key / value / schedule overrides', () => {
    const template = synth({
      inventoryTagKey: 'Environment',
      inventoryTagValue: 'prod',
      inventorySchedule: 'rate(15 minutes)',
    });
    template.hasResourceProperties('AWS::SSM::Association', {
      ScheduleExpression: 'rate(15 minutes)',
      Targets: [{Key: 'tag:Environment', Values: ['prod']}],
    });
  });

  test('inventory bucket policy guards SSM against the confused-deputy problem', () => {
    const template = synth();
    const expectedSuffix = `:resource-data-sync/fim-inventory-sync-${TEST_ENV.account}-${TEST_ENV.region}`;
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SSMBucketPermissionsCheck',
            Condition: Match.objectLike({
              StringEquals: Match.objectLike({
                'aws:SourceAccount': TEST_ENV.account,
              }),
              ArnLike: Match.objectLike({'aws:SourceArn': Match.anyValue()}),
            }),
          }),
          Match.objectLike({
            Sid: 'SSMBucketDelivery',
            Condition: Match.objectLike({
              StringEquals: Match.objectLike({
                's3:x-amz-acl': 'bucket-owner-full-control',
                'aws:SourceAccount': TEST_ENV.account,
              }),
              ArnLike: Match.objectLike({'aws:SourceArn': Match.anyValue()}),
            }),
          }),
        ]),
      }),
    });
    // Also verify the ARN suffix is correct (the account/region/partition
    // tokens get expanded via Fn::Join when stringified by CDK).
    const bucketPolicies = template.findResources('AWS::S3::BucketPolicy');
    const serialized = JSON.stringify(Object.values(bucketPolicies));
    expect(serialized).toContain(expectedSuffix);
  });

  test('DLQ uses SQS-managed KMS encryption', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'fim-change-detector-dlq',
      KmsMasterKeyId: 'alias/aws/sqs',
    });
  });

  test('S3 -> Lambda notification is scoped to the AWS:File/ prefix', () => {
    const template = synth();
    // CDK models bucket notifications via the BucketNotifications custom
    // resource; the filter prefix lands under Lambda configurations.
    const notifs = template.findResources(
      'Custom::S3BucketNotifications',
    ) as Record<string, {Properties: {NotificationConfiguration: unknown}}>;
    const serialized = JSON.stringify(Object.values(notifs));
    expect(serialized).toContain('AWS:File/');
  });

  test('grants Lambda securityhub:BatchImportFindings', () => {
    const template = synth();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'securityhub:BatchImportFindings',
          }),
        ]),
      }),
    });
  });
});
