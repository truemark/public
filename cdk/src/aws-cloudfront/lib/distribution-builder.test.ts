import {Template} from 'aws-cdk-lib/assertions';
import {Bucket} from 'aws-cdk-lib/aws-s3';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {DistributionBuilder} from './distribution-builder';

test('Test DistributionBuilder', () => {
  const stack = HelperTest.stack();
  const bucket = new Bucket(stack, 'TestBucket');
  new DistributionBuilder(stack, 'TestDistribution')
    .behaviorFromBucketV2(bucket)
    .s3Defaults()
    .behaviorFromDomainName('test.example.com', '/api/*')
    .apiDefaults()
    .toDistribution();
});

test('apiDefaults forwards origin request headers without adding them to the cache key', () => {
  const stack = HelperTest.stack();
  new DistributionBuilder(stack, 'TestDistribution')
    .behaviorFromDomainName('test.example.com')
    .apiDefaults(['X-Tenant'], ['CloudFront-Viewer-Address'])
    .toDistribution();
  const template = Template.fromStack(stack);
  const [cachePolicy] = Object.values(
    template.findResources('AWS::CloudFront::CachePolicy'),
  );
  const [originRequestPolicy] = Object.values(
    template.findResources('AWS::CloudFront::OriginRequestPolicy'),
  );
  const cacheHeaders =
    cachePolicy.Properties.CachePolicyConfig
      .ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.Headers;
  const originHeaders =
    originRequestPolicy.Properties.OriginRequestPolicyConfig.HeadersConfig
      .Headers;
  expect(cacheHeaders).toContain('X-Tenant');
  expect(cacheHeaders).not.toContain('CloudFront-Viewer-Address');
  expect(originHeaders).toEqual(
    expect.arrayContaining(['X-Tenant', 'CloudFront-Viewer-Address']),
  );
});
