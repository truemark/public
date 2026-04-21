#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {WebAclBuilder} from '../src/aws-wafv2/lib/web-acl-builder';

/**
 * Example that directly uses WebAclBuilder to test it.
 * This deploys ONLY the WebAclBuilder, not the higher-level constructs.
 */

class WebAclBuilderTestStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1', // CloudFront WAF must be in us-east-1
      },
    });

    // Test 1: Basic WebACL with ALL defaults (simplest usage)
    // This automatically includes:
    // - AWS Managed Rules (Common, KnownBadInputs, AnonymousIP, IPReputation)
    // - Rate limiting for ALL endpoints (100 req/5min)
    // - Rate limiting for SPECIFIC endpoint /api/login (20 req/5min, blocks)
    // - Geo-blocking for high-risk countries (CN, RU, KP)
    const basicBuilder = new WebAclBuilder(
      this,
      'BasicCloudFrontWebAcl',
      'CLOUDFRONT',
    );
    basicBuilder
      .name('BasicCloudFrontWebACL')
      .description('Basic WebACL with ALL defaults enabled')
      .defaultAllow()
      .managedRuleGroupsMode('count')
      .logRetention(RetentionDays.ONE_WEEK);

    const basicWebAcl = basicBuilder.toWebAcl();

    // Test 2: Customized WebACL showing how users can customize defaults
    const customBuilder = new WebAclBuilder(
      this,
      'CustomCloudFrontWebAcl',
      'CLOUDFRONT',
    );
    customBuilder
      .name('CustomCloudFrontWebACL')
      .description('Customized WebACL with modified rate limits and countries')
      .defaultAllow()
      .managedRuleGroupsMode('count')
      // Customize rate limiting thresholds and endpoint
      .rateLimitConfig({
        allEndpointsLimit: 200, // Increase from 100 to 200
        specificEndpointLimit: 10, // Decrease from 20 to 10 (stricter)
        specificEndpointPath: '/auth/', // Change from /api/login to /auth/
      })
      // Customize geo-blocking countries
      .geoBlockingConfig(['CN', 'RU', 'KP', 'IR', 'SY']) // Add more countries
      // Optionally disable specific default rules
      .defaultManagedRules({
        commonRuleSet: true,
        knownBadInputs: true,
        anonymousIpList: false, // Disable this one
        ipReputationList: true,
      })
      .logRetention(RetentionDays.ONE_WEEK);

    const customWebAcl = customBuilder.toWebAcl();

    // Outputs
    new cdk.CfnOutput(this, 'BasicWebAclArn', {
      value: basicWebAcl.attrArn,
      description: 'Basic WebACL ARN (with default managed rules)',
    });

    new cdk.CfnOutput(this, 'BasicWebAclId', {
      value: basicWebAcl.attrId,
      description: 'Basic WebACL ID',
    });

    new cdk.CfnOutput(this, 'CustomWebAclArn', {
      value: customWebAcl.attrArn,
      description: 'Custom WebACL ARN (with custom rules)',
    });

    new cdk.CfnOutput(this, 'CustomWebAclId', {
      value: customWebAcl.attrId,
      description: 'Custom WebACL ID',
    });
  }
}

const app = new cdk.App();
new WebAclBuilderTestStack(app, 'WebAclBuilderTestStack');

// Regional WebACL Test Stack (for ALB, API Gateway, etc.)
class RegionalWebAclBuilderTestStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-west-2', // Regional can be any region
      },
    });

    // Regional WebACL with all defaults
    const regionalBuilder = new WebAclBuilder(
      this,
      'RegionalWebAcl',
      'REGIONAL',
    );
    regionalBuilder
      .name('BasicRegionalWebACL')
      .description('Regional WebACL for ALB/API Gateway with all defaults')
      .defaultAllow()
      .managedRuleGroupsMode('count')
      .logRetention(RetentionDays.ONE_WEEK);

    const regionalWebAcl = regionalBuilder.toWebAcl();

    // Outputs
    new cdk.CfnOutput(this, 'RegionalWebAclArn', {
      value: regionalWebAcl.attrArn,
      description: 'Regional WebACL ARN - Use with ALB, API Gateway, AppSync',
    });

    new cdk.CfnOutput(this, 'RegionalWebAclId', {
      value: regionalWebAcl.attrId,
      description: 'Regional WebACL ID',
    });
  }
}

new RegionalWebAclBuilderTestStack(app, 'RegionalWebAclBuilderTestStack');
app.synth();
