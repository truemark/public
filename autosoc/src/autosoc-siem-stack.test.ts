import {Match, Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {describe, expect, test} from 'vitest';
import {
  AES_SIEM_TEMPLATE_VERSION,
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
      URL: 'https://github.com/truemark/public/tree/main/autosoc',
    });
  });
});
