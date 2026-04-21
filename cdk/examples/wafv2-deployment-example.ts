#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
  CloudFrontSecurityBaselineWebAcl,
  RegionalSecurityBaselineWebAcl,
} from '../src/aws-wafv2';

/**
 * Example stack showing how to deploy WAFv2 constructs.
 *
 * To test locally (unit test):
 *   cd cdk && pnpm test
 *
 * To synthesize CloudFormation:
 *   cdk synth -a "npx ts-node examples/wafv2-deployment-example.ts"
 *
 * To deploy CloudFront WAF (must be in us-east-1):
 *   cdk deploy CloudFrontWafStack -a "npx ts-node examples/wafv2-deployment-example.ts"
 *
 * To deploy Regional WAF (any region):
 *   cdk deploy RegionalWafStack -a "npx ts-node examples/wafv2-deployment-example.ts" --region us-west-2
 */

// CloudFront WAF - MUST be deployed to us-east-1
class CloudFrontWafStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1', // CloudFront WAF must be in us-east-1
      },
    });

    // Create a CloudFront WAF with custom configuration
    const cloudFrontWaf = new CloudFrontSecurityBaselineWebAcl(
      this,
      'CloudFrontWaf',
      {
        webAclName: 'ExampleCloudFrontWebACL',
        name: 'ExampleCloudFrontRuleGroup',
        mode: 'count', // Use 'count' mode for testing, 'active' for production
        countryCodes: ['CN', 'RU', 'KP'], // Block requests from these countries
        searchString: '/api/login', // Monitor login endpoint
        uriCountryRuleLimit: 200, // Rate limit for country-based rule
        uriCountryAction: 'count', // 'count' or 'block'
        rateBasedRuleLimit: 300, // General rate limit
      },
    );

    // Output the WebACL ARN for use with CloudFront distributions
    new cdk.CfnOutput(this, 'WebAclArn', {
      value: cloudFrontWaf.webAcl.attrArn,
      description:
        'CloudFront WebACL ARN - use this in your CloudFront distribution',
      exportName: 'CloudFrontWebAclArn',
    });

    new cdk.CfnOutput(this, 'WebAclId', {
      value: cloudFrontWaf.webAcl.attrId,
      description: 'CloudFront WebACL ID',
    });
  }
}

// Regional WAF - Can be deployed to any region
class RegionalWafStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-2',
      },
    });

    // Create a Regional WAF for ALB, API Gateway, AppSync, etc.
    const regionalWaf = new RegionalSecurityBaselineWebAcl(
      this,
      'RegionalWaf',
      {
        webAclName: 'ExampleRegionalWebACL',
        name: 'ExampleRegionalRuleGroup',
        mode: 'count', // Use 'count' mode for testing, 'active' for production
        countryCodes: ['CN', 'RU', 'KP'],
        searchString: '/api/login',
        uriCountryRuleLimit: 200,
        uriCountryAction: 'count',
        rateBasedRuleLimit: 300,
      },
    );

    // Output the WebACL ARN for use with ALB, API Gateway, etc.
    new cdk.CfnOutput(this, 'RegionalWebAclArn', {
      value: regionalWaf.regionalWebAcl.attrArn,
      description:
        'Regional WebACL ARN - use this with ALB, API Gateway, AppSync',
      exportName: 'RegionalWebAclArn',
    });

    new cdk.CfnOutput(this, 'RegionalWebAclId', {
      value: regionalWaf.regionalWebAcl.attrId,
      description: 'Regional WebACL ID',
    });
  }
}

// Create the CDK app
const app = new cdk.App();

// Deploy both stacks
new CloudFrontWafStack(app, 'CloudFrontWafStack');
new RegionalWafStack(app, 'RegionalWafStack');

app.synth();
