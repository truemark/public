import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {Code} from 'aws-cdk-lib/aws-lambda';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {beforeAll, describe, expect, test} from 'vitest';
import {DatabaseCollectorStack} from './database-collector-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

let template: Template;

beforeAll(() => {
  // Stands in for the Gradle-built zip so these tests do not need a JDK.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-collector-'));
  fs.writeFileSync(path.join(dir, 'placeholder.txt'), '');

  const app = new ExtendedApp({
    ...TEST_ENV,
    // Skip esbuild bundling of the registrar; only the template is asserted.
    context: {'aws:cdk:bundling-stacks': []},
  });
  const stack = new DatabaseCollectorStack(app, 'DatabaseCollector', {
    env: TEST_ENV,
    vpcId: 'vpc-00000000000000000',
    subnetIds: ['subnet-00000000000000001', 'subnet-00000000000000002'],
    collectorCode: Code.fromAsset(dir),
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

  test('schedules are reconciled hourly', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
    });
  });
});
