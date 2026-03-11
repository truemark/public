import {WebAclBuilder} from './web-acl-builder';
import {ExtendedConstruct} from '../../aws-cdk';

export class WebAclRuleBuilder extends ExtendedConstruct {
  constructor(scope: WebAclBuilder, id: string) {
    super(scope, id);
  }
}
