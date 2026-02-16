import {HelperTest, ResourceType} from '../../helper.test';

import {marshall} from '@aws-sdk/util-dynamodb';
import {PutItem} from './put-item';
import {Template} from 'aws-cdk-lib/assertions';

test('Test PutItem', () => {
  const stack = HelperTest.stack();
  const item = marshall({
    Pk: 'Org#secure',
    Sk: 'OrgDetails',
    EntityType: 'Org',
    Details: {
      id: 'secure',
      createdDate: Date.now(),
      contact: {
        name: 'Bob Example',
        email: 'bob@example.com',
      },
    },
  });
  new PutItem(stack, 'ExamplePut', {
    tableName: 'ExampleTable',
    item,
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('Custom::AWS', {});
  template.resourceCountIs(ResourceType.CLOUDWATCH_LOG_GROUP, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_LOG_GROUP, {
    RetentionInDays: 3,
  });
});
