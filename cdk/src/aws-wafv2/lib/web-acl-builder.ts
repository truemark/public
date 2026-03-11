import {CfnWebACL} from 'aws-cdk-lib/aws-wafv2';
import {ExtendedConstruct} from '../../aws-cdk';
import {Construct} from 'constructs';
import {WebAclRuleBuilder} from './web-acl-rule-builder';

export interface WebAclActionHeader {
  name: string;
  value: string;
}

export interface WebAclBlockAction {
  action: 'block';
  responseCode?: number;
  customResponseBodyKey?: string;
  responseHeaders?: WebAclActionHeader[];
}

export interface WebAclAllowAction {
  action: 'allow';
  responseHeaders?: WebAclActionHeader[];
}

export class WebAclBuilder extends ExtendedConstruct {
  private webAclRuleBuilders: WebAclRuleBuilder[] = [];
  private action = {
    action: 'allow',
  };

  constructor(scope: Construct, id: string) {
    super(scope, id);
  }

  /**
   * Allows overriding the default action which is to allow.
   *
   * @param action - The default action to use.
   */
  defaultAction(action: WebAclBlockAction | WebAclAllowAction): WebAclBuilder {
    this.action = action;
    return this;
  }

  addCountryBlockRule(countries: string[]): WebAclBuilder {
    const builder = new WebAclRuleBuilder(this, 'CountryBlockRule');
    this.webAclRuleBuilders.push(builder);
    // TODO Implement me!
    return this;
  }

  addRule(): WebAclRuleBuilder {
    const builder = new WebAclRuleBuilder(this, 'Rule');
    this.webAclRuleBuilders.push(builder);
    return builder;
  }

  toWebAcl(): CfnWebACL {}
}
