import {Construct} from 'constructs/lib/construct';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {
  CfnLoggingConfiguration,
  CfnRuleGroup,
  CfnWebACL,
} from 'aws-cdk-lib/aws-wafv2';
import {ExtendedConstruct} from '../../aws-cdk/index';

export type regionalBlockMode = 'count' | 'active';

export interface RegionalSecurityBaselineWebAclProps {
  /**
   * The mode of the rule group. To Block or to Count. By default it is set to count.
   */
  readonly mode?: regionalBlockMode;
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
 * The `RegionalSecurityBaselineWebAcl` class represents a regional security baseline Web Access Control List (WebACL).
 * This WebACL is designed to provide a baseline level of security for your regional resources.
 * It includes rules for blocking or counting requests based on various conditions such as the country of origin and the request rate.
 */
export class RegionalSecurityBaselineWebAcl extends ExtendedConstruct {
  readonly regionalRuleGroup: CfnRuleGroup;
  readonly regionalWebAcl: CfnWebACL;
  constructor(
    scope: Construct,
    id: string,
    props?: RegionalSecurityBaselineWebAclProps,
  ) {
    super(scope, id);

    this.regionalRuleGroup = new CfnRuleGroup(this, 'RegionalRuleGroup', {
      name: props?.name ?? 'SecurityBaselineRuleGroup',
      scope: 'REGIONAL',
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
              aggregateKeyType: 'FORWARDED_IP',
              evaluationWindowSec: 300,
              forwardedIpConfig: {
                headerName: 'X-Forwarded-For',
                fallbackBehavior: 'NO_MATCH',
              },
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

    this.regionalWebAcl = new CfnWebACL(this, 'WebAcl', {
      name: props?.webAclName ?? 'RegionalSecurityBaselineWebACL',
      defaultAction: {allow: {}},
      scope: 'REGIONAL',
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
              arn: this.regionalRuleGroup.attrArn,
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

    this.regionalWebAcl.addPropertyOverride(
      'Rules.3.Statement.ManagedRuleGroupStatement.RuleActionOverrides',
      [{Name: 'HostingProviderIPList', ActionToUse: {Count: {}}}],
    );

    const wafRegionalLogGroup = new LogGroup(this, 'RegionalWafLogGroup', {
      logGroupName: `aws-waf-logs-regional-waf-acl-logs-${this.node.addr}`,
      retention: props?.logRetention ?? RetentionDays.ONE_YEAR,
    });

    new CfnLoggingConfiguration(this, 'RegionalLoggingConfig', {
      resourceArn: this.regionalWebAcl.attrArn,
      logDestinationConfigs: [wafRegionalLogGroup.logGroupArn],
    });
  }
}
