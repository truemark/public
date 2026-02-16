import {
  AwsCustomResource,
  AwsSdkCall,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import {Construct} from 'constructs';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {Duration, Stack} from 'aws-cdk-lib';
import {configureLogGroupForFunction} from '../../aws-lambda/lib/function-log-options';

/**
 * Properties for PutItem.
 */
export interface PutItemProps {
  /**
   * The name of the DynamoDB table to write to.
   */
  readonly tableName: string;

  /**
   * The item to store.
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  readonly item: any;

  /**
   * The timeout for the Lambda function. Default is 2 minutes.
   *
   * @default Duration.minutes(2)
   */
  readonly timeout?: Duration;

  /**
   * Log retention days. The default is 5.
   */
  readonly logRetention?: number;
}

/**
 * Custom resource to insert data into a DynamoDB table. This class is intended to be used with
 * the marshall command @aws-sdk/util-dynamodb as an alternative to using DynamoPutItem.
 */
export class PutItem extends Construct {
  readonly resource: AwsCustomResource;

  constructor(scope: Construct, id: string, props: PutItemProps) {
    super(scope, id);

    const call: AwsSdkCall = {
      service: 'DynamoDB',
      action: 'putItem',
      parameters: {
        TableName: props.tableName,
        Item: props.item,
      },
      physicalResourceId: PhysicalResourceId.of(Date.now().toString()),
    };

    const logGroup = configureLogGroupForFunction(
      scope,
      `${id}LogGroup`,
      props,
    );

    this.resource = new AwsCustomResource(this, 'Default', {
      logGroup,
      onUpdate: call,
      installLatestAwsSdk: false,
      policy: {
        statements: [
          new PolicyStatement({
            resources: [
              Stack.of(this).formatArn({
                service: 'dynamodb',
                resource: 'table',
                resourceName: props.tableName,
              }),
            ],
            actions: ['dynamodb:PutItem'],
            effect: Effect.ALLOW,
          }),
        ],
      },
      timeout: props.timeout ?? Duration.minutes(2),
    });
  }
}
