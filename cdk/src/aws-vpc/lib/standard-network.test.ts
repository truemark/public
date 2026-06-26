import {Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {StandardNetwork} from './standard-network';

test('Happy path test for StandardNetwork', () => {
  const stack = HelperTest.stack();
  new StandardNetwork(stack, 'TestNetwork', {
    name: 'TestNetwork',
    vpcCidr: '10.0.0.0/16',
    azCount: 3,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::VPC', 1);
  HelperTest.logTemplate(template);
});
