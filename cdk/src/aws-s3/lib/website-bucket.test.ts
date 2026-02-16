import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest, ResourceType} from '../../helper.test';
import {WebsiteBucket} from './website-bucket';

test('WebsiteBucket', () => {
  const stack = HelperTest.stack();
  new WebsiteBucket(stack, 'TestBucket');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.S3_BUCKET, 1);
  template.hasResourceProperties(ResourceType.S3_BUCKET, {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: false,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: false,
    },
  });
});
