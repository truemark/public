import {ArnFormat, type RemovalPolicy, Stack} from 'aws-cdk-lib';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {
  CfnLoggingConfiguration,
  CfnRuleGroup,
  CfnWebACL,
} from 'aws-cdk-lib/aws-wafv2';
import type {Construct} from 'constructs';
import {ExtendedConstruct} from '../../aws-cdk/index';

export type cloudFrontBlockMode = 'count' | 'active';

/**
 * Properties for CloudFrontSecurityBaselineWebAcl.
 */
export interface CloudFrontSecurityBaselineWebAclProps {
  /**
   * The mode of the rule group. To Block or to Count. By default it is set to count.
   */
  readonly mode?: cloudFrontBlockMode;
  /**
   * The name of the webAcl.
   */
  readonly webAclName?: string;
  /**
   * The name of the rule group.
   */
  readonly name?: string;
  /**
   * The number of days log events are kept in CloudWatch Logs. Default is 1 year.
   */
  readonly logRetention?: RetentionDays;
  /**
   * The removal policy of the WAF log group. Its name is fixed, so a retained
   * group must be deleted before the construct can be deployed again.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly logRemovalPolicy?: RemovalPolicy;
  /**
   * The country codes to match against.
   */
  readonly countryCodes: string[];
  /**
   * The string to search for in the request.
   */
  readonly searchString: string;
  /**
   * This is the limit for country based rate based rule.
   */
  readonly uriCountryRuleLimit: number;
  /**
   * The action to take on the URI country rule.
   */
  readonly uriCountryAction?: 'count' | 'block';
  /**
   * The limit for the rate based rule.
   */
  readonly rateBasedRuleLimit: number;
}

/**
 * Creates a rule group and web ACL for CloudFront distributions to use.
 */
export class CloudFrontSecurityBaselineWebAcl extends ExtendedConstruct {
  readonly ruleGroup: CfnRuleGroup;
  readonly webAcl: CfnWebACL;
  constructor(
    scope: Construct,
    id: string,
    props?: CloudFrontSecurityBaselineWebAclProps,
  ) {
    super(scope, id);

    this.ruleGroup = new CfnRuleGroup(this, 'RuleGroup', {
      name: props?.name ?? 'SecurityBaselineRuleGroup',
      scope: 'CLOUDFRONT',
      capacity: 500,
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'SecurityBaselineRuleGroupMetric',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'UriCountryBased',
          priority: 1,
          action: {
            [props?.uriCountryAction ?? 'count']: {},
          },
          statement: {
            rateBasedStatement: {
              limit: props?.uriCountryRuleLimit ?? 200,
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              scopeDownStatement: {
                andStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        searchString: props?.searchString ?? '/api/login',
                        fieldToMatch: {
                          uriPath: {},
                        },
                        positionalConstraint: 'EXACTLY',
                        textTransformations: [
                          {
                            priority: 0,
                            type: 'NONE',
                          },
                        ],
                      },
                    },
                    {
                      geoMatchStatement: {
                        countryCodes: props?.countryCodes ?? ['CN', 'RU'],
                      },
                    },
                  ],
                },
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'uri-country-based',
          },
        },
        {
          name: 'LoginRateLimitRule',
          priority: 0, // Ensure priorities do not overlap with existing rules
          action: {
            block: {},
          },
          statement: {
            rateBasedStatement: {
              limit: props?.rateBasedRuleLimit ?? 300,
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              scopeDownStatement: {
                byteMatchStatement: {
                  searchString: props?.searchString ?? '/api/login',
                  fieldToMatch: {
                    uriPath: {},
                  },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'NONE',
                    },
                  ],
                  positionalConstraint: 'STARTS_WITH',
                },
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'login-rate-limit-rule',
          },
        },
      ],
    });

    this.webAcl = new CfnWebACL(this, 'WebAcl', {
      name: props?.webAclName ?? 'SecurityBaselineWebACL',
      defaultAction: {allow: {}},
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'globalWebAclMetric',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 0,
          overrideAction: props?.mode === 'active' ? {none: {}} : {count: {}},
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'SecurityBaselineRuleGroup',
          priority: 1,
          overrideAction: props?.mode === 'active' ? {none: {}} : {count: {}},
          statement: {
            ruleGroupReferenceStatement: {
              arn: this.ruleGroup.attrArn,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'SecurityBaselineRuleGroupMetric',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: props?.mode === 'active' ? {none: {}} : {count: {}},
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWS-AWSManagedRulesAnonymousIpList',
          priority: 3,
          overrideAction: props?.mode === 'active' ? {none: {}} : {count: {}},
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAnonymousIpList',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesAnonymousIpListMetric',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 4,
          overrideAction: props?.mode === 'active' ? {none: {}} : {count: {}},
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesAmazonIpReputationListMetric',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    this.webAcl.addPropertyOverride(
      'Rules.3.Statement.ManagedRuleGroupStatement.RuleActionOverrides',
      [{Name: 'HostingProviderIPList', ActionToUse: {Count: {}}}],
    );

    const logGroupName = `aws-waf-logs-global-waf-acl-logs-${this.node.addr}`;
    const wafLogGroup = new LogGroup(this, 'WafLogGroup', {
      logGroupName,
      retention: props?.logRetention ?? RetentionDays.ONE_YEAR,
      removalPolicy: props?.logRemovalPolicy,
    });

    const loggingConfig = new CfnLoggingConfiguration(this, 'LoggingConfig', {
      resourceArn: this.webAcl.attrArn,
      // logGroupArn ends in ':*'; AWS WAF documents the log group ARN without it.
      logDestinationConfigs: [
        Stack.of(this).formatArn({
          service: 'logs',
          resource: 'log-group',
          resourceName: logGroupName,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
    });
    // The ARN is built from the name, so CloudFormation no longer infers the order.
    loggingConfig.node.addDependency(wafLogGroup);
  }
}
