import {ExtendedTable} from './extended-table';
import {Construct} from 'constructs';
import {
  AttributeType,
  BillingMode,
  GlobalSecondaryIndexProps,
  TableProps,
} from 'aws-cdk-lib/aws-dynamodb';

type StandardGlobalSecondaryIndexProps = Partial<GlobalSecondaryIndexProps>;

type StandardTablePropsOmitFields = 'tableName' | 'partitionKey' | 'sortKey';

export interface StandardTableProps extends Omit<
  TableProps,
  StandardTablePropsOmitFields
> {
  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;

  /**
   * Creates additional global secondary indexes on the table with the partition key Gs#Pk and sort key Gs#Sk of string types. Default is 1.
   * Be aware you may only add one index at a time if the table already exists. This is a limitation of the DynamoDB API.
   *
   * @default 1
   */
  readonly globalSecondaryIndexes?: number;
}

/**
 * Standard DynamoDB table with a defined primary key, sort key and secondary index. This
 * class is intended to fit most development use cases. Where this class does not meet
 * your requirements, use ExtendedTable directly.
 */
export class StandardTable extends ExtendedTable {
  protected secondaryIndexCount = 0;
  constructor(scope: Construct, id: string, props?: StandardTableProps) {
    const {globalSecondaryIndexes, ...rest} = props ?? {};
    super(scope, id, {
      timeToLiveAttribute: props?.timeToLiveAttribute,
      partitionKey: {
        name: 'Pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Sk',
        type: AttributeType.STRING,
      },
      ...rest,
      billingMode: props?.billingMode ?? BillingMode.PAY_PER_REQUEST,
      deletionProtection: props?.deletionProtection ?? true,
    });
    for (let i = 0; i < (globalSecondaryIndexes ?? 1); i++) {
      this.addGlobalSecondaryIndex({
        readCapacity: props?.readCapacity,
        writeCapacity: props?.writeCapacity,
      });
    }
  }

  /**
   * Add a global secondary index of table.
   *
   * @param props the property of global secondary index
   */
  addGlobalSecondaryIndex(props: StandardGlobalSecondaryIndexProps) {
    this.secondaryIndexCount++;
    const indexName = props.indexName ?? `Gs${this.secondaryIndexCount}`;
    super.addGlobalSecondaryIndex({
      indexName,
      partitionKey: props.partitionKey ?? {
        name: `Gs${this.secondaryIndexCount}Pk`,
        type: AttributeType.STRING,
      },
      sortKey:
        props.sortKey === null
          ? undefined
          : (props.sortKey ?? {
              name: `Gs${this.secondaryIndexCount}Sk`,
              type: AttributeType.STRING,
            }),
      ...props,
    });
    if (this.tableAlarms) {
      this.tableAlarms.addGlobalSecondaryIndexMonitoring(indexName);
    }
  }
}
