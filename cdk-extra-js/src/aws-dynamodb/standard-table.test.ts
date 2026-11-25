import {Template} from 'aws-cdk-lib/assertions';
import {ExtendedApp, ExtendedStack} from 'truemark-cdk-lib/aws-cdk';
import {test} from 'vitest';
import {StandardTable} from './standard-table';

const DYNAMODB_TABLE = 'AWS::DynamoDB::Table';
const CLOUDWATCH_ALARM = 'AWS::CloudWatch::Alarm';

function testStack() {
  const app = new ExtendedApp({account: '100000000000', region: 'us-east-2'});
  return new ExtendedStack(app, 'TestStack');
}

test('Create StandardTable', () => {
  const stack = testStack();
  new StandardTable(stack, 'TestTable');
  const template = Template.fromStack(stack);
  template.resourceCountIs(DYNAMODB_TABLE, 1);
  template.resourceCountIs(CLOUDWATCH_ALARM, 3);
});
