import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest, ResourceType} from '../../helper.test';
import {StandardTable} from './standard-table';

test('Create StandardTable', () => {
  const stack = HelperTest.stack();
  new StandardTable(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.DYNAMODB_TABLE, 1);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 3);
});
