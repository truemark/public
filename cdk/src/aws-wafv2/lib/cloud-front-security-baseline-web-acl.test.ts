import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {CloudFrontSecurityBaselineWebAcl} from './cloud-front-security-baseline-web-acl';

test('Test CloudFrontSecurityBaselineWebAcl Stack', () => {
  const stack = HelperTest.stack();
  new CloudFrontSecurityBaselineWebAcl(stack, 'MyTestConstruct');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Logs::LogGroup', 1);
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  template.resourceCountIs('AWS::WAFv2::RuleGroup', 1);
});
