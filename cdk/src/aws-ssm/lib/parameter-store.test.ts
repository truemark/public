import {Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {ParameterStore} from '../index';

test('Test ParameterStore', () => {
  const stack = HelperTest.stack();
  const store = new ParameterStore(stack, 'TestParameters', {
    prefix: 'Prefix',
    suffix: 'Suffix',
  });
  store.write('Test', 'Success');
  const template = Template.fromStack(stack);
  template.hasResourceProperties(ResourceType.SSM_PARAMETER, {
    Type: 'String',
    Value: 'Success',
    Name: 'PrefixTestSuffix',
  });
});
