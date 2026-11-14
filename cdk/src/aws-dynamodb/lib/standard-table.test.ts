import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {ExtendedStack} from '../../aws-cdk/index';
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

test('StandardTable adds its index to the dashboard only when asked', () => {
  const dashboardFor = (addGlobalSecondaryIndexesToDashboards?: boolean) => {
    const stack = new ExtendedStack(HelperTest.app(), 'TestStack', {
      createDashboard: true,
    });
    new StandardTable(stack, 'TestTable', {
      addGlobalSecondaryIndexesToDashboards,
    });
    return JSON.stringify(
      Template.fromStack(stack).findResources('AWS::CloudWatch::Dashboard'),
    );
  };
  expect(dashboardFor()).toContain('Dynamo Table');
  expect(dashboardFor()).not.toContain('Gs1');
  expect(dashboardFor(true)).toContain('Gs1');
});
