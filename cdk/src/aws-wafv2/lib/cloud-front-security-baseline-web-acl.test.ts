import {RemovalPolicy} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
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

test('CloudFrontSecurityBaselineWebAcl logs to the log group ARN without the :* suffix', () => {
  const stack = HelperTest.stack();
  new CloudFrontSecurityBaselineWebAcl(stack, 'Acl');
  const template = Template.fromStack(stack);
  const [config] = Object.values(
    template.findResources('AWS::WAFv2::LoggingConfiguration'),
  );
  const [logGroup] = Object.values(
    template.findResources('AWS::Logs::LogGroup'),
  );
  const destination = JSON.stringify(config.Properties.LogDestinationConfigs);
  expect(destination).toContain(
    `:log-group:${logGroup.Properties.LogGroupName}"`,
  );
  expect(destination).not.toContain(':*');
});

test('CloudFrontSecurityBaselineWebAcl retains its log group unless told otherwise', () => {
  const retained = HelperTest.stack();
  new CloudFrontSecurityBaselineWebAcl(retained, 'Acl');
  Template.fromStack(retained).hasResource('AWS::Logs::LogGroup', {
    DeletionPolicy: 'Retain',
  });

  const destroyed = HelperTest.stack();
  new CloudFrontSecurityBaselineWebAcl(destroyed, 'Acl', {
    countryCodes: ['CN', 'RU'],
    searchString: '/api/login',
    uriCountryRuleLimit: 200,
    rateBasedRuleLimit: 300,
    logRemovalPolicy: RemovalPolicy.DESTROY,
  });
  Template.fromStack(destroyed).hasResource('AWS::Logs::LogGroup', {
    DeletionPolicy: 'Delete',
  });
});
