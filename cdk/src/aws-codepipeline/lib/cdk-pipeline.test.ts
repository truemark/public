import {Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {CdkPipeline} from '../index';

test('Test CdkPipeline', () => {
  const stack = HelperTest.stack();
  new CdkPipeline(stack, 'Test', {
    keyArn:
      'arn:aws:kms:us-east-2:000000000000:key/00000000-0000-0000-0000-000000000000',
    connectionArn:
      'arn:aws:codestar-connections:us-east-2:000000000000:connection/00000000-0000-0000-0000-000000000000',
    repository: 'SomeOwner/SomeRepo',
    branch: 'SomeBranch',
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.CODEPIPELINE, 1);
});
