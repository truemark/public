import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {ExtendedStack} from '../../aws-cdk/index';
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

test('StandardTableV2 leaves its generated indexes off the dashboard when monitorGlobalSecondaryIndexes is false', () => {
  const dashboardFor = (monitorGlobalSecondaryIndexes?: boolean) => {
    const stack = new ExtendedStack(HelperTest.app(), 'TestStack', {
      createDashboard: true,
    });
    new StandardTableV2(stack, 'TestTable', {
      globalSecondaryIndexes: 2,
      monitorGlobalSecondaryIndexes,
    });
    return JSON.stringify(
      Template.fromStack(stack).findResources('AWS::CloudWatch::Dashboard'),
    );
  };
  expect(dashboardFor()).toContain('Gs2');
  expect(dashboardFor(false)).toContain('Dynamo Table');
  expect(dashboardFor(false)).not.toContain('Gs2');
});
