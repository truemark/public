import {
  GlobalSecondaryIndexPropsV2,
  TablePropsV2,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import {ExtendedConstructProps} from '../../aws-cdk/index';
import {TableAlarms, TableAlarmsOptions} from './table-alarms';
import {Construct} from 'constructs';

/**
 * Properties for ExtendedTableV2.
 */
export interface ExtendedTablePropsV2
  extends TablePropsV2, TableAlarmsOptions, ExtendedConstructProps {}

/**
 * DynamoDB Table with CloudWatch Alarms.
 */
export class ExtendedTableV2 extends TableV2 {
  readonly tableAlarms?: TableAlarms;
  constructor(scope: Construct, id: string, props: ExtendedTablePropsV2) {
    super(scope, id, props);

    if (props.createAlarms ?? true) {
      new TableAlarms(this, 'Alarms', {
        table: this,
        ...props,
      });
    }
  }

  /**
   * Add a global secondary index of table.
   *
   * @param props the property of global secondary index
   */
  addGlobalSecondaryIndex(props: GlobalSecondaryIndexPropsV2) {
    super.addGlobalSecondaryIndex(props);
    if (this.tableAlarms) {
      this.tableAlarms.addGlobalSecondaryIndexMonitoring(props.indexName);
    }
  }
}
