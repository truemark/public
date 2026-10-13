import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {describe, expect, test} from 'vitest';
import {
  AES_SIEM_TEMPLATE_VERSION,
  AesSiemTemplateSource,
  AutoSocSiemStack,
  type AutoSocSiemStackProps,
} from './autosoc-siem-stack.js';

const TEST_ENV = {account: '100000000000', region: 'us-east-2'};

function synthSiem(
  overrides: Partial<Omit<AutoSocSiemStackProps, 'snsEmail'>> & {
    snsEmail?: string;
  } = {},
): Template {
  const app = new ExtendedApp({
    account: TEST_ENV.account,
    region: TEST_ENV.region,
  });
  const stack = new AutoSocSiemStack(app, 'AutoSocSiem', {
    env: TEST_ENV,
    snsEmail: 'ops@example.com',
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe('AutoSocSiemStack', () => {
  test('nests the aes-siem CloudFormation template with required parameters', () => {
    const template = synthSiem();
    template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      TemplateURL: Match.anyValue(),
      Parameters: Match.objectLike({
        DeploymentTarget: 'opensearch_managed_cluster',
        DomainOrCollectionName: 'aes-siem',
        SnsEmail: 'ops@example.com',
        AllowedSourceIpAddresses: '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',
        GeoLite2LicenseKey: Match.anyValue(),
        ReservedConcurrency: '10',
        SecurityLakeRoleArn: '',
        SecurityLakeExternalId: '',
        SecurityLakeSubscriberSqs: '',
      }),
    });
  });

  test('propagates optional overrides into template parameters', () => {
    const template = synthSiem({
      allowedSourceIpAddresses: '203.0.113.0/24',
      deploymentTarget: 'opensearch_serverless',
      domainOrCollectionName: 'autosoc-siem',
      esLoaderReservedConcurrency: 25,
    });
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        DeploymentTarget: 'opensearch_serverless',
        DomainOrCollectionName: 'autosoc-siem',
        AllowedSourceIpAddresses: '203.0.113.0/24',
        ReservedConcurrency: '25',
      }),
    });
  });

  test('passes secret values through NoEcho parent parameters', () => {
    const template = synthSiem();
    const json = template.toJSON();
    expect(json.Parameters).toMatchObject({
      GeoLite2LicenseKey: {Type: 'String', Default: '', NoEcho: true},
      OtxApiKey: {Type: 'String', Default: '', NoEcho: true},
    });
    const [nested] = Object.values(
      template.findResources('AWS::CloudFormation::Stack'),
    );
    expect(nested.Properties.Parameters.GeoLite2LicenseKey).toEqual({
      Ref: 'GeoLite2LicenseKey',
    });
    expect(nested.Properties.Parameters.OtxApiKey).toEqual({
      Ref: 'OtxApiKey',
    });
  });

  test('threads Security Lake subscriber ARNs into aes-siem parameters', () => {
    const template = synthSiem({
      securityLakeSubscriberRoleArn:
        'arn:aws:iam::100000000000:role/AmazonSecurityLake-11111111-2222-3333-4444-555555555555',
      securityLakeSubscriberExternalId: 'secretexternalid',
      securityLakeSubscriberSqsArn:
        'arn:aws:sqs:us-east-2:100000000000:AmazonSecurityLake-11111111-2222-3333-4444-555555555555-Main-Queue',
    });
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        SecurityLakeRoleArn:
          'arn:aws:iam::100000000000:role/AmazonSecurityLake-11111111-2222-3333-4444-555555555555',
        SecurityLakeExternalId: 'secretexternalid',
        SecurityLakeSubscriberSqs:
          'arn:aws:sqs:us-east-2:100000000000:AmazonSecurityLake-11111111-2222-3333-4444-555555555555-Main-Queue',
      }),
    });
  });

  test('rejects invalid Security Lake external ids before creating the nested stack', () => {
    expect(() =>
      synthSiem({securityLakeSubscriberExternalId: 'invalid-external-id'}),
    ).toThrow(/must be alphanumeric only/);
  });

  test('uses the pinned vendored template by default', () => {
    const template = synthSiem();
    const json = JSON.stringify(template.toJSON());
    expect(template.toJSON().Metadata).toMatchObject({
      AesSiemVersion: AES_SIEM_TEMPLATE_VERSION,
      AesSiemTemplateSource: AesSiemTemplateSource.VENDORED,
      URL: 'https://github.com/truemark/public/tree/main/autosoc',
    });
    expect(json).toContain('AWS::Partition');
    expect(json).toContain('Fn::If');
  });

  test('propagates enrichment, Control Tower, and VPC-endpoint overrides', () => {
    const template = synthSiem({
      enableTor: true,
      enableAbuseCh: true,
      iocDownloadIntervalMinutes: 60,
      trustedProxyIpList: '10.42.0.0/16',
      logBucketPolicyUpdate: 'keep',
      vpcEndpointId: 'vpce-0123456789abcdef0',
      createSqsVpcEndpoint: false,
      createSsmVpcEndpoint: false,
      createStsVpcEndpoint: false,
      createS3VpcEndpoint: false,
      controlTowerLogBucketNames: [
        'aws-controltower-logs-123456789012-us-east-1',
        'aws-controltower-s3-access-logs-123456789012-us-east-1',
      ],
      controlTowerRoleArnForEsLoader:
        'arn:aws:iam::123456789012:role/ct-role-for-siem',
      controlTowerSqsForLogBuckets:
        'arn:aws:sqs:us-east-2:123456789012:aes-siem-ct',
    });
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        EnableTor: 'true',
        EnableAbuseCh: 'true',
        IocDownloadInterval: '60',
        TrustedProxyIpList: '10.42.0.0/16',
        LogBucketPolicyUpdate: 'keep',
        VpcEndpointId: 'vpce-0123456789abcdef0',
        CreateSqsVpcEndpoint: 'false',
        CreateSsmVpcEndpoint: 'false',
        CreateStsVpcEndpoint: 'false',
        CreateS3VpcEndpoint: 'false',
        ControlTowerLogBucketNameList:
          'aws-controltower-logs-123456789012-us-east-1,aws-controltower-s3-access-logs-123456789012-us-east-1',
        ControlTowerRoleArnForEsLoader:
          'arn:aws:iam::123456789012:role/ct-role-for-siem',
        ControlTowerSqsForLogBuckets:
          'arn:aws:sqs:us-east-2:123456789012:aes-siem-ct',
      }),
    });
  });

  // Literal '$' + '{AWS::URLSuffix}' kept broken up so biome's
  // `noTemplateCurlyInString` lint rule does not fire on the test file.
  const URL_SUFFIX_TOKEN = `\x24{AWS::URLSuffix}`;

  test('UPSTREAM template URL selects the partition-specific template', () => {
    const template = synthSiem({
      templateSource: AesSiemTemplateSource.UPSTREAM,
    });
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('AWS::Partition');
    expect(json).toContain(URL_SUFFIX_TOKEN);
    expect(json).toContain('siem-on-amazon-opensearch-service.template');
    expect(json).toContain('siem-on-amazon-opensearch-service-china.template');
  });

  test('UPSTREAM template URL swaps to the China filename when upstreamTemplateFileName is overridden', () => {
    const template = synthSiem({
      templateSource: AesSiemTemplateSource.UPSTREAM,
      upstreamTemplateFileName:
        'siem-on-amazon-opensearch-service-china.template',
    });
    const stacks = template.findResources('AWS::CloudFormation::Stack');
    const [nested] = Object.values(stacks);
    const sub = (nested.Properties.TemplateURL as {'Fn::Sub': string})[
      'Fn::Sub'
    ];
    // AWS::URLSuffix handles the amazonaws.com -> amazonaws.com.cn
    // swap automatically in the China partition; the filename override
    // is the only CDK-side change required.
    expect(sub).toContain(URL_SUFFIX_TOKEN);
    expect(sub).toContain('siem-on-amazon-opensearch-service-china.template');
  });

  test('VENDORED template source packages the checked-in asset and rejects a missing file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const {fileURLToPath} = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const vendored = path.resolve(
      here,
      '../vendor/aes-siem/siem-on-amazon-opensearch-service.template',
    );
    expect(fs.existsSync(vendored)).toBe(true);
    const template = synthSiem({
      templateSource: AesSiemTemplateSource.VENDORED,
    });
    template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    const [stack] = Object.values(
      template.findResources('AWS::CloudFormation::Stack'),
    );
    expect(JSON.stringify(stack.Properties.TemplateURL)).toContain(
      'cdk-hnb659fds-assets',
    );
    expect(() =>
      synthSiem({
        templateSource: AesSiemTemplateSource.VENDORED,
        upstreamTemplateFileName: 'missing.template',
      }),
    ).toThrow(/templateSource is VENDORED but/);
  });
});
