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
      TemplateURL: Match.objectLike({'Fn::Sub': Match.anyValue()}),
      Parameters: Match.objectLike({
        DeploymentTarget: 'opensearch_managed_cluster',
        DomainOrCollectionName: 'aes-siem',
        SnsEmail: 'ops@example.com',
        AllowedSourceIpAddresses: '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16',
        GeoLite2LicenseKey: '',
        ReservedConcurrency: '10',
        SecurityLakeRoleArn: '',
        SecurityLakeExternalId: '',
        SecurityLakeSubscriberSqs: '',
      }),
    });
  });

  test('propagates optional overrides into template parameters', () => {
    const template = synthSiem({
      geoLite2LicenseKey: 'abc123_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_mmk',
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
        GeoLite2LicenseKey: 'abc123_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_mmk',
        ReservedConcurrency: '25',
      }),
    });
  });

  test('threads Security Lake subscriber ARNs into aes-siem parameters', () => {
    const template = synthSiem({
      securityLakeSubscriberRoleArn:
        'arn:aws:iam::100000000000:role/AmazonSecurityLake-11111111-2222-3333-4444-555555555555',
      securityLakeSubscriberExternalId: 'secret-external-id',
      securityLakeSubscriberSqsArn:
        'arn:aws:sqs:us-east-2:100000000000:AmazonSecurityLake-11111111-2222-3333-4444-555555555555-Main-Queue',
    });
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        SecurityLakeRoleArn:
          'arn:aws:iam::100000000000:role/AmazonSecurityLake-11111111-2222-3333-4444-555555555555',
        SecurityLakeExternalId: 'secret-external-id',
        SecurityLakeSubscriberSqs:
          'arn:aws:sqs:us-east-2:100000000000:AmazonSecurityLake-11111111-2222-3333-4444-555555555555-Main-Queue',
      }),
    });
  });

  test('stamps the pinned aes-siem template version in stack metadata', () => {
    const template = synthSiem();
    expect(template.toJSON().Metadata).toMatchObject({
      AesSiemVersion: AES_SIEM_TEMPLATE_VERSION,
      AesSiemTemplateSource: AesSiemTemplateSource.UPSTREAM,
      URL: 'https://github.com/truemark/public/tree/main/autosoc',
    });
  });

  test('propagates enrichment, Control Tower, and VPC-endpoint overrides', () => {
    const template = synthSiem({
      otxApiKey: 'f'.repeat(64),
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
        OtxApiKey: 'f'.repeat(64),
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

  test('resolves GeoLite2 / OTX secrets via SSM SecureString dynamic reference when *ParameterName is set', () => {
    const template = synthSiem({
      geoLite2LicenseKeyParameterName: '/autosoc/siem/geolite2-license-key',
      otxApiKeyParameterName: '/autosoc/siem/otx-api-key',
    });
    template.hasResourceProperties('AWS::CloudFormation::Stack', {
      Parameters: Match.objectLike({
        GeoLite2LicenseKey:
          '{{resolve:ssm-secure:/autosoc/siem/geolite2-license-key:1}}',
        OtxApiKey: '{{resolve:ssm-secure:/autosoc/siem/otx-api-key:1}}',
      }),
    });
  });

  test('throws when both GeoLite2 literal + parameter name are supplied', () => {
    expect(() =>
      synthSiem({
        geoLite2LicenseKey: 'literal-key',
        geoLite2LicenseKeyParameterName: '/autosoc/siem/geolite2-license-key',
      }),
    ).toThrow(/geoLite2LicenseKey.*geoLite2LicenseKeyParameterName/);
  });

  test('throws when both OTX literal + parameter name are supplied', () => {
    expect(() =>
      synthSiem({
        otxApiKey: 'literal-key',
        otxApiKeyParameterName: '/autosoc/siem/otx-api-key',
      }),
    ).toThrow(/otxApiKey.*otxApiKeyParameterName/);
  });

  test('VENDORED template source packages an asset when the file exists, throws when missing', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const {fileURLToPath} = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const vendored = path.resolve(here, '../vendor/aes-siem/siem.yaml');

    if (fs.existsSync(vendored)) {
      // Developer has already run `pnpm run vendor:aes-siem`; the stack
      // must now package it as a CDK S3 asset (templateUrl becomes an
      // Fn::Sub into the assets bucket, no longer the hard-coded upstream
      // URL).
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
    } else {
      // Fresh checkout — vendor dir does not exist; must throw with a
      // helpful pointer at the vendor script.
      expect(() =>
        synthSiem({templateSource: AesSiemTemplateSource.VENDORED}),
      ).toThrow(/templateSource is VENDORED but/);
    }
  });
});
