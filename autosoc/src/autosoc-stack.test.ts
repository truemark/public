import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {beforeEach, describe, expect, test} from 'vitest';
import {type AutoSocSiemProps, AutoSocStack} from './autosoc-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

function synth(
  context: Record<string, unknown> = {},
  siem?: AutoSocSiemProps,
): Template {
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
  const stack = new AutoSocStack(app, 'AutoSoc', {env: TEST_ENV, siem});
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

  test('does not create a Security Lake subscriber by default', () => {
    template.resourceCountIs('AWS::SecurityLake::Subscriber', 0);
    template.resourceCountIs('AWS::SecurityLake::SubscriberNotification', 0);
  });

  test('creates a Security Lake subscriber when SIEM context is supplied', () => {
    const withSub = synth({
      siemSubscriberAccountId: '222222222222',
      siemSubscriberExternalId: 'supersecretexternalid',
    });
    withSub.resourceCountIs('AWS::SecurityLake::Subscriber', 1);
    withSub.resourceCountIs('AWS::SecurityLake::SubscriberNotification', 1);
    withSub.hasResourceProperties('AWS::SecurityLake::Subscriber', {
      SubscriberName: 'autosoc-siem',
      AccessTypes: ['S3'],
      SubscriberIdentity: {
        ExternalId: 'supersecretexternalid',
        Principal: '222222222222',
      },
    });
    withSub.hasResourceProperties('AWS::SecurityLake::SubscriberNotification', {
      NotificationConfiguration: {SqsNotificationConfiguration: {}},
    });
    // Subscriber role / external-id / queue ARN are still exported as
    // CfnOutputs for operator visibility, even though AutoSocSiemConstruct
    // (when `props.siem` is supplied) now consumes them as direct
    // construct references rather than via these exports.
    const outputs = withSub.toJSON().Outputs ?? {};
    const exportNames = Object.values(outputs).map(
      (o) => (o as {Export?: {Name: string}}).Export?.Name,
    );
    expect(exportNames).toEqual(
      expect.arrayContaining([
        'AutoSoc-SecurityLakeSubscriberRoleArn',
        'AutoSoc-SecurityLakeSubscriberExternalId',
        'AutoSoc-SecurityLakeSubscriberNotificationQueueArn',
      ]),
    );
  });

  test('rejects a Security Lake external id outside aes-siem allowed characters', () => {
    expect(() =>
      synth({
        siemSubscriberAccountId: '222222222222',
        siemSubscriberExternalId: 'external-id-with-hyphens',
      }),
    ).toThrow(/must be alphanumeric only/);
  });

  test('does not nest the aes-siem template when `siem` prop is omitted', () => {
    template.resourceCountIs('AWS::CloudFormation::Stack', 0);
  });

  test('nests the aes-siem template in the same stack when `siem` prop is supplied', () => {
    const withSiem = synth(undefined, {snsEmail: 'ops@example.com'});
    withSiem.resourceCountIs('AWS::SecurityLake::DataLake', 1);
    withSiem.resourceCountIs('AWS::CloudFormation::Stack', 1);
    withSiem.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        SnsEmail: 'ops@example.com',
        // No subscriber was created (no siemSubscriberAccountId /
        // siemSubscriberExternalId context), so these are blank.
        SecurityLakeRoleArn: '',
        SecurityLakeExternalId: '',
        SecurityLakeSubscriberSqs: '',
      }),
    });
  });

  test('wires the Security Lake subscriber directly into the nested SIEM template as construct references, not stack exports', () => {
    const withBoth = synth(
      {
        siemSubscriberAccountId: '222222222222',
        siemSubscriberExternalId: 'supersecretexternalid',
      },
      {snsEmail: 'ops@example.com'},
    );
    withBoth.resourceCountIs('AWS::SecurityLake::Subscriber', 1);
    withBoth.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        SecurityLakeExternalId: 'supersecretexternalid',
        SecurityLakeRoleArn: Match.anyValue(),
        SecurityLakeSubscriberSqs: Match.anyValue(),
      }),
    });
    // Being in the same stack, the role ARN threaded through is a direct
    // `Fn::GetAtt` on the in-stack subscriber resource, not an
    // `Fn::ImportValue` cross-stack reference.
    const json = JSON.stringify(withBoth.toJSON());
    expect(json).not.toContain('Fn::ImportValue');
  });
});
