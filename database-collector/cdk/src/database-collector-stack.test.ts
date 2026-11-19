import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {Code} from 'aws-cdk-lib/aws-lambda';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {beforeAll, describe, expect, test} from 'vitest';
import {DatabaseCollectorStack} from './database-collector-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

let template: Template;
/** Directory standing in for the Gradle-built zip, so tests need no JDK. */
let placeholderDir: string;

/** A new Code instance per stack, as CDK requires. */
function placeholderCode(): Code {
  return Code.fromAsset(placeholderDir);
}

beforeAll(() => {
  placeholderDir = mkdtempSync(join(tmpdir(), 'database-collector-'));
  writeFileSync(join(placeholderDir, 'placeholder.txt'), '');

  const app = new ExtendedApp({
    ...TEST_ENV,
    // Skip esbuild bundling of the registrar; only the template is asserted.
    context: {'aws:cdk:bundling-stacks': []},
  });
  const stack = new DatabaseCollectorStack(app, 'DatabaseCollector', {
    env: TEST_ENV,
    vpcId: 'vpc-00000000000000000',
    subnetIds: ['subnet-00000000000000001', 'subnet-00000000000000002'],
    collectorCode: placeholderCode(),
  });
  template = Template.fromStack(stack);
});

describe('DatabaseCollectorStack', () => {
  test('collector runs Java 25 with SnapStart in the given subnets', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'java25',
      SnapStart: {ApplyOn: 'PublishedVersions'},
      VpcConfig: {
        SubnetIds: ['subnet-00000000000000001', 'subnet-00000000000000002'],
      },
    });
    template.hasResourceProperties('AWS::Lambda::Alias', {Name: 'live'});
  });

  test('collector alias does not retry or queue async invocations', () => {
    const [aliasId] = Object.keys(
      template.findResources('AWS::Lambda::Alias', {
        Properties: {Name: 'live'},
      }),
    );
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      // The qualifier is the last segment ("live") of the alias ARN.
      Qualifier: {'Fn::Select': [7, {'Fn::Split': [':', {Ref: aliasId}]}]},
      MaximumRetryAttempts: 0,
      MaximumEventAgeInSeconds: 60,
    });
  });

  test('collector role has a fixed name and may connect as the database user', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'database-collector-us-east-2',
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('rds-db:connect');
    expect(policies).toContain(':dbuser:*/database_collector');
  });

  test('collector may only read secrets tagged for it', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain(
      '"secretsmanager:ResourceTag/database-collector:enabled":"true"',
    );
    expect(policies).toContain(
      '"secretsmanager:ResourceTag/database-collector:allow":"true"',
    );
  });

  test('collector publishes metrics under the default namespace', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'java25',
      Environment: {Variables: {METRICS_NAMESPACE: 'DatabaseCollector'}},
      LoggingConfig: Match.objectLike({LogFormat: 'Text'}),
    });
  });

  test('tag changes on RDS instances and secrets reach the registrar', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.tag'],
        detail: Match.objectLike({
          service: ['rds', 'secretsmanager'],
          'changed-tag-keys': [{prefix: 'database-collector:'}],
        }),
      },
    });
  });

  test('collector is told where custom query sets are kept', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'java25',
      Environment: {
        Variables: Match.objectLike({
          QUERY_SET_BUCKET: {Ref: Match.stringLikeRegexp('QuerySetBucket')},
          QUERY_SET_PARAMETER_PATH: '/database-collector/query-sets',
        }),
      },
    });
  });

  test('query set bucket is private, versioned and retained', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        VersioningConfiguration: {Status: 'Enabled'},
        PublicAccessBlockConfiguration: Match.objectLike({
          BlockPublicAcls: true,
          RestrictPublicBuckets: true,
        }),
      }),
    });
  });

  test('collector may only read query sets', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('/query-sets/*');
    expect(policies).toContain(':parameter/database-collector/query-sets/*');
    expect(policies).not.toContain('"s3:PutObject');
    expect(policies).not.toContain('"ssm:PutParameter"');
  });

  test('nothing is uploaded without querySetsDir', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 0);
  });

  test('querySetsDir uploads YAML files without deleting other sets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'query-sets-'));
    writeFileSync(join(dir, 'orders.yaml'), '[]');
    const app = new ExtendedApp({
      ...TEST_ENV,
      context: {'aws:cdk:bundling-stacks': []},
    });
    const stack = new DatabaseCollectorStack(app, 'WithQuerySets', {
      env: TEST_ENV,
      vpcId: 'vpc-00000000000000000',
      subnetIds: ['subnet-00000000000000001'],
      querySetsDir: dir,
      collectorCode: placeholderCode(),
    });
    Template.fromStack(stack).hasResourceProperties(
      'Custom::CDKBucketDeployment',
      {
        DestinationBucketKeyPrefix: 'query-sets/',
        Exclude: ['*'],
        Include: ['*.yaml'],
        Prune: false,
      },
    );
  });

  test('rejects an invalid parameter path', () => {
    const app = new ExtendedApp({...TEST_ENV});
    expect(
      () =>
        new DatabaseCollectorStack(app, 'Invalid', {
          env: TEST_ENV,
          vpcId: 'vpc-00000000000000000',
          subnetIds: ['subnet-00000000000000001'],
          querySetParameterPath: 'no-leading-slash',
          collectorCode: placeholderCode(),
        }),
    ).toThrow(/querySetParameterPath/);
  });

  test('schedules are reconciled hourly', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
    });
  });
});
