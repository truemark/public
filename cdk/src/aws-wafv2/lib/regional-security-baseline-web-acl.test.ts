import {Template} from 'aws-cdk-lib/assertions';
import {test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {RegionalSecurityBaselineWebAcl} from './regional-security-baseline-web-acl';

test('Test RegionalSecurityBaselineWebAcl Stack', () => {
  const stack = HelperTest.stack();
  new RegionalSecurityBaselineWebAcl(stack, 'MyTestConstruct');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  template.resourceCountIs('AWS::WAFv2::RuleGroup', 1);
});
