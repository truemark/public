import {Duration} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
  BatchWriteItem,
  BatchWriteItemRequest,
  BatchWriteItemRequestItems,
} from './batch-write-item';

/**
 * Properties for PutItems.
 */
export interface PutItemsProps {
  /**
   * The name of the DynamoDB table to write to.
   */
  readonly tableName: string;

  /**
   * The items to store.
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  readonly items: any[];

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
 * Custom resource to insert multiple items into a DynamoDB table.
 */
export class PutItems extends BatchWriteItem {
  constructor(scope: Construct, id: string, props: PutItemsProps) {
    const items: BatchWriteItemRequest[] = props.items.map((item) => {
      return {
        PutRequest: {
          Item: item,
        },
      };
    });

    const requestItems: BatchWriteItemRequestItems = {RequestItems: {}};
    requestItems.RequestItems[props.tableName] = items;

    super(scope, id, {
      items: requestItems,
      timeout: props.timeout,
      logRetention: props.logRetention,
    });
  }
}
