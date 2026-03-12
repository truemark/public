import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLProps,
} from 'aws-cdk-lib/aws-wafv2';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {ExtendedConstruct} from '../../aws-cdk';
import {Construct} from 'constructs';
import {WebAclRuleBuilder} from './web-acl-rule-builder';

export type WebAclScope = 'CLOUDFRONT' | 'REGIONAL';

/**
 * Builder for creating WAFv2 WebACLs with a fluent API.
 * Similar to DistributionBuilder for CloudFront distributions.
 */
export class WebAclBuilder extends ExtendedConstruct {
  private _name?: string;
  private _scope: WebAclScope;
  private _defaultAction: CfnWebACL.DefaultActionProperty = {allow: {}};
  private _description?: string;
  private _visibilityConfig?: CfnWebACL.VisibilityConfigProperty;
  private _logRetention?: RetentionDays;
  private _enableLogging: boolean = true;
  private _customResponseBodies?: {
    [key: string]: CfnWebACL.CustomResponseBodyProperty;
  };
  private _tokenDomains?: string[];

  private rules: WebAclRuleBuilder[] = [];
  private nextPriority: number = 0;

  // Track which default AWS managed rules to include
  private includeCommonRuleSet: boolean = true;
  private includeKnownBadInputs: boolean = true;
  private includeAnonymousIpList: boolean = true;
  private includeIpReputationList: boolean = true;

  // Track which default custom rules to include
  private includeAllEndpointsRateLimit: boolean = true;
  private includeSpecificEndpointRateLimit: boolean = true;
  private includeGeoBlocking: boolean = true;

  // Configuration for default custom rules
  private allEndpointsRateLimit: number = 100;
  private specificEndpointRateLimit: number = 20;
  private specificEndpointPath: string = '/api/login';
  private geoBlockCountries: string[] = ['CN', 'RU', 'KP'];

  // Store mode for managed rules (count or active/none)
  private managedRulesMode: 'count' | 'active' = 'count';

  constructor(scope: Construct, id: string, wafScope: WebAclScope) {
    super(scope, id);
    this._scope = wafScope;
  }

  /**
   * Sets the name of the WebACL.
   */
  name(name: string): WebAclBuilder {
    this._name = name;
    return this;
  }

  /**
   * Sets the description of the WebACL.
   */
  description(description: string): WebAclBuilder {
    this._description = description;
    return this;
  }

  /**
   * Sets the default action (allow or block).
   */
  defaultAllow(): WebAclBuilder {
    this._defaultAction = {allow: {}};
    return this;
  }

  /**
   * Sets the default action to block.
   */
  defaultBlock(): WebAclBuilder {
    this._defaultAction = {block: {}};
    return this;
  }

  /**
   * Sets the visibility configuration for the WebACL.
   */
  visibilityConfig(
    metricName: string,
    cloudWatchMetricsEnabled: boolean = true,
    sampledRequestsEnabled: boolean = true,
  ): WebAclBuilder {
    this._visibilityConfig = {
      metricName,
      cloudWatchMetricsEnabled,
      sampledRequestsEnabled,
    };
    return this;
  }

  /**
   * Sets the CloudWatch log retention period.
   */
  logRetention(retention: RetentionDays): WebAclBuilder {
    this._logRetention = retention;
    return this;
  }

  /**
   * Enables or disables logging.
   */
  enableLogging(enabled: boolean): WebAclBuilder {
    this._enableLogging = enabled;
    return this;
  }

  /**
   * Sets custom response bodies.
   */
  customResponseBodies(bodies: {
    [key: string]: CfnWebACL.CustomResponseBodyProperty;
  }): WebAclBuilder {
    this._customResponseBodies = bodies;
    return this;
  }

  /**
   * Sets token domains for CAPTCHA/Challenge.
   */
  tokenDomains(domains: string[]): WebAclBuilder {
    this._tokenDomains = domains;
    return this;
  }

  /**
   * Sets the mode for AWS managed rule groups (count for testing, active for production).
   */
  managedRuleGroupsMode(mode: 'count' | 'active'): WebAclBuilder {
    this.managedRulesMode = mode;
    return this;
  }

  /**
   * Configures which default AWS managed rule groups to include.
   * By default, all are included. Call this to customize.
   */
  defaultManagedRules(options: {
    commonRuleSet?: boolean;
    knownBadInputs?: boolean;
    anonymousIpList?: boolean;
    ipReputationList?: boolean;
  }): WebAclBuilder {
    if (options.commonRuleSet !== undefined) {
      this.includeCommonRuleSet = options.commonRuleSet;
    }
    if (options.knownBadInputs !== undefined) {
      this.includeKnownBadInputs = options.knownBadInputs;
    }
    if (options.anonymousIpList !== undefined) {
      this.includeAnonymousIpList = options.anonymousIpList;
    }
    if (options.ipReputationList !== undefined) {
      this.includeIpReputationList = options.ipReputationList;
    }
    return this;
  }

  /**
   * Configures which default custom rules to include.
   * By default, all are included (rate limiting and geo-blocking).
   */
  defaultCustomRules(options: {
    allEndpointsRateLimit?: boolean;
    specificEndpointRateLimit?: boolean;
    geoBlocking?: boolean;
  }): WebAclBuilder {
    if (options.allEndpointsRateLimit !== undefined) {
      this.includeAllEndpointsRateLimit = options.allEndpointsRateLimit;
    }
    if (options.specificEndpointRateLimit !== undefined) {
      this.includeSpecificEndpointRateLimit = options.specificEndpointRateLimit;
    }
    if (options.geoBlocking !== undefined) {
      this.includeGeoBlocking = options.geoBlocking;
    }
    return this;
  }

  /**
   * Configures rate limiting thresholds and endpoint.
   */
  rateLimitConfig(options: {
    allEndpointsLimit?: number;
    specificEndpointLimit?: number;
    specificEndpointPath?: string;
  }): WebAclBuilder {
    if (options.allEndpointsLimit !== undefined) {
      this.allEndpointsRateLimit = options.allEndpointsLimit;
    }
    if (options.specificEndpointLimit !== undefined) {
      this.specificEndpointRateLimit = options.specificEndpointLimit;
    }
    if (options.specificEndpointPath !== undefined) {
      this.specificEndpointPath = options.specificEndpointPath;
    }
    return this;
  }

  /**
   * Configures geo-blocking countries.
   */
  geoBlockingConfig(countryCodes: string[]): WebAclBuilder {
    this.geoBlockCountries = countryCodes;
    return this;
  }

  /**
   * Disables all default AWS managed rule groups.
   * Use this if you want to manually add only specific rules.
   */
  noDefaultManagedRules(): WebAclBuilder {
    this.includeCommonRuleSet = false;
    this.includeKnownBadInputs = false;
    this.includeAnonymousIpList = false;
    this.includeIpReputationList = false;
    return this;
  }

  /**
   * Disables all default custom rules (rate limiting and geo-blocking).
   * Use this if you want to manually configure these rules.
   */
  noDefaultCustomRules(): WebAclBuilder {
    this.includeAllEndpointsRateLimit = false;
    this.includeSpecificEndpointRateLimit = false;
    this.includeGeoBlocking = false;
    return this;
  }

  /**
   * Disables all default rules (both AWS managed and custom rules).
   */
  noDefaultRules(): WebAclBuilder {
    this.noDefaultManagedRules();
    this.noDefaultCustomRules();
    return this;
  }

  /**
   * Adds AWS Managed Rules Common Rule Set.
   */
  addCommonRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'CommonRuleSet');
    builder
      .name('AWS-AWSManagedRulesCommonRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesCommonRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesCommonRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Known Bad Inputs Rule Set.
   */
  addKnownBadInputsRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'KnownBadInputsRuleSet');
    builder
      .name('AWS-AWSManagedRulesKnownBadInputsRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup(
        'AWSManagedRulesKnownBadInputsRuleSet',
        excludedRules,
      )
      .visibilityConfig('AWSManagedRulesKnownBadInputsRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Anonymous IP List.
   */
  addAnonymousIpList(
    excludedRules?: string[],
    ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[],
  ): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'AnonymousIpList');

    // Default to override HostingProviderIPList to Count
    const overrides = ruleActionOverrides ?? [
      {
        name: 'HostingProviderIPList',
        actionToUse: {count: {}},
      },
    ];

    builder
      .name('AWS-AWSManagedRulesAnonymousIpList')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup(
        'AWSManagedRulesAnonymousIpList',
        excludedRules,
        overrides,
      )
      .visibilityConfig('AWSManagedRulesAnonymousIpListMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Amazon IP Reputation List.
   */
  addIpReputationList(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'IpReputationList');
    builder
      .name('AWS-AWSManagedRulesAmazonIpReputationList')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup(
        'AWSManagedRulesAmazonIpReputationList',
        excludedRules,
      )
      .visibilityConfig('AWSManagedRulesAmazonIpReputationListMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules SQL Injection Rule Set.
   */
  addSqlInjectionRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'SqlInjectionRuleSet');
    builder
      .name('AWS-AWSManagedRulesSQLiRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesSQLiRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesSQLiRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Linux Operating System Rule Set.
   */
  addLinuxRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'LinuxRuleSet');
    builder
      .name('AWS-AWSManagedRulesLinuxRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesLinuxRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesLinuxRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Unix Operating System Rule Set.
   */
  addUnixRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'UnixRuleSet');
    builder
      .name('AWS-AWSManagedRulesUnixRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesUnixRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesUnixRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules Windows Operating System Rule Set.
   */
  addWindowsRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'WindowsRuleSet');
    builder
      .name('AWS-AWSManagedRulesWindowsRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesWindowsRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesWindowsRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules PHP Application Rule Set.
   */
  addPhpRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'PhpRuleSet');
    builder
      .name('AWS-AWSManagedRulesPHPRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesPHPRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesPHPRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds AWS Managed Rules WordPress Application Rule Set.
   */
  addWordPressRuleSet(excludedRules?: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'WordPressRuleSet');
    builder
      .name('AWS-AWSManagedRulesWordPressRuleSet')
      .priority(this.nextPriority++)
      .awsManagedRuleGroup('AWSManagedRulesWordPressRuleSet', excludedRules)
      .visibilityConfig('AWSManagedRulesWordPressRuleSetMetric');

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds a custom AWS managed rule group.
   */
  addAwsManagedRuleGroup(
    name: string,
    displayName: string,
    excludedRules?: string[],
    ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[],
  ): WebAclBuilder {
    const builder = new WebAclRuleBuilder(
      this,
      `ManagedRule${this.nextPriority}`,
    );
    builder
      .name(displayName)
      .priority(this.nextPriority++)
      .awsManagedRuleGroup(name, excludedRules, ruleActionOverrides)
      .visibilityConfig(`${displayName}Metric`);

    if (this.managedRulesMode === 'active') {
      builder.overrideNone();
    } else {
      builder.overrideCount();
    }

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds a geo-blocking rule that blocks traffic from specified countries.
   * Default countries: CN (China), RU (Russia), KP (North Korea)
   */
  addGeoBlockRule(
    countryCodes: string[] = ['CN', 'RU', 'KP'],
    ruleName: string = 'GeoBlock',
  ): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'GeoBlockRule');
    builder
      .name(ruleName)
      .priority(this.nextPriority++)
      .geoMatchRule(countryCodes)
      .blockAction()
      .visibilityConfig(`${ruleName}Metric`);

    this.rules.push(builder);
    return this;
  }

  /**
   * Adds default rate limiting rule for ALL endpoints.
   * @private
   */
  private addDefaultAllEndpointsRateLimit(): void {
    const builder = new WebAclRuleBuilder(this, 'RateLimitAllEndpoints');
    builder
      .name('RateLimit-AllEndpoints')
      .priority(this.nextPriority++)
      .rateBasedRule(this.allEndpointsRateLimit, undefined, 300)
      .countAction() // Always count mode for monitoring
      .visibilityConfig('RateLimitAllEndpointsMetric');

    this.rules.push(builder);
  }

  /**
   * Adds default rate limiting rule for a SPECIFIC endpoint.
   * @private
   */
  private addDefaultSpecificEndpointRateLimit(): void {
    const builder = new WebAclRuleBuilder(this, 'RateLimitSpecificEndpoint');
    builder
      .name('RateLimit-SpecificEndpoint')
      .priority(this.nextPriority++)
      .rateBasedRule(
        this.specificEndpointRateLimit,
        {
          byteMatchStatement: {
            searchString: this.specificEndpointPath,
            fieldToMatch: {uriPath: {}},
            positionalConstraint: 'STARTS_WITH',
            textTransformations: [{priority: 0, type: 'NONE'}],
          },
        },
        300,
      )
      .blockAction() // Block by default for endpoint protection
      .visibilityConfig('RateLimitSpecificEndpointMetric');

    this.rules.push(builder);
  }

  /**
   * Adds default geo-blocking rule for high-risk countries.
   * @private
   */
  private addDefaultGeoBlocking(): void {
    const builder = new WebAclRuleBuilder(this, 'GeoBlockHighRiskCountries');
    builder
      .name('GeoBlock-HighRiskCountries')
      .priority(this.nextPriority++)
      .geoMatchRule(this.geoBlockCountries)
      .countAction() // Count mode by default for testing
      .visibilityConfig('GeoBlockHighRiskCountriesMetric');

    this.rules.push(builder);
  }

  /**
   * Creates a new custom rule builder.
   */
  rule(name: string): WebAclRuleBuilder {
    const builder = new WebAclRuleBuilder(this, `Rule${this.nextPriority}`);
    builder.name(name).priority(this.nextPriority++);
    this.rules.push(builder);
    return builder;
  }

  /**
   * Adds a rule builder to the WebACL (used internally by WebAclRuleBuilder).
   */
  addRule(builder: WebAclRuleBuilder): WebAclBuilder {
    if (!this.rules.includes(builder)) {
      this.rules.push(builder);
    }
    return this;
  }

  /**
   * Builds and returns the WebACL properties.
   */
  build(): CfnWebACLProps {
    // Add default AWS managed rules if not disabled
    if (
      this.rules.length === 0 ||
      this.includeCommonRuleSet ||
      this.includeKnownBadInputs ||
      this.includeAnonymousIpList ||
      this.includeIpReputationList
    ) {
      // Only add defaults that haven't been manually added and are enabled
      const hasCommonRuleSet = this.rules.some(
        (r) => r.buildRule().name === 'AWS-AWSManagedRulesCommonRuleSet',
      );
      const hasKnownBadInputs = this.rules.some(
        (r) =>
          r.buildRule().name === 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
      );
      const hasAnonymousIpList = this.rules.some(
        (r) => r.buildRule().name === 'AWS-AWSManagedRulesAnonymousIpList',
      );
      const hasIpReputationList = this.rules.some(
        (r) =>
          r.buildRule().name === 'AWS-AWSManagedRulesAmazonIpReputationList',
      );

      if (this.includeCommonRuleSet && !hasCommonRuleSet) {
        this.addCommonRuleSet();
      }
      if (this.includeKnownBadInputs && !hasKnownBadInputs) {
        this.addKnownBadInputsRuleSet();
      }
      if (this.includeAnonymousIpList && !hasAnonymousIpList) {
        this.addAnonymousIpList();
      }
      if (this.includeIpReputationList && !hasIpReputationList) {
        this.addIpReputationList();
      }
    }

    // Add default custom rules if not disabled
    const hasAllEndpointsRateLimit = this.rules.some(
      (r) => r.buildRule().name === 'RateLimit-AllEndpoints',
    );
    const hasSpecificEndpointRateLimit = this.rules.some(
      (r) => r.buildRule().name === 'RateLimit-SpecificEndpoint',
    );
    const hasGeoBlocking = this.rules.some(
      (r) => r.buildRule().name === 'GeoBlock-HighRiskCountries',
    );

    if (this.includeAllEndpointsRateLimit && !hasAllEndpointsRateLimit) {
      this.addDefaultAllEndpointsRateLimit();
    }
    if (
      this.includeSpecificEndpointRateLimit &&
      !hasSpecificEndpointRateLimit
    ) {
      this.addDefaultSpecificEndpointRateLimit();
    }
    if (this.includeGeoBlocking && !hasGeoBlocking) {
      this.addDefaultGeoBlocking();
    }

    // Set defaults
    if (!this._name) {
      this._name =
        this._scope === 'CLOUDFRONT' ? 'CloudFrontWebACL' : 'RegionalWebACL';
    }

    if (!this._visibilityConfig) {
      this._visibilityConfig = {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${this._name}Metric`,
      };
    }

    const webAclProps: CfnWebACLProps = {
      name: this._name,
      scope: this._scope,
      defaultAction: this._defaultAction,
      visibilityConfig: this._visibilityConfig,
      rules: this.rules.map((r) => r.buildRule()),
      ...(this._description && {description: this._description}),
      ...(this._customResponseBodies && {
        customResponseBodies: this._customResponseBodies,
      }),
      ...(this._tokenDomains && {tokenDomains: this._tokenDomains}),
    };

    return webAclProps;
  }

  /**
   * Creates the CfnWebACL resource and optionally logging.
   */
  toWebAcl(): CfnWebACL {
    const props = this.build();
    const webAcl = new CfnWebACL(this, 'WebACL', props);

    // Add logging if enabled
    if (this._enableLogging) {
      const logGroup = new LogGroup(this, 'LogGroup', {
        logGroupName: `aws-waf-logs-${this._scope.toLowerCase()}-${this.node.addr}`,
        retention: this._logRetention ?? RetentionDays.ONE_YEAR,
      });

      new CfnLoggingConfiguration(this, 'LoggingConfiguration', {
        resourceArn: webAcl.attrArn,
        logDestinationConfigs: [logGroup.logGroupArn],
      });
    }

    return webAcl;
  }
}
