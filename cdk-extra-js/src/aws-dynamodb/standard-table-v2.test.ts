import {Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp, ExtendedStack} from 'truemark-cdk-lib/aws-cdk';
import {expect, test} from 'vitest';
import {getGlobalIndexes, StandardTableV2} from './standard-table-v2';

const DYNAMODB_GLOBAL_TABLE = 'AWS::DynamoDB::GlobalTable';
const CLOUDWATCH_ALARM = 'AWS::CloudWatch::Alarm';

function testStack() {
  const app = new ExtendedApp({account: '100000000000', region: 'us-east-2'});
  return new ExtendedStack(app, 'TestStack');
}

test('Create StandardTableV2', () => {
  const stack = testStack();
  new StandardTableV2(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(DYNAMODB_GLOBAL_TABLE, 1);
  template.resourceCountIs(CLOUDWATCH_ALARM, 3);
});

test('getGlobalIndexes returns sequential index names', () => {
  expect(getGlobalIndexes(3)).toEqual(['Gs1', 'Gs2', 'Gs3']);
});

test('getGlobalIndexes returns an empty list for zero indexes', () => {
  expect(getGlobalIndexes(0)).toEqual([]);
});
