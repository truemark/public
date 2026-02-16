import {AwsCustomResource, AwsSdkCall} from 'aws-cdk-lib/custom-resources';
import {Construct} from 'constructs';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';

export interface ReceiptRuleSetActivatorProps {
  readonly ruleSetName: string;
}

export class ReceiptRuleSetActivator extends AwsCustomResource {
  constructor(
    scope: Construct,
    id: string,
    props: ReceiptRuleSetActivatorProps,
  ) {
    const call: AwsSdkCall = {
      service: 'SES',
      action: 'setActiveReceiptRuleSet',
      physicalResourceId: {id: Date.now().toString()},
      parameters: {
        RuleSetName: props.ruleSetName,
      },
    };
    super(scope, id, {
      onUpdate: call,
      policy: {
        statements: [
          new PolicyStatement({
            resources: ['*'],
            actions: ['ses:SetActiveReceiptRuleSet'],
            effect: Effect.ALLOW,
          }),
        ],
      },
    });
  }
}
