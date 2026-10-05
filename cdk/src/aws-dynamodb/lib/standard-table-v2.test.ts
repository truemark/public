import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {getGlobalIndexes, StandardTableV2} from './standard-table-v2';

test('Create StandardTableV2', () => {
  const stack = HelperTest.stack();
  new StandardTableV2(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.DYNAMODB_GLOBAL_TABLE, 1);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 3);
});

test('getGlobalIndexes returns sequential index names', () => {
  expect(getGlobalIndexes(3)).toEqual(['Gs1', 'Gs2', 'Gs3']);
});

test('getGlobalIndexes returns an empty list for zero indexes', () => {
  expect(getGlobalIndexes(0)).toEqual([]);
});
