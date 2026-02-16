import * as path from 'path';
import {ResourceType, HelperTest} from '../../helper.test';
import {ExtendedGoFunction} from '../index';
import {Template} from 'aws-cdk-lib/assertions';

test('Test GoFunctionAlpha', () => {
  const stack = HelperTest.stack();
  new ExtendedGoFunction(stack, 'TestFunction', {
    entry: path.join(HelperTest.resolveTestFiles('go-lambda')),
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties(ResourceType.LAMBDA_FUNCTION, {
    Runtime: 'provided.al2023',
  });
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 3);
  template.resourceCountIs(ResourceType.CLOUDWATCH_LOG_GROUP, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_LOG_GROUP, {
    RetentionInDays: 3,
  });
});
