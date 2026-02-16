import {ResourceType, HelperTest} from '../../helper.test';
import {Template} from 'aws-cdk-lib/assertions';
import {ExtendedStack} from './extended-stack';

test('Test ExportedStack', () => {
  const stage = HelperTest.stage();
  const stack = new ExtendedStack(stage, 'TestStack');
  stack.exportParameter('TestParameter', 'TestValue');
  stack.outputParameter('TestParameter', 'TestValue');
  stack.exportAndOutputParameter('TestParameter2', 'TestValue2');
  const template = Template.fromStack(stack);
  template.hasResourceProperties(ResourceType.SSM_PARAMETER, {
    Type: 'String',
    Value: 'TestValue',
    Name: '/TestStage/TestStack/Exports/TestParameter',
  });
  template.hasOutput('TestParameter', {
    Value: 'TestValue',
  });
  template.hasResourceProperties(ResourceType.SSM_PARAMETER, {
    Type: 'String',
    Value: 'TestValue2',
    Name: '/TestStage/TestStack/Exports/TestParameter2',
  });
  template.hasOutput('TestParameter2', {
    Value: 'TestValue2',
  });
});
