import {HelperTest} from '../../helper.test';
import {DistributionBuilder} from './distribution-builder';
import {Bucket} from 'aws-cdk-lib/aws-s3';

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
