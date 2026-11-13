import {Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {StandardTable} from './standard-table';

test('Create StandardTable', () => {
  const stack = HelperTest.stack();
  new StandardTable(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.DYNAMODB_TABLE, 1);
  // three for the table, plus read and write throttles for its one index
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 5);
});
