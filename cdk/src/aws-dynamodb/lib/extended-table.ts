import {
  type GlobalSecondaryIndexProps,
  Table,
  type TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import type {Construct} from 'constructs';
import {type ExtendedConstructProps, StandardTags} from '../../aws-cdk/index';
import {TableAlarms, type TableAlarmsOptions} from './table-alarms';

/**
 * Properties for ExtendedTable.
 */
export interface ExtendedTableProps
  extends TableProps,
    TableAlarmsOptions,
    ExtendedConstructProps {}

/**
 * DynamoDB Table with CloudWatch Alarms.
 */
export class ExtendedTable extends Table {
  readonly tableAlarms?: TableAlarms;

  constructor(scope: Construct, id: string, props: ExtendedTableProps) {
    super(scope, id, props);

    new StandardTags(this, props.standardTags);

    if (props.createAlarms ?? true) {
      this.tableAlarms = new TableAlarms(this, 'Alarms', {
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
  addGlobalSecondaryIndex(props: GlobalSecondaryIndexProps) {
    super.addGlobalSecondaryIndex(props);
    if (this.tableAlarms) {
      this.tableAlarms.addGlobalSecondaryIndexMonitoring(props.indexName);
    }
  }
}
