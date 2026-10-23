import {Duration, Stack, Token} from 'aws-cdk-lib';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import type {ILogGroup} from 'aws-cdk-lib/aws-logs';
import {AwsCustomResource, type AwsSdkCall} from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {configureLogGroupForCustomResource} from '../../aws-lambda/lib/function-log-options';

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
      logGroup: ParameterReader.providerLogGroup(scope),
      policy: {
        statements: [
          new PolicyStatement({
            resources: [ParameterReader.parameterArn(scope, props)],
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

  private static parameterArn(
    scope: Construct,
    props: ParameterReaderProps,
  ): string {
    // A name with a leading slash drops it in the ARN (parameter/a/b), which
    // cannot be decided for a token, so a token falls back to every parameter
    // in the region.
    const resourceName = Token.isUnresolved(props.parameterName)
      ? '*'
      : props.parameterName.replace(/^\//, '');
    return Stack.of(scope).formatArn({
      service: 'ssm',
      region: props.region,
      resource: 'parameter',
      resourceName,
    });
  }

  // Every AwsCustomResource in a stack runs on one singleton provider function
  // that keeps the log group of the first one created, so one group per stack
  // is enough.
  private static providerLogGroup(scope: Construct): ILogGroup {
    const stack = Stack.of(scope);
    const id = 'ParameterReaderLogGroup';
    return (
      (stack.node.tryFindChild(id) as ILogGroup | undefined) ??
      configureLogGroupForCustomResource(stack, id, {})
    );
  }
}
