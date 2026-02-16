import {ResourceType, HelperTest} from '../../helper.test';
import {ExtendedNodejsFunction} from '../index';
import * as path from 'path';
import {Template} from 'aws-cdk-lib/assertions';
import {Runtime} from 'aws-cdk-lib/aws-lambda';

test('Test NodejsFunction', () => {
  const stack = HelperTest.stack();
  new ExtendedNodejsFunction(stack, 'TestFunction', {
    entry: HelperTest.resolveTestFiles(
      path.join('typescript-lambda', 'index.ts'),
    ),
    runtime: Runtime.NODEJS_22_X,
    // bundling: {
    //   forceDockerBundling: true
    // }
  });
  const template = Template.fromStack(stack);
  // HelperTest.logTemplate(template);
  template.hasResourceProperties(ResourceType.LAMBDA_FUNCTION, {
    Runtime: 'nodejs22.x',
  });
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 3);
  template.resourceCountIs(ResourceType.CLOUDWATCH_LOG_GROUP, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_LOG_GROUP, {
    RetentionInDays: 3,
  });
});
