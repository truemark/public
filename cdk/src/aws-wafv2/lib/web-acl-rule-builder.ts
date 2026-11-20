import {CfnWebACL} from 'aws-cdk-lib/aws-wafv2';
import {WebAclBuilder} from './web-acl-builder';
import {ExtendedConstruct} from '../../aws-cdk';

/**
 * Builder for creating WAFv2 rules with a fluent API.
 * Similar to BehaviorBuilder for CloudFront distributions.
 */
export class WebAclRuleBuilder extends ExtendedConstruct {
  private _name?: string;
  private _priority?: number;
  private _action?: CfnWebACL.RuleActionProperty;
  private _overrideAction?: CfnWebACL.OverrideActionProperty;
  private _statement?: CfnWebACL.StatementProperty;
  private _visibilityConfig?: CfnWebACL.VisibilityConfigProperty;
  private readonly parentBuilder: WebAclBuilder;

  constructor(scope: WebAclBuilder, id: string) {
    super(scope, id);
    this.parentBuilder = scope;
  }

  /**
   * Sets the name of the rule.
   */
  name(name: string): WebAclRuleBuilder {
    this._name = name;
    return this;
  }

  /**
   * Sets the priority of the rule. Lower numbers are processed first.
   */
  priority(priority: number): WebAclRuleBuilder {
    this._priority = priority;
    return this;
  }

  /**
   * Sets an allow action for the rule.
   */
  allowAction(): WebAclRuleBuilder {
    this._action = {allow: {}};
    this._overrideAction = undefined;
    return this;
  }

  /**
   * Sets a block action for the rule.
   */
  blockAction(): WebAclRuleBuilder {
    this._action = {block: {}};
    this._overrideAction = undefined;
    return this;
  }

  /**
   * Sets a count action for the rule.
   */
  countAction(): WebAclRuleBuilder {
    this._action = {count: {}};
    this._overrideAction = undefined;
    return this;
  }

  /**
   * Sets the override action to none (for managed rule groups).
   */
  overrideNone(): WebAclRuleBuilder {
    this._overrideAction = {none: {}};
    this._action = undefined;
    return this;
  }

  /**
   * Sets the override action to count (for managed rule groups).
   */
  overrideCount(): WebAclRuleBuilder {
    this._overrideAction = {count: {}};
    this._action = undefined;
    return this;
  }

  /**
   * Sets the visibility configuration for CloudWatch metrics and sampling.
   */
  visibilityConfig(
    metricName: string,
    cloudWatchMetricsEnabled: boolean = true,
    sampledRequestsEnabled: boolean = true,
  ): WebAclRuleBuilder {
    this._visibilityConfig = {
      metricName,
      cloudWatchMetricsEnabled,
      sampledRequestsEnabled,
    };
    return this;
  }

  /**
   * Configures an AWS managed rule group statement.
   */
  awsManagedRuleGroup(
    name: string,
    excludedRules?: string[],
    ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[],
  ): WebAclRuleBuilder {
    this._statement = {
      managedRuleGroupStatement: {
        vendorName: 'AWS',
        name,
        excludedRules: excludedRules?.map((ruleName) => ({name: ruleName})),
        ruleActionOverrides,
      },
    };
    return this;
  }

  /**
   * Configures a custom managed rule group statement.
   */
  managedRuleGroup(
    vendorName: string,
    name: string,
    excludedRules?: string[],
    ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[],
  ): WebAclRuleBuilder {
    this._statement = {
      managedRuleGroupStatement: {
        vendorName,
        name,
        excludedRules: excludedRules?.map((ruleName) => ({name: ruleName})),
        ruleActionOverrides,
      },
    };
    return this;
  }

  /**
   * Configures a rate-based statement with IP aggregation.
   */
  rateBasedRule(
    limit: number,
    scopeDownStatement?: CfnWebACL.StatementProperty,
    evaluationWindowSec: number = 300,
  ): WebAclRuleBuilder {
    this._statement = {
      rateBasedStatement: {
        limit,
        aggregateKeyType: 'IP',
        evaluationWindowSec,
        scopeDownStatement,
      },
    };
    return this;
  }

  /**
   * Configures a rate-based statement with forwarded IP aggregation.
   */
  rateBasedRuleForwardedIp(
    limit: number,
    headerName: string,
    fallbackBehavior: 'MATCH' | 'NO_MATCH',
    scopeDownStatement?: CfnWebACL.StatementProperty,
    evaluationWindowSec: number = 300,
  ): WebAclRuleBuilder {
    this._statement = {
      rateBasedStatement: {
        limit,
        aggregateKeyType: 'FORWARDED_IP',
        evaluationWindowSec,
        forwardedIpConfig: {
          headerName,
          fallbackBehavior,
        },
        scopeDownStatement,
      },
    };
    return this;
  }

  /**
   * Configures a geo match statement.
   */
  geoMatchRule(countryCodes: string[]): WebAclRuleBuilder {
    this._statement = {
      geoMatchStatement: {
        countryCodes,
      },
    };
    return this;
  }

  /**
   * Configures a byte match statement for URI path.
   */
  uriPathMatch(
    searchString: string,
    positionalConstraint: 'EXACTLY' | 'STARTS_WITH' | 'ENDS_WITH' | 'CONTAINS',
  ): WebAclRuleBuilder {
    this._statement = {
      byteMatchStatement: {
        searchString,
        fieldToMatch: {
          uriPath: {},
        },
        positionalConstraint,
        textTransformations: [
          {
            priority: 0,
            type: 'NONE',
          },
        ],
      },
    };
    return this;
  }

  /**
   * Configures a reference to a custom rule group.
   */
  ruleGroupReference(
    arn: string,
    excludedRules?: string[],
    ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[],
  ): WebAclRuleBuilder {
    this._statement = {
      ruleGroupReferenceStatement: {
        arn,
        excludedRules: excludedRules?.map((name) => ({name})),
        ruleActionOverrides,
      },
    };
    return this;
  }

  /**
   * Combines multiple statements with AND logic.
   */
  andStatement(
    ...statements: CfnWebACL.StatementProperty[]
  ): WebAclRuleBuilder {
    this._statement = {
      andStatement: {
        statements,
      },
    };
    return this;
  }

  /**
   * Combines multiple statements with OR logic.
   */
  orStatement(...statements: CfnWebACL.StatementProperty[]): WebAclRuleBuilder {
    this._statement = {
      orStatement: {
        statements,
      },
    };
    return this;
  }

  /**
   * Sets a custom statement property directly for advanced use cases.
   */
  customStatement(statement: CfnWebACL.StatementProperty): WebAclRuleBuilder {
    this._statement = statement;
    return this;
  }

  /**
   * Builds and returns the rule configuration.
   */
  buildRule(): CfnWebACL.RuleProperty {
    if (!this._name) {
      throw new Error('Rule name is required');
    }
    if (this._priority === undefined) {
      throw new Error('Rule priority is required');
    }
    if (!this._statement) {
      throw new Error('Rule statement is required');
    }

    // Set default visibility config if not provided
    if (!this._visibilityConfig) {
      this._visibilityConfig = {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: this._name,
      };
    }

    // Detect if this is a rule-group statement (managed or custom)
    const isRuleGroupStatement =
      'managedRuleGroupStatement' in this._statement ||
      'ruleGroupReferenceStatement' in this._statement;

    // Validate action/overrideAction usage
    if (isRuleGroupStatement) {
      if (this._action) {
        throw new Error(
          `Rule "${this._name}" uses a rule group statement and must use overrideAction, not action. ` +
            `Use .overrideCount() or .overrideNone() instead of .countAction(), .allowAction(), or .blockAction().`,
        );
      }
      // Default to overrideAction count for rule groups if not specified
      if (!this._overrideAction) {
        this._overrideAction = {count: {}};
      }
    } else {
      if (this._overrideAction) {
        throw new Error(
          `Rule "${this._name}" does not use a rule group statement and must use action, not overrideAction. ` +
            `Use .countAction(), .allowAction(), or .blockAction() instead of .overrideCount() or .overrideNone().`,
        );
      }
      // Default to action count for non-rule-group statements if not specified
      if (!this._action) {
        this._action = {count: {}};
      }
    }

    // Build the rule with appropriate action/overrideAction
    const actionOrOverride = this._action
      ? {action: this._action}
      : {overrideAction: this._overrideAction!};

    const rule: CfnWebACL.RuleProperty = {
      name: this._name,
      priority: this._priority,
      statement: this._statement,
      visibilityConfig: this._visibilityConfig,
      ...actionOrOverride,
    };

    return rule;
  }

  /**
   * Creates a new rule builder on the parent WebAclBuilder.
   */
  rule(name: string): WebAclRuleBuilder {
    return this.parentBuilder.rule(name);
  }

  /**
   * Creates the CfnWebACL resource from the parent builder.
   */
  toWebAcl(): CfnWebACL {
    return this.parentBuilder.toWebAcl();
  }
}
