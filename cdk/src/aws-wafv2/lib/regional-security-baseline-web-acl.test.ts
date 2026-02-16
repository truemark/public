import {RegionalSecurityBaselineWebAcl} from './regional-security-baseline-web-acl';
import {HelperTest} from '../../helper.test';
import {Template} from 'aws-cdk-lib/assertions';

test('Test RegionalSecurityBaselineWebAcl Stack', () => {
  const stack = HelperTest.stack();
  new RegionalSecurityBaselineWebAcl(stack, 'MyTestConstruct');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  template.resourceCountIs('AWS::WAFv2::RuleGroup', 1);
});
