import {test, expect} from 'vitest';
import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {WebAclBuilder} from './web-acl-builder';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';

test('Test WebAclBuilder with CloudFront scope and default rules', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestWebAcl', 'CLOUDFRONT');

  builder
    .name('TestCloudFrontWebACL')
    .description('Test WebACL for CloudFront')
    .defaultAllow()
    .managedRuleGroupsMode('count')
    .logRetention(RetentionDays.ONE_MONTH);

  builder.toWebAcl();

  const template = Template.fromStack(stack);

  // Should create WebACL resource
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);

  // Should create CloudWatch log group
  template.resourceCountIs('AWS::Logs::LogGroup', 1);

  // Verify WebACL properties
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'CLOUDFRONT',
    DefaultAction: {
      Allow: {},
    },
    Name: 'TestCloudFrontWebACL',
    Description: 'Test WebACL for CloudFront',
  });

  // Verify log group retention
  template.hasResourceProperties('AWS::Logs::LogGroup', {
    RetentionInDays: 30,
  });
});

test('Test WebAclBuilder with Regional scope', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestRegionalWebAcl', 'REGIONAL');

  builder
    .name('TestRegionalWebACL')
    .description('Test WebACL for Regional resources')
    .defaultAllow()
    .managedRuleGroupsMode('count');

  builder.toWebAcl();

  const template = Template.fromStack(stack);

  // Verify WebACL with Regional scope
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'REGIONAL',
    Name: 'TestRegionalWebACL',
  });
});

test('Test WebAclBuilder with custom rules', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestCustomRules', 'CLOUDFRONT');

  builder
    .name('CustomRulesWebACL')
    .noDefaultRules() // Disable ALL default rules (managed + custom)
    .addCommonRuleSet()
    .addSqlInjectionRuleSet()
    .addGeoBlockRule(['CN', 'RU', 'KP'], 'BlockHighRiskCountries');

  builder.toWebAcl();

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);

  // Verify the WebACL has rules
  const webAclResources = template.findResources('AWS::WAFv2::WebACL');
  const webAclResource = Object.values(webAclResources)[0];

  // Should have 3 rules (CommonRuleSet, SQLi, GeoBlock)
  expect(webAclResource.Properties.Rules).toHaveLength(3);
});

test('Test WebAclBuilder with active mode', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestActiveMode', 'CLOUDFRONT');

  builder
    .name('ActiveModeWebACL')
    .managedRuleGroupsMode('active') // Active mode for production
    .addCommonRuleSet();

  builder.toWebAcl();

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
});

test('Test WebAclBuilder with default block action', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestBlockMode', 'CLOUDFRONT');

  builder
    .name('BlockByDefaultWebACL')
    .defaultBlock() // Block by default
    .managedRuleGroupsMode('count');

  builder.toWebAcl();

  const template = Template.fromStack(stack);

  // Verify default block action
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    DefaultAction: {
      Block: {},
    },
  });
});

test('Test WebAclBuilder without logging', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestNoLogging', 'CLOUDFRONT');

  builder
    .name('NoLoggingWebACL')
    .enableLogging(false) // Disable logging
    .managedRuleGroupsMode('count');

  builder.toWebAcl();

  const template = Template.fromStack(stack);

  // Should create WebACL but no log group
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  template.resourceCountIs('AWS::Logs::LogGroup', 0);
});

test('Test WebAclBuilder with multiple managed rule sets', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestMultipleRules', 'REGIONAL');

  builder
    .name('MultipleRulesWebACL')
    .noDefaultRules() // Disable all defaults (managed + custom)
    .addCommonRuleSet()
    .addKnownBadInputsRuleSet()
    .addSqlInjectionRuleSet()
    .addLinuxRuleSet()
    .addPhpRuleSet()
    .managedRuleGroupsMode('count');

  builder.toWebAcl();

  const template = Template.fromStack(stack);
  const webAclResources = template.findResources('AWS::WAFv2::WebACL');
  const webAclResource = Object.values(webAclResources)[0];

  // Should have 5 managed rule sets
  expect(webAclResource.Properties.Rules).toHaveLength(5);
});

test('Test WebAclBuilder build method returns correct properties', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestBuildMethod', 'CLOUDFRONT');

  builder
    .name('BuildMethodTestWebACL')
    .description('Testing build method')
    .defaultAllow()
    .visibilityConfig('TestMetric', true, true)
    .managedRuleGroupsMode('count')
    .noDefaultCustomRules(); // Disable custom rules for simpler test

  const webAclProps = builder.build();

  // Verify properties
  expect(webAclProps.name).toBe('BuildMethodTestWebACL');
  expect(webAclProps.description).toBe('Testing build method');
  expect(webAclProps.scope).toBe('CLOUDFRONT');
  expect(webAclProps.defaultAction).toEqual({allow: {}});
});

test('Test WebAclBuilder with all defaults enabled', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(stack, 'TestAllDefaults', 'CLOUDFRONT');

  builder.name('AllDefaultsWebACL').managedRuleGroupsMode('count');

  builder.toWebAcl();

  const template = Template.fromStack(stack);
  const webAclResources = template.findResources('AWS::WAFv2::WebACL');
  const webAclResource = Object.values(webAclResources)[0];

  // Should have 4 AWS managed rules + 3 custom rules = 7 total
  // AWS Managed: Common, KnownBadInputs, AnonymousIP, IPReputation
  // Custom: RateLimit-AllEndpoints, RateLimit-SpecificEndpoint, GeoBlock-HighRiskCountries
  expect(webAclResource.Properties.Rules).toHaveLength(7);
});

test('Test WebAclBuilder with customized rate limits', () => {
  const stack = HelperTest.stack();
  const builder = new WebAclBuilder(
    stack,
    'TestCustomRateLimits',
    'CLOUDFRONT',
  );

  builder
    .name('CustomRateLimitsWebACL')
    .noDefaultRules() // Start fresh
    .rateLimitConfig({
      allEndpointsLimit: 200,
      specificEndpointLimit: 10,
      specificEndpointPath: '/auth/',
    })
    .defaultCustomRules({
      allEndpointsRateLimit: true,
      specificEndpointRateLimit: true,
      geoBlocking: false, // Disable geo-blocking
    });

  builder.toWebAcl();

  const template = Template.fromStack(stack);
  const webAclResources = template.findResources('AWS::WAFv2::WebACL');
  const webAclResource = Object.values(webAclResources)[0];

  // Should have 2 rate limiting rules
  expect(webAclResource.Properties.Rules).toHaveLength(2);
});
