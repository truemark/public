import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {beforeEach, describe, expect, test} from 'vitest';
import {AutoSocStack} from './autosoc-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

function synth(context: Record<string, unknown> = {}): Template {
  const app = new ExtendedApp({
    account: TEST_ENV.account,
    region: TEST_ENV.region,
    context,
    standardTags: {
      automationTags: {
        id: 'autosoc',
        url: 'https://github.com/truemark/public/tree/main/autosoc',
      },
    },
  });
  const stack = new AutoSocStack(app, 'AutoSoc', {env: TEST_ENV});
  return Template.fromStack(stack);
}

describe('AutoSocStack', () => {
  let template: Template;

  beforeEach(() => {
    template = synth();
  });

  test('synthesizes a single Security Lake data lake', () => {
    template.resourceCountIs('AWS::SecurityLake::DataLake', 1);
  });

  test('creates the metastore manager role pinned to the V2 name', () => {
    // Security Lake's partition-updater Lambda is hard-coded to assume a
    // role named `AmazonSecurityLakeMetaStoreManagerV2` under
    // `/service-role/`; without this exact name, partition indexing fails
    // silently and subscriber queries return no rows.
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'AmazonSecurityLakeMetaStoreManagerV2',
      Path: '/service-role/',
    });
  });

  test('enables the full set of AWS log sources chained via DependsOn', () => {
    const expectedSources = [
      'CLOUD_TRAIL_MGMT',
      'LAMBDA_EXECUTION',
      'S3_DATA',
      'SH_FINDINGS',
      'VPC_FLOW',
      'ROUTE53',
      'EKS_AUDIT',
      'WAF',
    ];
    template.resourceCountIs(
      'AWS::SecurityLake::AwsLogSource',
      expectedSources.length,
    );
    for (const sourceName of expectedSources) {
      template.hasResourceProperties('AWS::SecurityLake::AwsLogSource', {
        SourceName: sourceName,
        SourceVersion: '2.0',
        Accounts: [TEST_ENV.account],
      });
    }
    // Security Lake rejects concurrent AwsLogSource creation in the same
    // template, so each one must depend on the previous.
    const sources = template.findResources('AWS::SecurityLake::AwsLogSource');
    const sourcesWithDataLakeOnlyDep = Object.values(sources).filter((r) => {
      const deps = (r.DependsOn ?? []) as string[];
      return deps.length === 1 && deps[0].includes('DataLake');
    });
    // Only the first source should DependsOn just the data lake.
    expect(sourcesWithDataLakeOnlyDep.length).toBe(1);
  });

  test('does not create the Lake Formation SLR by default', () => {
    // Default (cdk.json ships `createLakeFormationSlr=false`) must not emit
    // an SLR, otherwise re-deploys in accounts where the role already
    // exists fail with "has been taken in this account".
    template.resourceCountIs('AWS::IAM::ServiceLinkedRole', 0);
  });

  test('creates a retained Lake Formation SLR when opted in via context', () => {
    const optedIn = synth({createLakeFormationSlr: true});
    optedIn.resourceCountIs('AWS::IAM::ServiceLinkedRole', 1);
    optedIn.hasResourceProperties('AWS::IAM::ServiceLinkedRole', {
      AWSServiceName: 'lakeformation.amazonaws.com',
    });
    // SLR must be retained so toggling the flag back off orphans the CFN
    // resource rather than deleting the account-singleton role.
    optedIn.hasResource('AWS::IAM::ServiceLinkedRole', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    optedIn.hasResource('AWS::SecurityLake::DataLake', {
      DependsOn: Match.arrayWith([
        Match.stringLikeRegexp('.*LakeFormationServiceLinkedRole.*'),
      ]),
    });
  });

  test('accepts string "true" from -c CLI context', () => {
    // CDK context values arriving from `-c createLakeFormationSlr=true`
    // on the CLI are strings, not booleans; the stack must handle both.
    const optedIn = synth({createLakeFormationSlr: 'true'});
    optedIn.resourceCountIs('AWS::IAM::ServiceLinkedRole', 1);
  });

  test('stamps automation metadata URL on the stack', () => {
    const json = template.toJSON();
    expect(json.Metadata).toMatchObject({
      URL: 'https://github.com/truemark/public/tree/main/autosoc',
    });
  });
});
