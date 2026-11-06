import {Match, Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
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

test('ParameterStore reads another region with a grant on that parameter only', () => {
  const stack = HelperTest.stack();
  const store = new ParameterStore(stack, 'RemoteParameters', {
    prefix: '/app/',
    region: 'us-west-2',
  });
  store.read('First');
  store.read('Second');
  const template = Template.fromStack(stack);
  const statements = Object.values(
    template.findResources('AWS::IAM::Policy'),
  ).flatMap((policy) => policy.Properties.PolicyDocument.Statement);
  const resources = statements
    .filter((statement) => statement.Action === 'ssm:GetParameter')
    .map((statement) => JSON.stringify(statement.Resource));
  expect(resources).toHaveLength(2);
  expect(resources[0]).toContain(
    ':ssm:us-west-2:100000000000:parameter/app/First"',
  );
  expect(resources[1]).toContain(
    ':ssm:us-west-2:100000000000:parameter/app/Second"',
  );
});

test('ParameterStore cross-region readers log to one group with retention', () => {
  const stack = HelperTest.stack();
  const store = new ParameterStore(stack, 'RemoteParameters', {
    region: 'us-west-2',
  });
  store.read('First');
  store.read('Second');
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.CLOUDWATCH_LOG_GROUP, 1);
  template.hasResourceProperties(ResourceType.CLOUDWATCH_LOG_GROUP, {
    RetentionInDays: Match.anyValue(),
  });
  template.hasResourceProperties(ResourceType.LAMBDA_FUNCTION, {
    LoggingConfig: {LogGroup: Match.anyValue()},
  });
});
