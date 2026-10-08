import {Duration, Stack} from 'aws-cdk-lib';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {
  AwsCustomResource,
  type AwsSdkCall,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import {Construct} from 'constructs';
import {configureLogGroupForCustomResource} from '../../aws-lambda/lib/function-log-options';

export type BatchWriteItemKey = {
  Key: Record<string, any>;
};

export type BatchWriteItemItem = {
  Item: Record<string, any>;
};

export type BatchWriteItemRequest =
  | {DeleteRequest: BatchWriteItemKey}
  | {PutRequest: BatchWriteItemItem};

export type BatchWriteItemRequestItems = {
  RequestItems: Record<string, BatchWriteItemRequest[]>;
};

/**
 * Properties for BatchWriteItem
 */
export interface BatchWriteItemProps {
  /**
   * The items to write.
   */
  readonly items: BatchWriteItemRequestItems;

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

export class BatchWriteItem extends Construct {
  readonly resource: AwsCustomResource;

  constructor(scope: Construct, id: string, props: BatchWriteItemProps) {
    super(scope, id);

    const call: AwsSdkCall = {
      service: 'DynamoDB',
      action: 'batchWriteItem',
      parameters: props.items,
      physicalResourceId: PhysicalResourceId.of(Date.now().toString()),
    };

    const tableNames = Object.keys(props.items.RequestItems);

    const logGroup = configureLogGroupForCustomResource(
      this,
      'LogGroup',
      props,
    );

    this.resource = new AwsCustomResource(this, 'Default', {
      logGroup,
      onUpdate: call,
      installLatestAwsSdk: false,
      policy: {
        statements: [
          new PolicyStatement({
            resources: tableNames.map((name) => {
              return Stack.of(this).formatArn({
                service: 'dynamodb',
                resource: 'table',
                resourceName: name,
              });
            }),
            actions: ['dynamodb:BatchWriteItem'],
            effect: Effect.ALLOW,
          }),
        ],
      },
      timeout: props.timeout ?? Duration.minutes(2),
    });
  }
}

// {
//   "RequestItems": {
//   "string" : [
//     {
//       "DeleteRequest": {
//         "Key": {
//           "string" : {
//             "B": blob,
//             "BOOL": boolean,
//             "BS": [ blob ],
//             "L": [
//               "AttributeValue"
//             ],
//             "M": {
//               "string" : "AttributeValue"
//             },
//             "N": "string",
//             "NS": [ "string" ],
//             "NULL": boolean,
//             "S": "string",
//             "SS": [ "string" ]
//           }
//         }
//       },
//       "PutRequest": {
//         "Item": {
//           "string" : {
//             "B": blob,
//             "BOOL": boolean,
//             "BS": [ blob ],
//             "L": [
//               "AttributeValue"
//             ],
//             "M": {
//               "string" : "AttributeValue"
//             },
//             "N": "string",
//             "NS": [ "string" ],
//             "NULL": boolean,
//             "S": "string",
//             "SS": [ "string" ]
//           }
//         }
//       }
//     }
//   ]
// },
//
// RequestItems: {
//   "TABLE_NAME": [
//     {
//       PutRequest: {
//         Item: {
//           "KEY": { "N": "KEY_VALUE" },
//           "ATTRIBUTE_1": { "S": "ATTRIBUTE_1_VALUE" },
//           "ATTRIBUTE_2": { "N": "ATTRIBUTE_2_VALUE" }
//         }
//       }
//     },
//     {
//       PutRequest: {
//         Item: {
//           "KEY": { "N": "KEY_VALUE" },
//           "ATTRIBUTE_1": { "S": "ATTRIBUTE_1_VALUE" },
//           "ATTRIBUTE_2": { "N": "ATTRIBUTE_2_VALUE" }
//         }
//       }
//     }
//   ]
// }
