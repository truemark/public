import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {beforeEach, describe, expect, test} from 'vitest';
import {AutoSocSecurityLakeStack} from './autosoc-stack.js';

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
  const stack = new AutoSocSecurityLakeStack(app, 'AutoSocSecurityLake', {
    env: TEST_ENV,
  });
  return Template.fromStack(stack);
}

describe('AutoSocSecurityLakeStack', () => {
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
      SubscriberName: 'autosiem',
      AccessTypes: ['S3'],
      SubscriberIdentity: {
        ExternalId: 'supersecretexternalid',
        Principal: '222222222222',
      },
    });
    withSub.hasResourceProperties('AWS::SecurityLake::SubscriberNotification', {
      NotificationConfiguration: {SqsNotificationConfiguration: {}},
    });
    // Subscriber role / external-id / queue ARN are exported as CfnOutputs
    // for the operator to copy into the separate `autosiem` package's
    // deploy (there is no CloudFormation cross-stack link between the two
    // independent apps/stacks).
    const outputs = withSub.toJSON().Outputs ?? {};
    const exportNames = Object.values(outputs).map(
      (o) => (o as {Export?: {Name: string}}).Export?.Name,
    );
    expect(exportNames).toEqual(
      expect.arrayContaining([
        'AutoSocSecurityLake-SecurityLakeSubscriberRoleArn',
        'AutoSocSecurityLake-SecurityLakeSubscriberExternalId',
        'AutoSocSecurityLake-SecurityLakeSubscriberNotificationQueueArn',
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

  test('does not create any nested CloudFormation stacks (SIEM lives in the separate autosiem package)', () => {
    template.resourceCountIs('AWS::CloudFormation::Stack', 0);
  });

  test('does not touch Lake Formation data lake administrators by default', () => {
    template.resourceCountIs('AWS::LakeFormation::DataLakeSettings', 0);
  });

  test('appends Lake Formation data lake administrators when supplied, without replacing existing ones', () => {
    const withAdmins = synth({
      lakeFormationDataLakeAdmins:
        'arn:aws:iam::100000000000:role/Administrator,arn:aws:iam::100000000000:role/SecurityEngineer',
    });
    withAdmins.resourceCountIs('AWS::LakeFormation::DataLakeSettings', 1);
    withAdmins.hasResourceProperties('AWS::LakeFormation::DataLakeSettings', {
      // APPEND, not the default REPLACE: the account already has
      // AmazonSecurityLakeMetaStoreManagerV2 and the CDK bootstrap exec
      // role registered as administrators, and this must not revoke them.
      MutationType: 'APPEND',
      Admins: [
        {
          DataLakePrincipalIdentifier:
            'arn:aws:iam::100000000000:role/Administrator',
        },
        {
          DataLakePrincipalIdentifier:
            'arn:aws:iam::100000000000:role/SecurityEngineer',
        },
      ],
    });
  });

  test('rejects a Lake Formation admin principal that is not an IAM role/user ARN', () => {
    expect(() => synth({lakeFormationDataLakeAdmins: 'not-an-arn'})).toThrow(
      /invalid Lake Formation admin principal/,
    );
  });

  test('always creates an encrypted Athena results bucket and workgroup', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {SSEAlgorithm: 'AES256'},
          }),
        ]),
      }),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({Id: 'ExpireQueryResults', Status: 'Enabled'}),
        ]),
      },
    });
    template.resourceCountIs('AWS::Athena::WorkGroup', 1);
    template.hasResourceProperties('AWS::Athena::WorkGroup', {
      Name: 'security-lake-queries',
      WorkGroupConfiguration: {
        EnforceWorkGroupConfiguration: true,
        ResultConfiguration: Match.objectLike({
          OutputLocation: Match.anyValue(),
        }),
      },
    });
    template.hasResource('AWS::Athena::WorkGroup', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('rejects createAthenaWorkGroup=false without an existing results bucket name', () => {
    // Reusing a retained workgroup without also reusing its original
    // results bucket would leave the (unmodified) workgroup writing to a
    // bucket this stack no longer manages or reports via
    // AthenaResultsBucketName — fail fast instead of synthesizing that
    // mismatch silently.
    expect(() => synth({createAthenaWorkGroup: false})).toThrow(
      /createAthenaWorkGroup=false requires existingAthenaResultsBucketName/,
    );
  });

  test('skips creating the Athena workgroup and bucket when told both already exist', () => {
    // A workgroup retained by a prior `cdk destroy` (RemovalPolicy.RETAIN
    // above) collides with a same-named redeploy attempt, since
    // CloudFormation cannot auto-generate an Athena workgroup name the way
    // it does for the results bucket. `createAthenaWorkGroup=false` plus
    // `existingAthenaResultsBucketName` lets the operator reuse both the
    // retained workgroup and the bucket its OutputLocation already points
    // at, instead of creating a second bucket the workgroup never uses.
    const skipped = synth({
      createAthenaWorkGroup: false,
      existingAthenaResultsBucketName: 'pre-existing-results-bucket',
    });
    skipped.resourceCountIs('AWS::Athena::WorkGroup', 0);
    skipped.resourceCountIs('AWS::S3::Bucket', 0);
    // Outputs must reflect the real (pre-existing) names even though this
    // stack didn't create either resource.
    const outputs = skipped.toJSON().Outputs ?? {};
    expect((outputs.AthenaWorkGroupName as {Value: string}).Value).toBe(
      'security-lake-queries',
    );
    expect((outputs.AthenaResultsBucketName as {Value: string}).Value).toBe(
      'pre-existing-results-bucket',
    );
  });

  test('accepts a custom Athena workgroup name', () => {
    const custom = synth({athenaWorkGroupName: 'custom-queries'});
    custom.hasResourceProperties('AWS::Athena::WorkGroup', {
      Name: 'custom-queries',
    });
    const outputs = custom.toJSON().Outputs ?? {};
    expect((outputs.AthenaWorkGroupName as {Value: string}).Value).toBe(
      'custom-queries',
    );
  });
});
