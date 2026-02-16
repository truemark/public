import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest, ResourceType} from '../../helper.test';
import {StandardTableV2} from './standard-table-v2';

test('Create StandardTableV2', () => {
  const stack = HelperTest.stack();
  new StandardTableV2(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.DYNAMODB_GLOBAL_TABLE, 1);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 3);
});
