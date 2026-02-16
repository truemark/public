import {AwsCustomResource, AwsSdkCall} from 'aws-cdk-lib/custom-resources';
import {Construct} from 'constructs';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {Duration} from 'aws-cdk-lib';

/**
 * Properties for ParameterReader
 */
export interface ParameterReaderProps {
  readonly parameterName: string;
  readonly region: string;
  readonly timeout?: Duration;
}

/**
 * Custom resource allowing SSM parameter strings to be read across regions.
 */
export class ParameterReader extends AwsCustomResource {
  constructor(scope: Construct, id: string, props: ParameterReaderProps) {
    const call: AwsSdkCall = {
      service: 'SSM',
      action: 'getParameter',
      parameters: {
        Name: props.parameterName,
      },
      region: props.region,
      physicalResourceId: {id: Date.now().toString()},
    };

    super(scope, id, {
      installLatestAwsSdk: false,
      onUpdate: call,
      policy: {
        statements: [
          new PolicyStatement({
            resources: ['*'], // TODO This needs to be made more exact
            actions: ['ssm:GetParameter'],
            effect: Effect.ALLOW,
          }),
        ],
      },
      timeout: props.timeout ?? Duration.minutes(2),
    });
  }

  getStringValue(): string {
    return this.getResponseField('Parameter.Value').toString();
  }
}
