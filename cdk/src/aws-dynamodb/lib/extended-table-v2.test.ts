import {Match, Template} from 'aws-cdk-lib/assertions';
import {AttributeType, Billing} from 'aws-cdk-lib/aws-dynamodb';
import {Construct} from 'constructs';
import {expect, test} from 'vitest';
import {ExtendedStack} from '../../aws-cdk/index';
import {HelperTest, ResourceType} from '../../helper.test';
import {ExtendedTableV2} from './extended-table-v2';

test('Create TableV2', () => {
  const stack = HelperTest.stack();
  const table = new ExtendedTableV2(stack, 'TestTable', {
    partitionKey: {
      name: 'Pk',
      type: AttributeType.STRING,
    },
    sortKey: {
      name: 'Sk',
      type: AttributeType.STRING,
    },
    billing: Billing.onDemand(),
  });
  table.addGlobalSecondaryIndex({
    indexName: 'TestIndex',
    partitionKey: {
      name: 'Pk',
      type: AttributeType.STRING,
    },
    sortKey: {
      name: 'Gsi',
      type: AttributeType.STRING,
    },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.DYNAMODB_GLOBAL_TABLE, 1);
  // three for the table, plus read and write throttles for its one index
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 5);
});

// Index alarm names end the table and index name with a hash of the table's path.
const indexAlarmName = (name: string) =>
  Match.stringLikeRegexp(
    `^${name}-[0-9a-f]{8}-Read-Throttled-Events-Critical$`,
  );

const tableWithTwoIndexes = (
  addGlobalSecondaryIndexesToDashboards?: boolean,
) => {
  const stack = new ExtendedStack(HelperTest.app(), 'TestStack', {
    createDashboard: true,
  });
  const table = new ExtendedTableV2(stack, 'TestTable', {
    partitionKey: {name: 'Pk', type: AttributeType.STRING},
    billing: Billing.onDemand(),
    addGlobalSecondaryIndexesToDashboards,
    globalSecondaryIndexes: [
      {
        indexName: 'PropsIndex',
        partitionKey: {name: 'Gs1Pk', type: AttributeType.STRING},
      },
    ],
  });
  table.addGlobalSecondaryIndex({
    indexName: 'AddedIndex',
    partitionKey: {name: 'Gs2Pk', type: AttributeType.STRING},
  });
  const template = Template.fromStack(stack);
  return {
    table,
    template,
    dashboards: JSON.stringify(
      template.findResources('AWS::CloudWatch::Dashboard'),
    ),
  };
};

test('ExtendedTableV2 alarms on every global secondary index and keeps them off the dashboard', () => {
  const {table, template, dashboards} = tableWithTwoIndexes();
  expect(table.tableAlarms).toBeDefined();
  // three for the table, plus read and write throttles for each of two indexes
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 7);
  for (const index of ['PropsIndex', 'AddedIndex']) {
    template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
      AlarmName: indexAlarmName(`TestStack-TestTable-${index}`),
    });
  }
  expect(dashboards).toContain('Dynamo Table');
  expect(dashboards).not.toContain('PropsIndex');
  expect(dashboards).not.toContain('AddedIndex');
});

test('ExtendedTableV2 adds global secondary indexes to the dashboard when asked', () => {
  const {template, dashboards} = tableWithTwoIndexes(true);
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 7);
  expect(dashboards).toContain('PropsIndex');
  expect(dashboards).toContain('AddedIndex');
});

test('Index alarms follow the table name, so same-id tables with distinct names do not collide', () => {
  const stack = HelperTest.stack();
  for (const tableName of ['Orders', 'Customers']) {
    new ExtendedTableV2(new Construct(stack, tableName), 'Table', {
      tableName,
      partitionKey: {name: 'Pk', type: AttributeType.STRING},
      billing: Billing.onDemand(),
      globalSecondaryIndexes: [
        {
          indexName: 'Gs1',
          partitionKey: {name: 'Gs1Pk', type: AttributeType.STRING},
        },
      ],
    });
  }
  const template = Template.fromStack(stack);
  for (const tableName of ['Orders', 'Customers']) {
    template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
      AlarmName: `TestStack-${tableName}-Read-Throttled-Events-Critical`,
    });
    template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
      AlarmName: indexAlarmName(`TestStack-${tableName}-Gs1`),
    });
  }
});

test('An index alarm does not collide with the alarm of a table named after it', () => {
  const stack = HelperTest.stack();
  new ExtendedTableV2(stack, 'Orders', {
    partitionKey: {name: 'Pk', type: AttributeType.STRING},
    billing: Billing.onDemand(),
    globalSecondaryIndexes: [
      {
        indexName: 'Gs1',
        partitionKey: {name: 'Gs1Pk', type: AttributeType.STRING},
      },
    ],
  });
  new ExtendedTableV2(stack, 'Orders-Gs1', {
    partitionKey: {name: 'Pk', type: AttributeType.STRING},
    billing: Billing.onDemand(),
  });
  const template = Template.fromStack(stack);
  // three for each table, plus read and write throttles for the one index
  template.resourceCountIs(ResourceType.CLOUDWATCH_ALARM, 8);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
    AlarmName: 'TestStack-Orders-Gs1-Read-Throttled-Events-Critical',
  });
  template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
    AlarmName: indexAlarmName('TestStack-Orders-Gs1'),
  });
});
